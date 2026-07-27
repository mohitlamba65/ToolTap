import express from "express";
import type { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config";
import { createToolTapGraph } from "./graph/graph.js";
import { parseMetaWebhook } from "./whatsapp/webhook-parser.js";
import { HumanMessage } from "@langchain/core/messages";
import { KnowledgeBaseStore, kbStore } from "./kb/kb-store.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Create the LangGraph agent
const graph = createToolTapGraph();
console.log("✅ ToolTap LangGraph agent initialized with Router & Semantic RAG");

// Active provider tracking (meta vs twilio)
let currentProvider = process.env.WHATSAPP_PROVIDER || "meta";

// Per-user thread IDs for conversation persistence
const userThreads = new Map<string, string>();

function getThreadId(phone: string): string {
    if (!userThreads.has(phone)) {
        userThreads.set(phone, `thread_${phone}_${Date.now()}`);
    }
    return userThreads.get(phone)!;
}

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "my_verify_token";

// Provider status & toggle API
app.get("/api/provider", (_req: Request, res: Response) => {
    res.json({ provider: currentProvider });
});

app.post("/api/provider", (req: Request, res: Response) => {
    const { provider } = req.body;
    if (provider === "meta" || provider === "twilio") {
        currentProvider = provider;
        process.env.WHATSAPP_PROVIDER = provider;
        console.log(`🔄 Switched WhatsApp Provider to: ${provider}`);
        res.json({ success: true, provider: currentProvider });
    } else {
        res.status(400).json({ error: "Invalid provider. Must be 'meta' or 'twilio'." });
    }
});

// Chatbot Management REST APIs
app.get("/api/chatbots", (_req: Request, res: Response) => {
    res.json({ chatbots: kbStore.getChatbots() });
});

app.post("/api/chatbots", (req: Request, res: Response) => {
    try {
        const bot = kbStore.saveChatbot(req.body);
        res.json({ success: true, chatbot: bot });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete("/api/chatbots/:id", (req: Request, res: Response) => {
    const deleted = kbStore.deleteChatbot(req.params.id);
    res.json({ success: deleted });
});

// Knowledge Base Ingestion API
app.post("/api/kb/ingest", async (req: Request, res: Response) => {
    try {
        const { collectionName, content, source, title, category, tags } = req.body;
        if (!content || !title) {
            return res.status(400).json({ error: "Title and content are required." });
        }

        const result = await kbStore.ingestDocument(
            collectionName || "kb_default",
            content,
            source || "dashboard_upload",
            title,
            category || "general",
            tags || ["user_upload"]
        );

        res.json({ success: true, result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// RAG Query Testing Endpoint
app.post("/api/kb/query", async (req: Request, res: Response) => {
    try {
        const { chatbotId, query } = req.body;
        if (!chatbotId || !query) {
            return res.status(400).json({ error: "chatbotId and query are required." });
        }

        const result = await kbStore.queryChatbot(chatbotId, query);
        res.json({ success: true, result });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Universal Webhook Verification (GET /webhook, GET /api/v1/..., or GET /)
app.use((req: Request, res: Response, next) => {
    if (req.method === "GET") {
        const mode = req.query["hub.mode"];
        const challenge = req.query["hub.challenge"];
        const token = req.query["hub.verify_token"];

        if (mode === "subscribe" && token === verifyToken) {
            console.log(`✅ Webhook verified successfully for path: ${req.path}`);
            return res.status(200).send(challenge);
        }
    }
    next();
});

// Universal Webhook Handler (POST /webhook, POST /api/v1/.../webhook, or POST /)
async function handleWebhookPost(req: Request, res: Response) {
    try {
        // Return 200 fast to Meta / Twilio
        res.status(200).send("EVENT_RECEIVED");

        const messages = parseMetaWebhook(req.body);

        for (const message of messages) {
            const { from, text, type, profileName } = message;
            console.log(`\n📩 [${type}] from ${from} (${profileName}): ${text}`);

            if (type === "reaction") continue;

            const threadId = getThreadId(from);

            let userContent = text || "";
            if (type === "button_reply" && message.buttonReply) {
                userContent = `[User selected button: "${message.buttonReply.title}" (id: ${message.buttonReply.id})]`;
            } else if (type === "list_reply" && message.listReply) {
                userContent = `[User selected from list: "${message.listReply.title}" (id: ${message.listReply.id})]`;
            } else if (type === "location" && message.location) {
                userContent = `User shared their location: ${message.location.name || ""} ${message.location.address || ""} (lat: ${message.location.latitude}, lon: ${message.location.longitude})`;
            }

            try {
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
                await sendFallbackText(from, "I'm sorry, an error occurred while processing your request.");
            }
        }
    } catch (error) {
        console.error("Webhook error:", error);
    }
}

// Register POST Webhook routes
app.post("/webhook", handleWebhookPost);
app.post("/", handleWebhookPost);
app.use("/api/v1", (req: Request, res: Response, next) => {
    if (req.method === "POST" && (req.path.endsWith("/webhook") || req.path.includes("whatsapp"))) {
        return handleWebhookPost(req, res);
    }
    next();
});

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
