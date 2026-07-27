import express from "express";
import type { Request, Response } from "express";
import bodyParser from "body-parser";
import "dotenv/config";
import { createToolTapGraph } from "./graph/graph.js";
import { parseMetaWebhook } from "./whatsapp/webhook-parser.js";
import { HumanMessage } from "@langchain/core/messages";

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create the LangGraph agent
const graph = createToolTapGraph();
console.log("✅ ToolTap LangGraph agent initialized");

// Per-user thread IDs for conversation persistence
const userThreads = new Map<string, string>();

function getThreadId(phone: string): string {
    if (!userThreads.has(phone)) {
        userThreads.set(phone, `thread_${phone}_${Date.now()}`);
    }
    return userThreads.get(phone)!;
}

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "my_verify_token";

// Meta webhook verification (GET)
app.get(/.*/, (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const challenge = req.query["hub.challenge"];
    const token = req.query["hub.verify_token"];

    if (mode === "subscribe" && token === verifyToken) {
        console.log("Webhook verified successfully");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// Webhook handler (POST) — processes ALL message types through LangGraph
app.post(/.*/, async (req: Request, res: Response) => {
    try {
        // Meta requires a fast 200 response
        res.status(200).send("EVENT_RECEIVED");

        const messages = parseMetaWebhook(req.body);

        for (const message of messages) {
            const { from, text, type, profileName } = message;
            console.log(`\n📩 [${type}] from ${from} (${profileName}): ${text}`);

            // Skip reactions and unsupported silently
            if (type === "reaction") continue;

            const threadId = getThreadId(from);

            // Build the user message with context about message type
            let userContent = text || "";
            if (type === "button_reply" && message.buttonReply) {
                userContent = `[User selected button: "${message.buttonReply.title}" (id: ${message.buttonReply.id})]`;
            } else if (type === "list_reply" && message.listReply) {
                userContent = `[User selected from list: "${message.listReply.title}" (id: ${message.listReply.id})]`;
            } else if (type === "location" && message.location) {
                userContent = `User shared their location: ${message.location.name || ""} ${message.location.address || ""} (lat: ${message.location.latitude}, lon: ${message.location.longitude})`;
            }

            try {
                // Invoke the LangGraph workflow
                await graph.invoke(
                    {
                        messages: [new HumanMessage(userContent)],
                        recipientPhone: from,
                        profileName: profileName || "",
                    },
                    {
                        configurable: { thread_id: threadId },
                    }
                );
            } catch (error) {
                console.error("Agent invocation error:", error);
                // Fallback: send a plain text error message
                await sendFallbackText(from, "I'm sorry, an error occurred while processing your request.");
            }
        }
    } catch (error) {
        console.error("Webhook error:", error);
    }
});

/**
 * Emergency fallback — sends a plain text message if the graph fails entirely
 */
async function sendFallbackText(to: string, text: string) {
    const apiUrl = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
    const apiToken = process.env.WHATSAPP_API_TOKEN || "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";

    try {
        await fetch(`${apiUrl}/${phoneNumberId}/messages`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to,
                type: "text",
                text: { body: text },
            }),
        });
    } catch (e) {
        console.error("[Fallback] Failed to send error message:", e);
    }
}

export function startServer() {
    app.listen(port, () => {
        console.log(`🚀 ToolTap server listening on port ${port}`);
    });
}
