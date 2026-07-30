import express from "express";
import type { Request, Response } from "express";
import bodyParser from "body-parser";
import cors from "cors";
import "dotenv/config";
import { createToolTapGraph } from "./graph/graph.js";
import { parseIncomingWebhook } from "./whatsapp/webhook-parser.js";
import { HumanMessage } from "@langchain/core/messages";
import { KnowledgeBaseStore, kbStore } from "./kb/kb-store.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

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

        if (mode === "subscribe" && token === verifyToken && typeof challenge === "string") {
            console.log(`✅ Webhook verified successfully for path: ${req.path}`);
            return res.status(200).send(challenge);
        }
    }
    next();
});

// Universal Webhook Handler (POST /webhook, POST /api/v1/.../webhook, or POST /)
async function handleWebhookPost(req: Request, res: Response) {
    try {
        console.log(`\n📥 [Incoming Webhook] ${req.method} ${req.originalUrl || req.path}`);
        console.log(`📦 [Body]:`, JSON.stringify(req.body));

        // Return 200 fast (TwiML XML for Twilio, EVENT_RECEIVED for Meta)
        const isTwilio = (process.env.WHATSAPP_PROVIDER || "").toLowerCase() === "twilio" || req.body?.From || req.body?.AccountSid;
        if (isTwilio) {
            res.status(200).type("text/xml").send("<Response></Response>");
        } else {
            res.status(200).send("EVENT_RECEIVED");
        }

        const messages = parseIncomingWebhook(req.body);
        if (messages.length === 0) {
            console.warn("⚠️ [Webhook] Webhook received but no message extracted. Check payload structure.");
        }

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
            } else if (type === "audio" && (message.mediaUrl || message.mediaId)) {
                // Voice transcription: fetch audio from Meta and transcribe via Gemini
                const audioUrl = message.mediaUrl || (message.mediaId ? await fetchMetaMediaUrl(message.mediaId) : null);
                if (audioUrl) {
                    const transcript = await transcribeAudio(audioUrl);
                    if (transcript) {
                        console.log(`🎙️ [Transcription] Voice message transcribed: "${transcript}"`);
                        userContent = transcript;
                    } else {
                        userContent = "[User sent a voice message that could not be transcribed. Please ask them to type their message instead.]";
                    }
                }
            } else if (type === "sticker") {
                // Acknowledge sticker warmly and continue
                userContent = "[User sent a sticker — acknowledge it warmly and continue the conversation]";
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
            } catch (error: any) {
                console.error("❌ [Server] Agent invocation error:", error?.stack || error?.message || error);
                await sendFallbackText(from, "I'm sorry, an error occurred while processing your request.");
            }
        }
    } catch (error) {
        console.error("Webhook error:", error);
    }
}

// Register POST Webhook routes
app.use((req: Request, res: Response, next) => {
    if (req.method === "POST") {
        handleWebhookPost(req, res);
        return;
    }
    next();
});

async function sendFallbackText(to: string, text: string) {
    const apiUrl = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
    const apiToken = process.env.WHATSAPP_API_TOKEN || "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";

    try {
        const res = await fetch(`${apiUrl}/${phoneNumberId}/messages`, {
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
        if (!res.ok) {
            const txt = await res.text();
            console.error(`❌ [Server Fallback] Meta API rejected fallback text (${res.status}): ${txt}`);
        } else {
            console.log(`✅ [Server Fallback] Fallback text sent to ${to}`);
        }
    } catch (e) {
        console.error("[Fallback] Failed to send error message:", e);
    }
}

/**
 * Resolves a Meta media ID to a direct download URL using the Media API.
 */
async function fetchMetaMediaUrl(mediaId: string): Promise<string | null> {
    const apiToken = process.env.WHATSAPP_API_TOKEN || "";
    const apiUrl = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
    try {
        const res = await fetch(`${apiUrl}/${mediaId}`, {
            headers: { Authorization: `Bearer ${apiToken}` },
        });
        if (!res.ok) return null;
        const data = await res.json() as any;
        return data.url || null;
    } catch (e) {
        console.error("[fetchMetaMediaUrl] Failed to resolve media URL:", e);
        return null;
    }
}

/**
 * Downloads audio from Meta CDN and transcribes it using the configured transcription provider.
 *
 * TRANSCRIPTION_PROVIDER controls which backend is used:
 *   - "gemini"  → Gemini multimodal REST API (sends base64 inline audio)
 *   - "openai"  → OpenAI Whisper API (sends audio as form-data)
 *   - "github"  → GitHub Models Whisper (same as OpenAI path, uses GITHUB_TOKEN + baseURL)
 *
 * Supports audio/ogg, audio/mpeg, audio/mp4 (WhatsApp voice note formats).
 */
async function transcribeAudio(audioUrl: string): Promise<string | null> {
    const apiToken = process.env.WHATSAPP_API_TOKEN || "";
    const transcriptionProvider = (process.env.TRANSCRIPTION_PROVIDER ?? "gemini").toLowerCase();

    try {
        // Download audio bytes from Meta CDN (requires WhatsApp auth header)
        const audioRes = await fetch(audioUrl, {
            headers: { Authorization: `Bearer ${apiToken}` },
        });
        if (!audioRes.ok) {
            console.error(`[Transcription] Failed to download audio (${audioRes.status})`);
            return null;
        }

        const audioBuffer = await audioRes.arrayBuffer();
        const rawContentType = audioRes.headers.get("content-type") || "audio/ogg";
        const mimeType = rawContentType.split(";")[0].trim();

        // ── Gemini multimodal transcription ──────────────────────────────────
        if (transcriptionProvider === "gemini") {
            const googleKey = process.env.GOOGLE_API_KEY || "";
            if (!googleKey) {
                console.warn("[Transcription] GOOGLE_API_KEY not set — cannot use Gemini transcription.");
                return null;
            }
            const model = process.env.GEMINI_TRANSCRIPTION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
            const audioBase64 = Buffer.from(audioBuffer).toString("base64");
            const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${googleKey}`;
            const body = {
                contents: [{
                    parts: [
                        { inlineData: { mimeType, data: audioBase64 } },
                        { text: "Transcribe the audio message exactly as spoken. Return only the transcribed text, nothing else." },
                    ],
                }],
            };
            const res = await fetch(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error(`[Transcription] Gemini API error (${res.status}): ${errText}`);
                return null;
            }
            const data = await res.json() as any;
            return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
        }

        // ── OpenAI Whisper transcription (also used for GitHub Models) ────────
        if (transcriptionProvider === "openai" || transcriptionProvider === "github") {
            let apiKey: string;
            let baseURL: string;
            let whisperModel: string;

            if (transcriptionProvider === "github") {
                apiKey = process.env.GITHUB_TOKEN || "";
                baseURL = process.env.GITHUB_BASE_URL ?? "https://models.github.ai/inference";
                whisperModel = "openai/whisper-large";
                if (!apiKey) {
                    console.warn("[Transcription] GITHUB_TOKEN not set — cannot use GitHub transcription.");
                    return null;
                }
            } else {
                apiKey = process.env.OPENAI_API_KEY || "";
                baseURL = "https://api.openai.com/v1";
                whisperModel = process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";
                if (!apiKey) {
                    console.warn("[Transcription] OPENAI_API_KEY not set — cannot use OpenAI transcription.");
                    return null;
                }
            }

            // Determine file extension from MIME type
            const ext = mimeType === "audio/ogg" ? "ogg"
                : mimeType === "audio/mpeg" ? "mp3"
                : mimeType === "audio/mp4" ? "mp4"
                : "ogg";

            const formData = new FormData();
            formData.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
            formData.append("model", whisperModel);
            formData.append("response_format", "text");

            const res = await fetch(`${baseURL}/audio/transcriptions`, {
                method: "POST",
                headers: { Authorization: `Bearer ${apiKey}` },
                body: formData,
            });
            if (!res.ok) {
                const errText = await res.text();
                console.error(`[Transcription] ${transcriptionProvider} Whisper error (${res.status}): ${errText}`);
                return null;
            }
            const transcript = await res.text();
            return transcript.trim() || null;
        }

        console.warn(`[Transcription] Unknown TRANSCRIPTION_PROVIDER: "${transcriptionProvider}". Supported: gemini, openai, github`);
        return null;
    } catch (e) {
        console.error("[Transcription] Audio transcription failed:", e);
        return null;
    }
}


export function startServer() {
    const server = app.listen(port, () => {
        console.log(`🚀 ToolTap server listening on port ${port}`);
    });

    // Keep Node process event loop alive indefinitely
    if (typeof process.stdin.setRawMode === "function") {
        process.stdin.resume();
    } else {
        setInterval(() => {}, 60000);
    }

    return server;
}
