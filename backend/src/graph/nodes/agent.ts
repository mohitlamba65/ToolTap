import { createModel } from "../../llm/provider.js";
import { ToolRegistry } from "../../tools/registry.js";
import { SYSTEM_PROMPT } from "../../agent/prompt.js";
import type { AgentState } from "../state.js";
import type { ResponseIntent } from "../types.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const model = createModel();
const registry = new ToolRegistry();
const tools = registry.getTools();

// Bind action tools to the model
const modelWithTools = model.bindTools(tools);

// Export ToolNode for graph wiring
export const toolNode = new ToolNode(tools);

/**
 * FORMAT_INSTRUCTION appended to the LLM's last response to get
 * a structured ResponseIntent. This is a second-pass call.
 */
const FORMAT_INSTRUCTION = `
Based on the response you just generated, decide the best WhatsApp message format.
Return ONLY valid JSON matching this schema (no markdown, no explanation):

{
  "messageType": "text" | "buttons" | "list" | "image" | "document",
  "text": "The main body text of your response",
  "header": "Optional short header (max 60 chars)",
  "footer": "Optional footer text (max 60 chars)",
  "buttons": [{"id": "unique_id", "title": "Button Label (max 20 chars)"}],
  "listButtonText": "View Options",
  "listSections": [{"title": "Section", "rows": [{"id": "row_id", "title": "Row Title", "description": "Description"}]}],
  "mediaUrl": "https://...",
  "caption": "Image/doc caption",
  "filename": "file.pdf"
}

Rules:
- Use "buttons" (max 3) when presenting 2-3 clear choices to the user.
- Use "list" when presenting 4-10 options organized in sections.
- Use "image" when your response includes an image URL.
- Use "document" when your response references a downloadable file.
- Use "text" for all other responses (most common).
- Only include the fields relevant to the chosen messageType.
- BUTTONS: max 3 buttons, each title max 20 chars, each id must be unique.
- LIST: each section title max 24 chars, each row title max 24 chars.
`;

/**
 * Agent Node: The core reasoning node.
 * 
 * This invokes the LLM with the full conversation history + action tools.
 * If the LLM calls a tool, the graph will route to the tool executor.
 * If it produces a final text response, we proceed to the formatter.
 */
export async function agentNode(state: AgentState): Promise<Partial<AgentState>> {
    const response = await modelWithTools.invoke([
        { role: "system", content: SYSTEM_PROMPT },
        ...state.messages,
    ]);

    return { messages: [response] };
}

/**
 * Determines whether the agent's last message contains tool calls
 * (route to tools) or is a final response (route to formatter).
 */
export function shouldContinue(state: AgentState): "tools" | "formatter" {
    const lastMessage = state.messages[state.messages.length - 1];
    if (lastMessage && "tool_calls" in lastMessage && (lastMessage as AIMessage).tool_calls?.length) {
        return "tools";
    }
    return "formatter";
}

/**
 * Formatter Node: Takes the LLM's final text response and asks it
 * to produce a structured ResponseIntent for WhatsApp format selection.
 * 
 * This is a lightweight second-pass call — no tools bound.
 */
export async function formatterNode(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    const responseText = typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    // For very short responses, skip the format decision and use text
    if (responseText.length < 80) {
        const intent: ResponseIntent = {
            messageType: "text",
            text: responseText,
        };
        return { responseIntent: intent };
    }

    try {
        const formatResponse = await model.invoke([
            {
                role: "system",
                content: "You are a WhatsApp message format selector. You ONLY output valid JSON. No explanations.",
            },
            {
                role: "user",
                content: `Here is the agent's response to format for WhatsApp:\n\n"""${responseText}"""\n\n${FORMAT_INSTRUCTION}`,
            },
        ]);

        const raw = typeof formatResponse.content === "string"
            ? formatResponse.content
            : JSON.stringify(formatResponse.content);

        // Extract JSON from potential markdown code fences
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const intent = JSON.parse(jsonMatch[0]) as ResponseIntent;
            // Validate and sanitize
            if (intent.buttons && intent.buttons.length > 3) {
                // Too many buttons — convert to list
                intent.messageType = "list";
                intent.listSections = [{
                    title: "Options",
                    rows: intent.buttons.map(b => ({
                        id: b.id,
                        title: b.title.slice(0, 24),
                    })),
                }];
                intent.listButtonText = intent.listButtonText || "View Options";
                delete intent.buttons;
            }
            return { responseIntent: intent };
        }
    } catch (error) {
        console.warn("[FormatterNode] Failed to parse format intent, falling back to text:", error);
    }

    // Fallback: plain text
    return {
        responseIntent: {
            messageType: "text",
            text: responseText,
        },
    };
}
