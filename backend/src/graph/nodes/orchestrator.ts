import { createModel, createStructuredModel } from "../../llm/provider.js";
import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import { z } from "zod";

/**
 * OrchestratorNode: The unified intelligence hub that replaces the keyword-based router.
 *
 * Uses ONE fast LLM call to classify intent and route to the correct execution node.
 * The orchestrator is context-aware — it reads the last few messages to understand
 * whether the current message is a continuation of an existing conversation.
 *
 * Routing decisions:
 *  - "tool"        → agentNode (action tools: web search, weather, email, CRM, calendar)
 *  - "rag"         → ragNode   (query a specific knowledge base chatbot)
 *  - "capability"  → capabilityNode (list all available tools + chatbots)
 *
 * Key fix: button_reply / list_reply messages are SHORT and ambiguous ("Yes, tell me more",
 * "Measure & Govern"). Without conversation history the LLM will misclassify them.
 * We solve this by:
 *  1. Passing the last 4 messages as [CONVERSATION HISTORY] to the orchestrator.
 *  2. Including lastRagBotId in the prompt as a strong hint for continuation routing.
 *  3. Adding an explicit rule: short button/list replies should continue prior context.
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

const model = createModel();

export async function orchestratorNode(state: AgentState): Promise<Partial<AgentState>> {
    const { messages, lastRagBotId } = state;

    const lastMessage = messages[messages.length - 1];
    const currentQuery = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
            ? lastMessage.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
            : JSON.stringify(lastMessage?.content || "");

    // Detect if this is a button/list reply (short, structured user input)
    const isInteractiveReply =
        currentQuery.startsWith("[User selected button:") ||
        currentQuery.startsWith("[User selected from list:");

    // --- Fast-path: if it's an interactive reply AND we have a lastRagBotId,
    // continue the RAG conversation without an LLM call.
    if (isInteractiveReply && lastRagBotId) {
        const bot = kbStore.getChatbots().find((b) => b.id === lastRagBotId && b.enabled);
        if (bot) {
            console.log(`🧭 [Orchestrator] Fast-path: Button/list reply → continuing RAG bot '${bot.name}'`);
            return { intent: "rag", ragBotId: lastRagBotId };
        }
    }

    // --- Fast-path: Greetings, Hi, Hello, Help, Capabilities → capabilityNode (0ms)
    // Sends the full interactive WhatsApp List Menu featuring ALL 5 action tools + ALL RAG chatbots.
    const cleanLower = currentQuery.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "");
    const isGreetingOrHelp =
        ["hello", "hi", "hey", "start", "help", "menu", "what can you do", "capabilities", "features"].includes(cleanLower) ||
        cleanLower === "hello" || cleanLower === "hi" || cleanLower === "hey" ||
        cleanLower.includes("what can you do") || cleanLower.includes("list tools") || cleanLower.includes("show capabilities");

    if (isGreetingOrHelp && !lastRagBotId && messages.length <= 3) {
        console.log(`🧭 [Orchestrator] Fast-path: Greeting/Help query '${currentQuery}' → capabilityNode (List Menu)`);
        return { intent: "capability", ragBotId: null };
    }

    // Build conversation history string (last 2 messages = ~1 turn of context — enough for routing)
    const recentHistory = messages.slice(-3, -1); // exclude last (current) message
    const historyBlock = recentHistory.length > 0
        ? `\n\nCONVERSATION HISTORY (most recent first):\n${recentHistory
            .slice()
            .reverse()
            .slice(0, 2)   // cap at 2 messages
            .map((m) => {
                const role = m._getType() === "human" ? "User" : "Assistant";
                const content = typeof m.content === "string"
                    ? m.content
                    : Array.isArray(m.content)
                        ? m.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
                        : JSON.stringify(m.content);
                return `[${role}]: ${content.slice(0, 150)}`; // 150 chars max per message
            })
            .join("\n")}`
        : "";

    // Build active bots context — id, name, and keywords only (no description, saves tokens)
    const activeBots = kbStore.getChatbots().filter((b) => b.enabled);
    const botsContext = activeBots.length > 0
        ? `\n\nAVAILABLE KNOWLEDGE BASE CHATBOTS:\n${activeBots.map((b) =>
            `- ID:"${b.id}" Name:"${b.name}" Keywords:${b.triggerKeywords.slice(0, 6).join(",")}`
        ).join("\n")}`
        : "\n\nNo knowledge base chatbots are currently active.";

    // Include last known RAG bot as a continuity hint
    const continuityHint = lastRagBotId
        ? `\n\nCONTINUITY HINT: Last response was from bot ID "${lastRagBotId}". Short follow-ups/button replies should continue to that bot.`
        : "";

    const systemPrompt = `You are an intelligent routing orchestrator for a WhatsApp AI assistant.
Your job is to classify the user's intent and route it to the correct system.

AVAILABLE CAPABILITIES:

ACTION TOOLS (use intent="tool"):
- Web search, real-time news, facts
- Weather forecast for any city
- Send/read emails via Brevo
- CRM operations (leads/contacts management)
- Calendar event creation
${botsContext}${continuityHint}${historyBlock}

ROUTING RULES:
1. Use intent="capability" when the user sends greetings ("hello", "hi", "hey", "start"), asks what the bot can do, asks for a feature list, or asks for "help" or "menu".
2. Use intent="rag" when:
   - The query matches a knowledge base chatbot's topics/description.
   - The current message is a button reply, list reply, or short follow-up AFTER a knowledge base response (check conversation history and continuity hint).
   - The user says "yes", "tell me more", "continue", "ok" after the assistant gave a knowledge base answer.
3. Use intent="tool" for specific action execution requests (e.g. "search web for X", "check weather in Y", "send email to Z", "add CRM lead").
4. Default to intent="capability" for general greetings or broad inquiries.

CRITICAL RULE: Button replies (e.g., "Yes, tell me more", "Learn more") and list replies are NEVER capability requests. They are ALWAYS continuations of the previous conversation — check history to determine the correct bot.`;

    try {
        const structuredModel = createStructuredModel(OrchestratorDecision, "routing_decision");
        const decision = await structuredModel.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: currentQuery },
        ]);

        console.log(`🧭 [Orchestrator] Intent="${decision.intent}" ragBotId=${decision.ragBotId ?? "null"} — ${decision.reasoning}`);

        return {
            intent: decision.intent,
            ragBotId: decision.ragBotId ?? null,
        };
    } catch (e) {
        // If structured output fails and we have a prior RAG context, continue it
        if (lastRagBotId && isInteractiveReply) {
            console.warn("[Orchestrator] Structured output failed, using lastRagBotId fallback for interactive reply.");
            return { intent: "rag", ragBotId: lastRagBotId };
        }
        console.error("[Orchestrator] Structured output failed, defaulting to tool agent:", e);
        return { intent: "tool", ragBotId: null };
    }
}

/**
 * Conditional edge: routes to the correct execution node based on orchestrator's intent decision.
 */
export function shouldRouteFromOrchestrator(state: AgentState): "agent" | "rag" | "capability" {
    const intent = state.intent;
    if (intent === "rag") return "rag";
    if (intent === "capability") return "capability";
    return "agent";
}
