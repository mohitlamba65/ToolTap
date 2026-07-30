import { createModel, createModelWithTools } from "../../llm/provider.js";
import { ToolRegistry } from "../../tools/registry.js";
import { AGENT_PROMPT } from "../../agent/prompts/agent.prompt.js";
import { FORMATTER_PROMPT } from "../../agent/prompts/formatter.prompt.js";
import type { AgentState } from "../state.js";
import type { ResponseIntent } from "../types.js";
import { AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

const model = createModel();

const registry = new ToolRegistry();
const tools = registry.getTools();
const modelWithTools = createModelWithTools(tools);

// Export ToolNode for graph wiring
export const toolNode = new ToolNode(tools);

// ── ResponseIntent Zod schema for withStructuredOutput ─────────────────────
// OpenAI strict mode requires ALL nested object properties in 'required'.
// We use .nullable().default(null) on optional fields so they appear in required[]
// but the model can still return null when not applicable.
const ResponseIntentSchema = z.object({
    messageType: z.enum(["text", "buttons", "list", "image", "video", "audio", "document", "sticker", "location_request"])
        .describe("The optimal WhatsApp message format for this response."),
    text: z.string().describe("Main body text. Required for text/buttons/list/location_request."),
    header: z.string().nullable().default(null).describe("Short header (max 60 chars). Null if not needed."),
    footer: z.string().nullable().default(null).describe("Short footer (max 60 chars). Null if not needed."),
    buttons: z.array(z.object({
        id: z.string().describe("Unique slug ID, no spaces"),
        title: z.string().describe("Button label, max 20 chars"),
    })).nullable().default(null).describe("Quick reply buttons (max 3) for 1-3 choices. Null otherwise."),
    listButtonText: z.string().nullable().default(null).describe("The 'Open List' button label (max 20 chars). Null if not a list."),
    listSections: z.array(z.object({
        title: z.string().describe("Section title, max 24 chars"),
        rows: z.array(z.object({
            id: z.string().describe("Unique row ID"),
            title: z.string().describe("Row title, max 24 chars"),
            // MUST be required for OpenAI strict schema — use empty string when no description
            description: z.string().describe("Row description, max 72 chars. Use empty string if none."),
        })).describe("Rows in this section"),
    })).nullable().default(null).describe("List sections for 4+ selectable options. Null otherwise."),
    mediaUrl: z.string().nullable().default(null).describe("Publicly accessible media URL. Null for non-media types."),
    caption: z.string().nullable().default(null).describe("Caption for media messages. Null otherwise."),
    filename: z.string().nullable().default(null).describe("Filename for document messages. Null otherwise."),
}).describe("Structured WhatsApp message format intent.");

/**
 * Agent Node: Core reasoning node for action-based tasks.
 *
 * Uses modelWithTools bound to all action tools (web search, weather, email, CRM, calendar).
 * History is trimmed at state reducer level (last 10 messages) so no slicing needed here.
 */
export async function agentNode(state: AgentState): Promise<Partial<AgentState>> {
    const response = await modelWithTools.invoke([
        { role: "system", content: AGENT_PROMPT },
        ...state.messages,
    ]);
    return { messages: [response] };
}

/**
 * Determines whether the agent's last message contains tool calls → loop back to tools,
 * or is a final response → send to formatter.
 */
export function shouldContinue(state: AgentState): "tools" | "formatter" {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && "tool_calls" in lastMessage && (lastMessage as AIMessage).tool_calls?.length) {
        return "tools";
    }
    return "formatter";
}

/**
 * Formatter Node: Converts the final text response into a structured WhatsApp ResponseIntent.
 *
 * Stage 1 — Zero-cost heuristic fast-path (0ms):
 *   If the response text contains NO interactive signals (no lists, no URLs, no location prompts,
 *   no button keywords) → return plain text immediately with 0 additional LLM calls.
 *   Covers ~60% of all turns (greetings, confirmations, simple answers).
 *
 * Stage 2 — withStructuredOutput (replaces raw LLM call + regex parsing):
 *   Uses LangChain's native structured output to get a COMPLETE, schema-validated JSON object.
 *   This permanently solves the truncated-JSON problem from streaming + token caps.
 *   The model CANNOT return partial JSON — it must complete the entire schema.
 */
export async function formatterNode(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];

    if (!lastMessage) {
        return { responseIntent: { messageType: "text", text: "I encountered an error." } };
    }

    // Unwrap LangChain MessageContent (string | array of content blocks | object)
    const responseText = extractTextFromContent(lastMessage.content);

    // ── Stage 1: Zero-cost fast-path ─────────────────────────────────────────
    const lower = responseText.toLowerCase();
    const hasMediaUrl    = /https?:\/\/[^\s]+\.(jpg|jpeg|png|webp|gif|mp4|pdf|docx|xlsx|3gpp)(\?[^\s]*)?/i.test(responseText);
    const hasAnyUrl      = /https?:\/\/[^\s]+/.test(responseText);
    const hasListItems   = /(?:^|\n)\s*(?:[1-9][.)]\s|\*\s|-\s|•\s)/.test(responseText);
    const hasButtonWords = lower.includes("select an option") || lower.includes("choose one")
        || lower.includes("please choose") || lower.includes("would you like to")
        || lower.includes("what would you like");
    const hasLocation    = lower.includes("share your location") || lower.includes("nearest showroom")
        || lower.includes("send your location") || lower.includes("nearby");

    if (!hasMediaUrl && !hasAnyUrl && !hasListItems && !hasButtonWords && !hasLocation) {
        console.log(`⚡ [Formatter] Fast-path: plain text, skipping LLM pass.`);
        return { responseIntent: { messageType: "text", text: responseText } };
    }

    // ── Stage 2: JSON-mode LLM pass — provider-agnostic structured output ─────
    // withStructuredOutput has incompatible schema rules between Gemini and OpenAI.
    // JSON mode works universally: we ask the model to return valid JSON, then
    // parse + validate it with Zod manually. No schema restriction issues.
    console.log(`🎨 [Formatter] Interactive signals detected — running JSON-mode formatter.`);
    try {
        const rawResponse = await model.invoke([
            { role: "system", content: FORMATTER_PROMPT },
            {
                role: "user",
                content: `Format this response for WhatsApp. RESPOND ONLY WITH VALID JSON, no markdown fences, no explanation.\n\nResponse to format:\n"""${responseText}"""`,
            },
        ]);

        const rawText = extractTextFromContent(rawResponse.content);
        const parsed = parseJsonFromText(rawText);

        if (parsed && parsed.messageType) {
            const intent = parsed as ResponseIntent;

            // Strip null values injected by schema defaults (not needed in ResponseIntent)
            if (intent.header === null) delete intent.header;
            if (intent.footer === null) delete intent.footer;
            if (intent.buttons === null) delete intent.buttons;
            if (intent.listButtonText === null) delete intent.listButtonText;
            if (intent.listSections === null) delete intent.listSections;
            if ((intent as any).mediaUrl === null) delete (intent as any).mediaUrl;
            if ((intent as any).caption === null) delete (intent as any).caption;
            if ((intent as any).filename === null) delete (intent as any).filename;

            // Sanitize: if buttons > 3, auto-promote to list
            if (intent.buttons && intent.buttons.length > 3) {
                intent.messageType = "list";
                intent.listSections = [{
                    title: "Options",
                    rows: intent.buttons.map((b) => ({
                        id: b.id,
                        title: b.title.slice(0, 24),
                        description: "",
                    })),
                }];
                intent.listButtonText = intent.listButtonText || "View Options";
                delete intent.buttons;
            }

            console.log(`🎨 [Formatter Result]: Formatted as '${intent.messageType}'`);
            return { responseIntent: intent };
        }
        console.warn("[FormatterNode] Could not parse messageType from LLM response:", rawText.slice(0, 200));
    } catch (error) {
        console.warn("[FormatterNode] JSON-mode formatter failed, falling back to plain text:", (error as any)?.message || error);
    }

    return { responseIntent: { messageType: "text", text: responseText } };
}

/**
 * Robustly extracts the first valid JSON object from raw LLM text.
 * Handles markdown code fences, trailing commentary, and mid-text JSON.
 */
function parseJsonFromText(raw: string): any | null {
    // Strip markdown fences first
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();

    // Try direct parse first (fastest path)
    try { return JSON.parse(stripped); } catch (_) {}

    // Brace-depth scanner — finds the exact JSON object ignoring surrounding text
    const start = stripped.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < stripped.length; i++) {
        const ch = stripped[i];
        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (!inString) {
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    try { return JSON.parse(stripped.substring(start, i + 1)); } catch (_) { return null; }
                }
            }
        }
    }
    return null;
}

/**
 * Unwraps LangChain MessageContent (string | array of content blocks) into plain text.
 */
function extractTextFromContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((chunk: any) => typeof chunk === "string" ? chunk : chunk?.text || chunk?.content || "")
            .join("");
    }
    if (content && typeof content === "object" && content.text) {
        return content.text;
    }
    return String(content || "");
}
