import { createStructuredModel } from "../../llm/provider.js";
import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import { z } from "zod";

/**
 * Routes a turn to tool / rag / capability.
 * Keyword, greeting, and continuation matches skip the LLM entirely.
 */

const OrchestratorDecision = z.object({
    intent: z.enum(["tool", "rag", "capability"]).describe(
        "The routing decision: 'tool' for action tasks, 'rag' for knowledge base queries, 'capability' for listing capabilities."
    ),
    ragBotId: z.string().nullable().describe(
        "The ID of the knowledge base chatbot to query. Only set when intent is 'rag'. Must be a valid bot ID from the available bots list."
    ),
    reasoning: z.string().describe("One-line explanation of why this intent was chosen."),
});

const structuredRouter = createStructuredModel(OrchestratorDecision, "routing_decision");

const SHORT_FOLLOW_UP = new Set([
    "yes", "yep", "yeah", "ok", "okay", "sure", "continue", "more",
    "tell me more", "go on", "next", "please", "thanks", "thank you",
]);

function extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join(" ");
    }
    return JSON.stringify(content ?? "");
}

function matchKeywordBot(queryLower: string) {
    const activeBots = kbStore.getChatbots().filter((b) => b.enabled);
    let best: { id: string; name: string; hitLen: number } | null = null;
    for (const bot of activeBots) {
        for (const kw of bot.triggerKeywords) {
            const needle = kw.trim().toLowerCase();
            if (needle.length < 2) continue;
            if (queryLower.includes(needle) && needle.length > (best?.hitLen ?? 0)) {
                best = { id: bot.id, name: bot.name, hitLen: needle.length };
            }
        }
    }
    return best;
}

export async function orchestratorNode(state: AgentState): Promise<Partial<AgentState>> {
    const { messages, lastRagBotId } = state;

    const lastMessage = messages[messages.length - 1];
    const currentQuery = extractText(lastMessage?.content);

    const isInteractiveReply =
        currentQuery.startsWith("[User selected button:") ||
        currentQuery.startsWith("[User selected from list:");

    if (isInteractiveReply && lastRagBotId) {
        const bot = kbStore.getChatbots().find((b) => b.id === lastRagBotId && b.enabled);
        if (bot) {
            console.log(`🧭 [Orchestrator] Fast-path: interactive reply → RAG '${bot.name}'`);
            return { intent: "rag", ragBotId: lastRagBotId };
        }
    }

    const cleanLower = currentQuery.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const isGreetingOrHelp =
        ["hello", "hi", "hey", "start", "help", "menu", "what can you do", "capabilities", "features"].includes(cleanLower) ||
        cleanLower.includes("what can you do") ||
        cleanLower.includes("list tools") ||
        cleanLower.includes("show capabilities");

    if (isGreetingOrHelp && messages.length <= 3) {
        console.log(`🧭 [Orchestrator] Fast-path: greeting/help → capability`);
        return { intent: "capability", ragBotId: null };
    }

    if (lastRagBotId && SHORT_FOLLOW_UP.has(cleanLower)) {
        const bot = kbStore.getChatbots().find((b) => b.id === lastRagBotId && b.enabled);
        if (bot) {
            console.log(`🧭 [Orchestrator] Fast-path: short follow-up → RAG '${bot.name}'`);
            return { intent: "rag", ragBotId: lastRagBotId };
        }
    }

    const keywordHit = matchKeywordBot(currentQuery.toLowerCase());
    if (keywordHit) {
        console.log(`🧭 [Orchestrator] Fast-path: keyword → RAG '${keywordHit.name}'`);
        return { intent: "rag", ragBotId: keywordHit.id };
    }

    const recentHistory = messages.slice(-3, -1);
    const historyBlock = recentHistory.length > 0
        ? `\n\nCONVERSATION HISTORY:\n${recentHistory
            .slice()
            .reverse()
            .slice(0, 2)
            .map((m) => {
                const role = m._getType() === "human" ? "User" : "Assistant";
                return `[${role}]: ${extractText(m.content).slice(0, 150)}`;
            })
            .join("\n")}`
        : "";

    const activeBots = kbStore.getChatbots().filter((b) => b.enabled);
    const botsContext = activeBots.length > 0
        ? `\n\nAVAILABLE KNOWLEDGE BASE CHATBOTS:\n${activeBots.map((b) =>
            `- ID:"${b.id}" Name:"${b.name}" Keywords:${b.triggerKeywords.slice(0, 6).join(",")}`
        ).join("\n")}`
        : "\n\nNo knowledge base chatbots are currently active.";

    const continuityHint = lastRagBotId
        ? `\n\nCONTINUITY HINT: Last response was from bot ID "${lastRagBotId}". Short follow-ups should continue to that bot.`
        : "";

    const systemPrompt = `You are an intelligent routing orchestrator for a WhatsApp AI assistant.
Classify the user's intent. Do not answer the user.

ACTION TOOLS (intent="tool"): web search, weather, email, CRM, calendar.
${botsContext}${continuityHint}${historyBlock}

ROUTING RULES:
1. intent="capability" for greetings, help, or "what can you do".
2. intent="rag" when the query matches a knowledge-base chatbot, or is a follow-up after a KB answer. Set ragBotId to that bot's ID.
3. intent="tool" only for explicit actions (search, weather, email, CRM, calendar).
4. Button/list replies are continuations, never capability.`;

    try {
        const decision = await structuredRouter.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: currentQuery },
        ]);

        console.log(`🧭 [Orchestrator] Intent="${decision.intent}" ragBotId=${decision.ragBotId ?? "null"} — ${decision.reasoning}`);

        return {
            intent: decision.intent,
            ragBotId: decision.ragBotId ?? null,
        };
    } catch (e) {
        if (lastRagBotId) {
            console.warn("[Orchestrator] Structured output failed, continuing last RAG bot.");
            return { intent: "rag", ragBotId: lastRagBotId };
        }
        console.error("[Orchestrator] Structured output failed, defaulting to capability:", e);
        return { intent: "capability", ragBotId: null };
    }
}

export function shouldRouteFromOrchestrator(state: AgentState): "agent" | "rag" | "capability" {
    const intent = state.intent;
    if (intent === "rag") return "rag";
    if (intent === "capability") return "capability";
    return "agent";
}
