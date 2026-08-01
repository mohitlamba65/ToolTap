import { createModel, createModelWithTools, createTokenCappedModel } from "../../llm/provider.js";
import { ToolRegistry } from "../../tools/registry.js";
import { AGENT_PROMPT } from "../../agent/prompts/agent.prompt.js";
import { FORMATTER_PROMPT } from "../../agent/prompts/formatter.prompt.js";
import type { AgentState } from "../state.js";
import type { ResponseIntent } from "../types.js";
import { AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";

const model = createModel();

// Token-capped model for the formatter — JSON output never needs >512 tokens
const formatterModel = createTokenCappedModel(512);

const registry = new ToolRegistry();
const tools = registry.getTools();
const modelWithTools = createModelWithTools(tools);

// Export ToolNode for graph wiring
export const toolNode = new ToolNode(tools);

// ── ResponseIntent Zod schema for withStructuredOutput ─────────────────────
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
            description: z.string().describe("Row description, max 72 chars. Use empty string if none."),
        })).describe("Rows in this section"),
    })).nullable().default(null).describe("List sections for 4+ selectable options. Null otherwise."),
    mediaUrl: z.string().nullable().default(null).describe("Publicly accessible media URL. Null for non-media types."),
    caption: z.string().nullable().default(null).describe("Caption for media messages. Null otherwise."),
    filename: z.string().nullable().default(null).describe("Filename for document messages. Null otherwise."),
}).describe("Structured WhatsApp message format intent.");

/**
 * Agent Node: Core reasoning node for action-based tasks.
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
 * Formatter Node — Three-stage fast-path pipeline.
 *
 * Stage 1 (0ms)   — Deterministic follow-up button parser.
 *                   Catches ~80% of RAG responses that end with "Want to explore further?"
 *                   This runs FIRST — before any heuristic — because the RAG system prompt
 *                   mandates this exact format on every response.
 *
 * Stage 2 (0ms)   — Plain-text heuristic.
 *                   Catches greetings, confirmations, single-paragraph answers with no
 *                   bullets, no URLs, and no interactive signals.
 *
 * Stage 3 (LLM)   — Token-capped JSON-mode formatter.
 *                   Only reached for media links, location requests, or complex lists
 *                   that don't match the deterministic patterns above.
 */
export async function formatterNode(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];

    if (!lastMessage) {
        return { responseIntent: { messageType: "text", text: "I encountered an error." } };
    }

    const responseText = extractTextFromContent(lastMessage.content);

    // ── Stage 1: Deterministic follow-up button parser (0ms) ─────────────────
    // Runs first — the RAG prompt mandates this format on nearly every response.
    const deterministicIntent = parseFollowUpButtons(responseText);
    if (deterministicIntent) {
        console.log(`⚡ [Formatter] Stage 1 fast-path: deterministic buttons (${deterministicIntent.buttons?.length ?? 0} buttons, 0ms)`);
        return { responseIntent: deterministicIntent };
    }

    // ── Stage 2: Plain-text heuristic (0ms) ───────────────────────────────────
    // Safe to skip LLM if the text has no interactive signals whatsoever.
    const lower = responseText.toLowerCase();
    const hasMediaUrl    = /https?:\/\/[^\s]+\.(jpg|jpeg|png|webp|gif|mp4|pdf|docx|xlsx|3gpp)(\?[^\s]*)?/i.test(responseText);
    const hasAnyUrl      = /https?:\/\/[^\s]+/.test(responseText);
    const hasLocation    = lower.includes("share your location") || lower.includes("nearest showroom")
        || lower.includes("send your location") || lower.includes("share location");
    const hasListOrBullets = /(?:^|\n)\s*(?:[1-9][.)]|\*|-|•)\s+/.test(responseText);
    const hasInteractiveSignals =
        lower.includes("would you like") || lower.includes("what would you like") ||
        lower.includes("choose") || lower.includes("select") ||
        lower.includes("pick") || lower.includes("prefer") ||
        lower.includes("want to explore") || lower.includes("explore further") ||
        lower.includes("what's next") || lower.includes("next steps") ||
        lower.includes("options") || lower.includes("discovery") ||
        lower.includes("following") || lower.includes("available tools") ||
        lower.includes("available options");

    if (!hasMediaUrl && !hasAnyUrl && !hasLocation && !hasListOrBullets && !hasInteractiveSignals) {
        console.log(`⚡ [Formatter] Stage 2 fast-path: plain text, skipping LLM`);
        return { responseIntent: { messageType: "text", text: responseText } };
    }

    // ── Stage 3: Token-capped JSON-mode LLM formatter ─────────────────────────
    console.log(`🎨 [Formatter] Stage 3: interactive signals detected — running JSON-mode formatter`);
    try {
        const rawResponse = await formatterModel.invoke([
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

            // Strip null values injected by schema defaults
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

            console.log(`🎨 [Formatter] Stage 3 result: '${intent.messageType}'`);
            return { responseIntent: intent };
        }
        console.warn("[Formatter] Could not parse messageType from LLM response:", rawText.slice(0, 200));
    } catch (error) {
        console.warn("[Formatter] JSON-mode formatter failed, falling back to plain text:", (error as any)?.message || error);
    }

    return { responseIntent: { messageType: "text", text: responseText } };
}

/**
 * Robustly extracts the first valid JSON object from raw LLM text.
 */
function parseJsonFromText(raw: string): any | null {
    const stripped = raw.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
    try { return JSON.parse(stripped); } catch (_) {}

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
 * Unwraps LangChain MessageContent into plain text.
 */
function extractTextFromContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((chunk: any) => typeof chunk === "string" ? chunk : chunk?.text || chunk?.content || "")
            .join("");
    }
    if (content && typeof content === "object" && content.text) return content.text;
    return String(content || "");
}

/**
 * Deterministically parses standard RAG follow-up buttons in 0ms.
 *
 * Matches the exact format the RAG system prompt mandates:
 *   "*Want to explore further?*\n1. Option A\n2. Option B"
 *
 * Also matches agent dynamic interactive output:
 *   "*What's next?*\n1. Step A\n2. Step B"
 *   "*Available Tools:*\n1. Web Search — ...\n2. Weather — ..."  → list (4+ items)
 */
function parseFollowUpButtons(text: string): ResponseIntent | null {
    // Match known interactive section headers
    const headerRegex = /\n*\*?(?:Want to explore further|What's next|Next steps|Explore further|Suggested options|Available Tools|Available options|What would you like)\??:?\*?\n/i;
    const match = text.match(headerRegex);
    if (!match || match.index === undefined) return null;

    const bodyText = text.slice(0, match.index).trim();
    const optionsBlock = text.slice(match.index + match[0].length).trim();

    if (!bodyText || !optionsBlock) return null;

    const lines = optionsBlock.split("\n").map((l) => l.trim()).filter(Boolean);
    const items: { id: string; title: string; description: string }[] = [];

    for (const line of lines) {
        // Match: "1. Title — Description" or "1. Title" or "• Title"
        const itemMatch = line.match(/^(?:[1-9][.)]|\*|-|•)\s*(.+)$/);
        if (itemMatch) {
            const rawTitle = itemMatch[1]?.trim() ?? "";
            if (!rawTitle) continue;

            // Split "Title — Description" (for list items)
            const dashIdx = rawTitle.search(/ [—–-] /);
            const title = dashIdx > -1
                ? rawTitle.slice(0, dashIdx).trim().slice(0, 24)
                : rawTitle.slice(0, 24);
            const description = dashIdx > -1
                ? rawTitle.slice(dashIdx + 3).trim().slice(0, 72)
                : "";

            const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
            items.push({ id: id || `opt_${items.length + 1}`, title, description });
        }
    }

    if (items.length === 0) return null;

    // 1–3 items → buttons
    if (items.length <= 3) {
        return {
            messageType: "buttons",
            text: bodyText,
            buttons: items.map(({ id, title }) => ({ id, title: title.slice(0, 20) })),
        };
    }

    // 4–10 items → list menu
    if (items.length <= 10) {
        return {
            messageType: "list",
            text: bodyText,
            listButtonText: "View Options",
            listSections: [{
                title: "Options",
                rows: items.map(({ id, title, description }) => ({ id, title, description })),
            }],
        };
    }

    return null;
}
