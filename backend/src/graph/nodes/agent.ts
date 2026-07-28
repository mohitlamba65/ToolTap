import { createModel, createModelWithTools } from "../../llm/provider.js";
import { ToolRegistry } from "../../tools/registry.js";
import { AGENT_PROMPT } from "../../agent/prompts/agent.prompt.js";
import { FORMATTER_PROMPT } from "../../agent/prompts/formatter.prompt.js";
import type { AgentState } from "../state.js";
import type { ResponseIntent } from "../types.js";
import { AIMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const model = createModel();
const registry = new ToolRegistry();
const tools = registry.getTools();

// Bind action tools to the model with fallback support
const modelWithTools = createModelWithTools(tools);

// Export ToolNode for graph wiring
export const toolNode = new ToolNode(tools);

// FORMAT_INSTRUCTION is now fully encoded in FORMATTER_PROMPT (formatter.prompt.ts)

/**
 * Agent Node: The core reasoning node.
 * 
 * This invokes the LLM with the full conversation history + action tools.
 * If the LLM calls a tool, the graph will route to the tool executor.
 * If it produces a final text response, we proceed to the formatter.
 */
export async function agentNode(state: AgentState): Promise<Partial<AgentState>> {
    const response = await modelWithTools.invoke([
        { role: "system", content: AGENT_PROMPT },
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
    
    if (!lastMessage) {
        return { responseIntent: { messageType: "text", text: "Error: No message to format." } };
    }

    const responseText = typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);

    // Pass the text to the LLM to decide the WhatsApp format

    try {
        const formatResponse = await model.invoke([
            {
                role: "system",
                content: FORMATTER_PROMPT,
            },
            {
                role: "user",
                content: `Format this response for WhatsApp:\n\n"""${responseText}"""`,
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
