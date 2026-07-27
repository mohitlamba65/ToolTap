import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";
import type { ResponseIntent, WhatsAppPayload } from "./types.js";

/**
 * ToolTap Agent Graph State
 * 
 * Inspired by the copywriting agent's state pattern, this defines
 * the complete state that flows through the LangGraph workflow.
 * 
 * Key design decisions:
 * - `messages` uses LangGraph's built-in message reducer for proper
 *   accumulation across turns (human-in-the-loop support)
 * - `responseIntent` holds the LLM's structured format decision
 * - `whatsappPayload` is the final API-ready payload
 * - `recipientPhone` is set on entry and carried through all nodes
 */
export const AgentGraphState = Annotation.Root({
    // Core LangGraph message history — accumulated across turns
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    // Who we're talking to
    recipientPhone: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // The user's profile name from WhatsApp
    profileName: Annotation<string>({
        reducer: (x, y) => y ?? x,
        default: () => "",
    }),

    // The LLM's decision about which message format to use
    responseIntent: Annotation<ResponseIntent | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),

    // The final WhatsApp API payload ready for delivery
    whatsappPayload: Annotation<WhatsAppPayload | null>({
        reducer: (x, y) => y ?? x,
        default: () => null,
    }),

    // Whether the agent is waiting for user input
    awaitingInput: Annotation<boolean>({
        reducer: (x, y) => y ?? x,
        default: () => false,
    }),
});

export type AgentState = typeof AgentGraphState.State;
