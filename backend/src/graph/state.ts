import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ResponseIntent, WhatsAppPayload } from "./types.js";

/**
 * Trim message history to last N messages to avoid unbounded token growth.
 * MemorySaver accumulates forever; this reducer caps it at the graph level.
 */
const MAX_HISTORY_MESSAGES = 10; // 5 user+assistant turns

function trimmedMessageReducer(existing: BaseMessage[], incoming: BaseMessage[]): BaseMessage[] {
    const full = messagesStateReducer(existing, incoming);
    if (full.length > MAX_HISTORY_MESSAGES) {
        return full.slice(-MAX_HISTORY_MESSAGES);
    }
    return full;
}

/**
 * ToolTap Unified Agent Graph State
 *
 * Single state object that flows through the entire graph.
 * All nodes read from and write to this state.
 */
export const AgentGraphState = Annotation.Root({
    // ── Core conversation history (auto-trimmed to last 10) ─────────────────
    messages: Annotation<BaseMessage[]>({
        reducer: trimmedMessageReducer,
        default: () => [],
    }),

    // ── Recipient info ───────────────────────────────────────────────────────
    recipientPhone: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),
    profileName: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // ── Orchestrator decision ────────────────────────────────────────────────
    // Set by orchestratorNode; drives conditional routing to the correct execution node.
    intent: Annotation<"tool" | "rag" | "capability" | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),
    // Which RAG bot the orchestrator decided to query (if intent === "rag")
    ragBotId: Annotation<string | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),
    // Persists the last successfully used RAG bot ID across turns.
    // Used by the orchestrator as a strong hint when it receives ambiguous short replies
    // like button/list selections that are continuations of a RAG conversation.
    lastRagBotId: Annotation<string | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),
    // Set by ragNode if the RAG answer was insufficient — triggers escalation to agent
    ragEscalated: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),

    // ── Formatter output ─────────────────────────────────────────────────────
    responseIntent: Annotation<ResponseIntent | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),

    // ── WhatsApp delivery ────────────────────────────────────────────────────
    whatsappPayload: Annotation<WhatsAppPayload | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),
});

export type AgentState = typeof AgentGraphState.State;
