import { kbStore } from "../../kb/kb-store.js";
import type { AgentState } from "../state.js";
import type { ResponseIntent } from "../types.js";

/**
 * Capability Node: Deterministic — generates the capability overview with ZERO LLM calls.
 *
 * Directly sets `responseIntent` as a WhatsApp list message, bypassing the formatter
 * entirely. This prevents the formatter LLM from re-interpreting and potentially
 * truncating or misformatting the structured content.
 *
 * Splits output into two messages:
 *  1. A text message listing action tools (displayed inline).
 *  2. A list message showing all active chatbots (if any exist).
 *  If no chatbots: single text message covering everything.
 */
export function capabilityNode(state: AgentState): Partial<AgentState> {
    const chatbots = kbStore.getChatbots().filter((b) => b.enabled);

    // Build the capability list as a WhatsApp interactive list message.
    // Tools go as rows in the first section; chatbots in the second section.
    const toolRows = [
        { id: "cap_web",      title: "🌐 Web Search",    description: "Real-time internet search & news" },
        { id: "cap_weather",  title: "☀️ Weather",        description: "Live weather for any city" },
        { id: "cap_email",    title: "✉️ Email",           description: "Send, track & retrieve emails via Mailgun" },
        { id: "cap_crm",      title: "🗃️ CRM",             description: "Manage leads & contacts" },
        { id: "cap_calendar", title: "📅 Calendar",       description: "Create & manage events" },
    ];

    const sections = [
        {
            title: "⚡ Action Tools",
            rows: toolRows,
        },
    ];

    if (chatbots.length > 0) {
        sections.push({
            title: "📚 Chatbots",
            rows: chatbots.slice(0, 5).map((bot, idx) => ({
                id: `cap_bot_${idx}`,
                title: bot.name.slice(0, 24),
                description: (bot.description || "Knowledge base assistant").slice(0, 72),
            })),
        });
    }

    const footerText = chatbots.length > 0
        ? "Just type your request or pick a topic above!"
        : "Just type your request naturally!";

    const responseIntent: ResponseIntent = {
        messageType: "list",
        text: "Here's everything I can help you with 👇",
        header: "🤖 ToolTap Capabilities",
        footer: footerText,
        listButtonText: "View Capabilities",
        listSections: sections,
    };

    console.log(`🔧 [CapabilityNode] Generated capability list (${toolRows.length} tools, ${chatbots.length} bots)`);
    return { responseIntent };
}
