import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";

const ABSTAIN_REPLY =
    "I don't have enough in this knowledge base to answer that accurately.\n\n*Want to explore further?*\n1. Rephrase question\n2. Other topic\n3. What can you do";

/**
 * Queries the chatbot selected by the orchestrator.
 * Knowledge misses stay in RAG (honest abstain) — they do not start the tool agent.
 */
export async function ragNode(state: AgentState): Promise<Partial<AgentState>> {
    const { ragBotId, messages } = state;

    if (!ragBotId) {
        console.warn("[RAGNode] No ragBotId — abstaining without tool escalation.");
        return {
            messages: [new AIMessage(ABSTAIN_REPLY)],
            ragEscalated: false,
        };
    }

    const lastMessage = messages[messages.length - 1];
    const rawContent = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
            ? lastMessage.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join(" ")
            : JSON.stringify(lastMessage?.content || "");

    const query = extractSemanticQuery(rawContent);
    console.log(`📚 [RAGNode] Query: "${query}" (from: "${rawContent.slice(0, 60)}")`);

    const previousAiAnswers = messages
        .filter((m) => m._getType() === "ai")
        .slice(-2)
        .map((m, idx) => {
            const content = typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content)
                    ? m.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join(" ")
                    : JSON.stringify(m.content);
            return `[Previous ${idx + 1}]: ${content.slice(0, 300)}`;
        })
        .join("\n");

    const conversationContext = messages
        .slice(-4)
        .map((m) => {
            const role = m._getType() === "human" ? "User" : "Assistant";
            const content = typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content)
                    ? m.content.map((c: any) => (typeof c === "string" ? c : c.text || "")).join(" ")
                    : JSON.stringify(m.content);
            return `${role}: ${content.slice(0, 200)}`;
        })
        .join("\n");

    const bot = kbStore.getChatbots().find((b) => b.id === ragBotId);
    console.log(`📚 [RAGNode] Querying chatbot '${bot?.name ?? ragBotId}'`);

    try {
        const result = await kbStore.queryChatbot(
            ragBotId,
            query,
            conversationContext,
            previousAiAnswers || undefined
        );

        if (result.abstained) {
            console.log(`📚 [RAGNode] Abstained — staying on RAG (no tool agent).`);
            return {
                messages: [new AIMessage(result.answer || ABSTAIN_REPLY)],
                ragEscalated: false,
                lastRagBotId: ragBotId,
            };
        }

        console.log(`✅ [RAGNode] Retrieved answer (${result.retrievedChunksCount} chunks)`);
        return {
            messages: [new AIMessage(result.answer)],
            ragEscalated: false,
            lastRagBotId: ragBotId,
        };
    } catch (e) {
        console.error(`[RAGNode] Query failed for bot '${ragBotId}':`, e);
        return {
            messages: [new AIMessage(ABSTAIN_REPLY)],
            ragEscalated: false,
            lastRagBotId: ragBotId,
        };
    }
}

function extractSemanticQuery(raw: string): string {
    const btnMatch = raw.match(/\[User selected button:\s*"([^"]+)"/i);
    if (btnMatch?.[1]) return btnMatch[1].trim();

    const listMatch = raw.match(/\[User selected from list:\s*"([^"]+)"/i);
    if (listMatch?.[1]) return listMatch[1].trim();

    return raw.trim();
}

/** RAG always goes to the formatter. Kept so graph wiring stays explicit. */
export function shouldEscalateToAgent(_state: AgentState): "formatter" | "agent" {
    return "formatter";
}
