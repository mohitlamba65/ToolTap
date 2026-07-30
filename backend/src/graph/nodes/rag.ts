import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";

/**
 * RAG Node: Executes semantic knowledge base query for the bot selected by the orchestrator.
 *
 * Improvements over old router approach:
 * - Bot is selected by orchestrator (LLM-based), not keyword matching
 * - Shared conversation context is extracted once efficiently
 * - If RAG abstains (no relevant chunks), sets ragEscalated=true to fall through to agent
 * - Agent node will then attempt to answer using tools or general knowledge
 */
export async function ragNode(state: AgentState): Promise<Partial<AgentState>> {
    const { ragBotId, messages } = state;

    if (!ragBotId) {
        console.warn("[RAGNode] No ragBotId in state — escalating to agent.");
        return { ragEscalated: true };
    }

    const lastMessage = messages[messages.length - 1];
    const query = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
            ? lastMessage.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
            : JSON.stringify(lastMessage?.content || "");

    // Build recent conversation context (last 6 messages = 3 turns)
    const conversationContext = messages
        .slice(-6)
        .map((m) => `${m._getType() === "human" ? "User" : "Assistant"}: ${
            typeof m.content === "string" ? m.content
            : Array.isArray(m.content) ? m.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
            : JSON.stringify(m.content)
        }`)
        .join("\n");

    const bot = kbStore.getChatbots().find((b) => b.id === ragBotId);
    console.log(`📚 [RAGNode] Querying chatbot '${bot?.name ?? ragBotId}'`);

    try {
        const result = await kbStore.queryChatbot(ragBotId, query, conversationContext);

        if (result.abstained) {
            // RAG couldn't answer — escalate to agent with tool access
            console.log(`⬆️ [RAGNode] Knowledge base abstained — escalating to agent for tool-based answer.`);
            return { ragEscalated: true };
        }

        console.log(`✅ [RAGNode] Retrieved answer (${result.retrievedChunksCount} chunks)`);
        return {
            messages: [new AIMessage(result.answer)],
            ragEscalated: false,
            lastRagBotId: ragBotId, // persist so orchestrator knows context on next turn
        };
    } catch (e) {
        console.error(`[RAGNode] Query failed for bot '${ragBotId}':`, e);
        return { ragEscalated: true };
    }
}

/**
 * Conditional edge from ragNode: if RAG abstained or failed, escalate to agent.
 */
export function shouldEscalateToAgent(state: AgentState): "formatter" | "agent" {
    return state.ragEscalated ? "agent" : "formatter";
}
