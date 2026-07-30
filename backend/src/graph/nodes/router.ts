import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";

/**
 * Capability-Aware Router Node
 *
 * Inspects incoming message to decide:
 * 1. Is user asking "What can you do?" → List ALL Action Tools + Custom Chatbots!
 * 2. Matches a Custom Chatbot trigger keyword → Execute Semantic RAG for that chatbot.
 * 3. Requires Action Tool → Pass control to agent reasoning node.
 */
export async function routerNode(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1];
    const query = typeof lastMessage?.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage?.content || "");

    const queryLower = query.toLowerCase();

    // 1. Check for Capability Inquiry ("What can you do?", "Help", "List capabilities")
    if (
        queryLower.includes("what can you do") ||
        queryLower.includes("your capabilities") ||
        queryLower.includes("list tools") ||
        queryLower.includes("what tools do you have") ||
        queryLower === "help"
    ) {
        const capabilitiesText = generateCapabilitiesOverview();
        return {
            messages: [new AIMessage(capabilitiesText)],
        };
    }

    // 2. Check for Custom Chatbot Keyword Matches
    const activeChatbots = kbStore.getChatbots().filter((b) => b.enabled);

    // Collect ALL bots that match the query keywords
    const matchedBots = activeChatbots.filter((bot) =>
        bot.triggerKeywords.some((kw) => queryLower.includes(kw.toLowerCase()))
    );

    if (matchedBots.length > 0) {
        // Build conversation context once (shared across all parallel queries)
        const conversationContext = state.messages
            .slice(-6) // Last 3 human+ai pairs for context window efficiency
            .map((m) => `${m._getType() === "human" ? "User" : "Assistant"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
            .join("\n");

        if (matchedBots.length === 1 && matchedBots[0]) {
            // Single match — invoke directly, no Promise overhead
            const bot = matchedBots[0];
            console.log(`🔀 [Router] Query matched chatbot '${bot.name}' (id: ${bot.id})`);
            try {
                const ragResult = await kbStore.queryChatbot(bot.id, query, conversationContext);
                return { messages: [new AIMessage(ragResult.answer)] };
            } catch (e) {
                console.error(`[Router] RAG query failed for chatbot '${bot.id}':`, e);
            }
        } else {
            // Multiple matches — run ALL in parallel, use the first successful response.
            // This avoids sequential wait (bot1 → bot2 → bot3) when multiple KBs activate.
            console.log(`🔀 [Router] ${matchedBots.length} bots matched — running parallel RAG race: [${matchedBots.map(b => b.name).join(", ")}]`);
            try {
                const ragResult = await Promise.race(
                    matchedBots.map(async (bot) => {
                        const result = await kbStore.queryChatbot(bot.id, query, conversationContext);
                        if (result.abstained) throw new Error(`Bot '${bot.id}' abstained`);
                        console.log(`🏁 [Router] RAG race won by '${bot.name}'`);
                        return result;
                    })
                );
                return { messages: [new AIMessage(ragResult.answer)] };
            } catch (e) {
                console.error(`[Router] All parallel RAG queries failed or abstained:`, e);
            }
        }
    }

    // Default: Return unchanged, graph will proceed to Agent Node for action tool execution
    return {};
}

/**
 * Determines whether router already satisfied the query (e.g. RAG or Capabilities)
 * or if it needs to proceed to the action agent.
 */
export function shouldRouteToActionAgent(state: AgentState): "agent" | "formatter" {
    const lastMessage = state.messages[state.messages.length - 1];
    // If router added an AIMessage without tool calls, we can jump directly to format decision!
    if (lastMessage && lastMessage._getType() === "ai" && !("tool_calls" in lastMessage && (lastMessage as any).tool_calls?.length)) {
        return "formatter";
    }
    return "agent";
}

/**
 * Dynamically lists ALL Action Tools + Custom Knowledge Base Chatbots.
 */
function generateCapabilitiesOverview(): string {
    const chatbots = kbStore.getChatbots().filter((b) => b.enabled);

    let text = `🤖 *ToolTap Capabilities Overview*\n\n`;

    text += `⚡ *Action Tools (Real-Time Execution)*:\n`;
    text += `1. 🌐 *Web Search*: Real-time internet search via Tavily API.\n`;
    text += `2. ☀️ *Weather Forecast*: Live global weather updates.\n`;
    text += `3. ✉️ *Email Service*: Send, track, retrieve emails & manage queues via Mailgun Engine.\n`;
    text += `4. 🗃️ *CRM Agent*: Perform lead CRUD on HubSpot or Postgres Database.\n`;
    text += `5. 📅 *Calendar*: Create and manage scheduling events.\n\n`;

    text += `📚 *Custom Knowledge Bases & RAG Chatbots*:\n`;
    if (chatbots.length === 0) {
        text += `• No custom chatbots currently active. Add one from the dashboard!\n`;
    } else {
        chatbots.forEach((bot, idx) => {
            text += `${idx + 1}. 🧠 *${bot.name}*\n   _${bot.description}_\n   *Triggers*: ${bot.triggerKeywords.map((k) => `\`${k}\``).join(", ")}\n`;
        });
    }

    text += `\n💬 *How to interact*:\n`;
    text += `• Ask me to perform actions (e.g., "Search weather in Tokyo", "Send email to...")\n`;
    text += `• Ask questions matching any knowledge base topic above!\n`;

    return text;
}
