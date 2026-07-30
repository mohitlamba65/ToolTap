import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";

/**
 * RAG Node: Executes semantic knowledge base query for the bot selected by the orchestrator.
 *
 * Key improvements:
 * 1. Semantic query extraction — strips the [User selected button: "..."] wrapper to get
 *    the actual topic, producing better vector search results.
 * 2. Conversation-aware deduplication — builds a summary of what was ALREADY discussed
 *    in this session and passes it to the RAG pipeline to prevent repeated answers.
 * 3. Escalation — if RAG abstains (no relevant chunks), falls through to agent tools.
 */
export async function ragNode(state: AgentState): Promise<Partial<AgentState>> {
    const { ragBotId, messages } = state;

    if (!ragBotId) {
        console.warn("[RAGNode] No ragBotId in state — escalating to agent.");
        return { ragEscalated: true };
    }

    const lastMessage = messages[messages.length - 1];
    const rawContent = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : Array.isArray(lastMessage?.content)
            ? lastMessage.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
            : JSON.stringify(lastMessage?.content || "");

    // ── Extract clean semantic query ─────────────────────────────────────────
    // Button/list replies arrive as "[User selected button: "Evidence Management" (id: evidence_mgmt)]"
    // The raw string is a poor vector search query. Extract the actual intent.
    const query = extractSemanticQuery(rawContent);
    console.log(`📚 [RAGNode] Query: "${query}" (from: "${rawContent.slice(0, 60)}")`);

    // ── Build conversation history for deduplication ──────────────────────────
    // Pass the last 3 AI answers so the LLM knows what was ALREADY covered
    // and can provide NEW/DEEPER information instead of repeating itself.
    const previousAiAnswers = messages
        .filter((m) => m._getType() === "ai")
        .slice(-3) // last 3 AI responses
        .map((m, idx) => {
            const content = typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content)
                    ? m.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
                    : JSON.stringify(m.content);
            return `[Previous Answer ${idx + 1}]:\n${content.slice(0, 600)}`;
        })
        .join("\n\n");

    // Full conversation context (used by queryChatbot for session awareness)
    const conversationContext = messages
        .slice(-6)
        .map((m) => {
            const role = m._getType() === "human" ? "User" : "Assistant";
            const content = typeof m.content === "string"
                ? m.content
                : Array.isArray(m.content) ? m.content.map((c: any) => typeof c === "string" ? c : c.text || "").join(" ")
                : JSON.stringify(m.content);
            return `${role}: ${content.slice(0, 300)}`;
        })
        .join("\n");

    const bot = kbStore.getChatbots().find((b) => b.id === ragBotId);
    console.log(`📚 [RAGNode] Querying chatbot '${bot?.name ?? ragBotId}'`);

    try {
        const result = await kbStore.queryChatbot(
            ragBotId,
            query,
            conversationContext,
            previousAiAnswers || undefined  // pass previously discussed content
        );

        if (result.abstained) {
            console.log(`⬆️ [RAGNode] Knowledge base abstained — escalating to agent for tool-based answer.`);
            return { ragEscalated: true };
        }

        console.log(`✅ [RAGNode] Retrieved answer (${result.retrievedChunksCount} chunks)`);
        return {
            messages: [new AIMessage(result.answer)],
            ragEscalated: false,
            lastRagBotId: ragBotId,
        };
    } catch (e) {
        console.error(`[RAGNode] Query failed for bot '${ragBotId}':`, e);
        return { ragEscalated: true };
    }
}

/**
 * Extracts a clean semantic search query from raw WhatsApp message content.
 *
 * Handles:
 *  - [User selected button: "Title" (id: btn_id)]  → "Title"
 *  - [User selected from list: "Title" (id: row_id)] → "Title"
 *  - Plain text → trimmed plain text
 */
function extractSemanticQuery(raw: string): string {
    // Button reply pattern
    const btnMatch = raw.match(/\[User selected button:\s*"([^"]+)"/i);
    if (btnMatch?.[1]) return btnMatch[1].trim();

    // List reply pattern
    const listMatch = raw.match(/\[User selected from list:\s*"([^"]+)"/i);
    if (listMatch?.[1]) return listMatch[1].trim();

    // Plain text — return as-is
    return raw.trim();
}

/**
 * Conditional edge from ragNode: if RAG abstained or failed, escalate to agent.
 */
export function shouldEscalateToAgent(state: AgentState): "formatter" | "agent" {
    return state.ragEscalated ? "agent" : "formatter";
}
