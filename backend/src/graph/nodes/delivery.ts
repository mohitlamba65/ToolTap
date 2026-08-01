import type { AgentState } from "../state.js";
import type {
    ResponseIntent,
    WhatsAppPayload,
    WhatsAppTextPayload,
    WhatsAppButtonsPayload,
    WhatsAppListPayload,
    WhatsAppImagePayload,
    WhatsAppDocumentPayload,
    WhatsAppVideoPayload,
    WhatsAppAudioPayload,
    WhatsAppStickerPayload,
    WhatsAppLocationRequestPayload,
    WhatsAppReactionPayload,
} from "../types.js";

import { generateSpeechAudio, uploadAudioToMeta } from "../../utils/tts.js";

/**
 * Ensures standard Markdown (e.g. **bold**, ### Header) is converted to WhatsApp syntax.
 * WhatsApp uses *bold* (single asterisk), _italic_ (single underscore).
 * Double asterisks **text** result in literal asterisks showing around text on WhatsApp screens.
 */
export function sanitizeWhatsAppMarkdown(text: string | undefined): string {
    if (!text) return "";
    return text
        .replace(/^#{1,6}\s+(.+)$/gm, "*$1*")
        .replace(/\*\*(.*?)\*\*/g, "*$1*")
        .replace(/__(.*?)__/g, "_$1_");
}

/**
 * Delivery Node: Converts the ResponseIntent into a WhatsApp API payload
 * and sends it via the WhatsApp Cloud API.
 * 
 * This node is the final step in the graph — it takes the LLM's format
 * decision and constructs the exact JSON payload Meta expects.
 */
export async function deliveryNode(state: AgentState): Promise<Partial<AgentState>> {
    const { responseIntent, recipientPhone } = state;

    if (!responseIntent || !recipientPhone) {
        console.error("[DeliveryNode] Missing responseIntent or recipientPhone");
        return {};
    }

    // Sanitize all text fields for WhatsApp Markdown syntax (**bold** -> *bold*)
    if (responseIntent.text) responseIntent.text = sanitizeWhatsAppMarkdown(responseIntent.text);
    if (responseIntent.header) responseIntent.header = sanitizeWhatsAppMarkdown(responseIntent.header);
    if (responseIntent.footer) responseIntent.footer = sanitizeWhatsAppMarkdown(responseIntent.footer);
    if (responseIntent.caption) responseIntent.caption = sanitizeWhatsAppMarkdown(responseIntent.caption);
    if (responseIntent.buttons) {
        responseIntent.buttons.forEach((b) => {
            if (b.title) b.title = sanitizeWhatsAppMarkdown(b.title);
        });
    }
    if (responseIntent.listSections) {
        responseIntent.listSections.forEach((s) => {
            if (s.title) s.title = sanitizeWhatsAppMarkdown(s.title);
            s.rows.forEach((r) => {
                if (r.title) r.title = sanitizeWhatsAppMarkdown(r.title);
                if (r.description) r.description = sanitizeWhatsAppMarkdown(r.description);
            });
        });
    }

    // ── Text-To-Speech (TTS) Voice Generation ─────────────────────────────────
    // If messageType is audio and no media URL/ID was provided, synthesize speech via OpenAI TTS
    if (responseIntent.messageType === "audio" && !responseIntent.mediaId && !responseIntent.mediaUrl) {
        console.log(`🎙️ [DeliveryNode] Generating Text-To-Speech audio output for response...`);
        const audioBuffer = await generateSpeechAudio(responseIntent.text);
        if (audioBuffer) {
            const mediaId = await uploadAudioToMeta(audioBuffer, "audio/mpeg");
            if (mediaId) {
                responseIntent.mediaId = mediaId;
                console.log(`✅ [DeliveryNode] Voice audio uploaded to Meta with Media ID: ${mediaId}`);
            }
        }
    }

    const provider = (process.env.WHATSAPP_PROVIDER || "meta").toLowerCase();

    if (provider === "twilio") {
        const textContent = extractTextFromIntent(responseIntent);
        await sendToTwilio(recipientPhone, textContent);
        return {};
    }

    const payload = buildPayload(responseIntent, recipientPhone);
    await sendToWhatsApp(payload);

    return { whatsappPayload: payload };
}


function extractTextFromIntent(intent: ResponseIntent): string {
    let text = intent.text || "";
    if (intent.header) text = `*${intent.header}*\n\n` + text;
    if (intent.buttons && intent.buttons.length > 0) {
        text += `\n\n📌 Options:\n` + intent.buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
    } else if (intent.listSections && intent.listSections.length > 0) {
        text += `\n\n📋 Options:\n`;
        intent.listSections.forEach(s => {
            text += `*${s.title}*\n` + s.rows.map(r => `• ${r.title}${r.description ? `: ${r.description}` : ""}`).join("\n") + "\n";
        });
    }
    if (intent.footer) text += `\n\n_${intent.footer}_`;
    return text;
}

async function sendToTwilio(to: string, bodyText: string): Promise<void> {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || "+14155238886";

    if (!accountSid || !authToken) {
        console.error("❌ [DeliveryNode] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing in .env");
        return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const cleanTo = to.replace("whatsapp:", "").replace("+", "").trim();
    const formattedTo = `whatsapp:+${cleanTo}`;
    const cleanFrom = fromNumber.replace("whatsapp:", "").replace("+", "").trim();
    const formattedFrom = `whatsapp:+${cleanFrom}`;

    const params = new URLSearchParams();
    params.append("From", formattedFrom);
    params.append("To", formattedTo);
    params.append("Body", bodyText);

    const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: authHeader,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`❌ [DeliveryNode] Twilio API Error (${response.status}): ${errText}`);
        } else {
            const data = await response.json() as any;
            console.log(`✅ [DeliveryNode] Twilio WhatsApp message sent to ${formattedTo}: ${data.sid}`);
        }
    } catch (e) {
        console.error("❌ [DeliveryNode] Twilio network error:", e);
    }
}

/**
 * Builds the correct WhatsApp API payload based on the ResponseIntent.
 */
function buildPayload(intent: ResponseIntent, to: string): WhatsAppPayload {
    switch (intent.messageType) {
        case "buttons":
            return buildButtonsPayload(intent, to);
        case "list":
            return buildListPayload(intent, to);
        case "image":
            return buildImagePayload(intent, to);
        case "document":
            return buildDocumentPayload(intent, to);
        case "video":
            return buildVideoPayload(intent, to);
        case "audio":
            return buildAudioPayload(intent, to);
        case "sticker":
            return buildStickerPayload(intent, to);
        case "location_request":
            return buildLocationRequestPayload(intent, to);
        case "reaction":
            return buildReactionPayload(intent, to);
        case "text":
        default:
            return buildTextPayload(intent, to);
    }
}

function buildTextPayload(intent: ResponseIntent, to: string): WhatsAppTextPayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: intent.text || "..." },
    };
}

/**
 * Smart word-boundary truncation.
 * Unlike .slice(0, N), this breaks at the last complete word before the limit
 * so labels read naturally rather than mid-word (e.g. "SLA Govern" not "SLA Governanc").
 * Appends "…" only when actual truncation occurs and there's room.
 */
function smartTrunc(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    // Try to break at last space before maxLen
    const lastSpace = text.lastIndexOf(" ", maxLen - 1);
    if (lastSpace > maxLen / 2) {
        // Good break point found — trim trailing punctuation and add ellipsis if room
        const cut = text.slice(0, lastSpace).replace(/[,;:]+$/, "");
        return cut.length <= maxLen - 1 ? cut + "…" : cut.slice(0, maxLen);
    }
    // No good word break — hard truncate with ellipsis if room
    return text.slice(0, maxLen - 1) + "…";
}

function buildButtonsPayload(intent: ResponseIntent, to: string): WhatsAppButtonsPayload {
    const buttons = (intent.buttons || []).slice(0, 3).map((btn) => ({
        type: "reply" as const,
        reply: {
            id: btn.id.slice(0, 256),
            title: smartTrunc(btn.title, 20),
        },
    }));

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
            type: "button",
            ...(intent.header ? { header: { type: "text", text: intent.header.slice(0, 60) } } : {}),
            body: { text: intent.text.slice(0, 1024) },
            ...(intent.footer ? { footer: { text: intent.footer.slice(0, 60) } } : {}),
            action: { buttons },
        },
    };
}

function buildListPayload(intent: ResponseIntent, to: string): WhatsAppListPayload {
    const sections = (intent.listSections || []).map((section) => ({
        title: smartTrunc(section.title, 24),
        rows: section.rows.map((row) => ({
            id: row.id.slice(0, 200),
            title: smartTrunc(row.title, 24),
            ...(row.description ? { description: row.description.slice(0, 72) } : {}),
        })),
    }));

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
            type: "list",
            ...(intent.header ? { header: { type: "text", text: intent.header.slice(0, 60) } } : {}),
            body: { text: intent.text.slice(0, 1024) },
            ...(intent.footer ? { footer: { text: intent.footer.slice(0, 60) } } : {}),
            action: {
                button: (intent.listButtonText || "View Options").slice(0, 20),
                sections,
            },
        },
    };
}

function buildImagePayload(intent: ResponseIntent, to: string): WhatsAppImagePayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "image",
        image: {
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl || "" }),
            ...(intent.caption ? { caption: intent.caption.slice(0, 1024) } : {}),
        },
    };
}

function buildDocumentPayload(intent: ResponseIntent, to: string): WhatsAppDocumentPayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document: {
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl || "" }),
            ...(intent.caption ? { caption: intent.caption.slice(0, 1024) } : {}),
            ...(intent.filename ? { filename: intent.filename } : {}),
        },
    };
}

function buildVideoPayload(intent: ResponseIntent, to: string): WhatsAppVideoPayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "video",
        video: {
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl || "" }),
            ...(intent.caption ? { caption: intent.caption.slice(0, 1024) } : {}),
        },
    };
}

function buildAudioPayload(intent: ResponseIntent, to: string): WhatsAppAudioPayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "audio",
        audio: {
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl || "" }),
        },
    };
}

function buildStickerPayload(intent: ResponseIntent, to: string): WhatsAppStickerPayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "sticker",
        sticker: {
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl || "" }),
        },
    };
}

/**
 * Sends a native WhatsApp location_request_message.
 * This renders a "Share Location" button inside WhatsApp — the user taps it
 * and their GPS pin is sent back as a location message.
 */
function buildLocationRequestPayload(intent: ResponseIntent, to: string): WhatsAppLocationRequestPayload {
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
            type: "location_request_message",
            body: { text: intent.text.slice(0, 1024) },
            action: { name: "send_location" },
        },
    };
}

function buildReactionPayload(intent: ResponseIntent, to: string): WhatsAppReactionPayload {
    return {
        messaging_product: "whatsapp",
        to,
        type: "reaction",
        reaction: {
            message_id: intent.reactionMessageId || "",
            emoji: intent.reactionEmoji || "👍",
        },
    };
}

/**
 * Sends the constructed payload to Meta's WhatsApp Cloud API.
 */
async function sendToWhatsApp(payload: WhatsAppPayload): Promise<void> {
    const apiUrl = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
    const apiToken = process.env.WHATSAPP_API_TOKEN || "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";

    const url = `${apiUrl}/${phoneNumberId}/messages`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            let parsedError: any = {};
            try { parsedError = JSON.parse(errorText); } catch (_) {}
            
            const errDetail = parsedError?.error?.error_data?.details || parsedError?.error?.message || errorText;
            const errCode = parsedError?.error?.code;

            console.error(`❌ [DeliveryNode] Meta WhatsApp API Error (${response.status}): Code ${errCode} - ${errDetail}`);
            
            if (errCode === 131030) {
                console.error(`💡 [Meta Setup Required]: Phone number ${payload.to} is NOT in your Meta Developer Portal test recipient list.`);
                console.error(`👉 Fix: Go to Meta Developers Portal -> WhatsApp -> API Setup -> Add phone number '${payload.to}' to 'To' list & enter OTP.`);
            } else if (errCode === 190) {
                console.error(`💡 [Meta Setup Required]: Your WHATSAPP_API_TOKEN has expired.`);
                console.error(`👉 Fix: Generate a new Temporary/Permanent Access Token in Meta Developers Portal & update WHATSAPP_API_TOKEN in .env.`);
            }

            // Fall back to plain text if interactive/image/document failed
            if (payload.type === "interactive" || payload.type === "image" || payload.type === "document") {
                console.log("🔄 [DeliveryNode] Attempting text fallback delivery...");
                const textBody = "text" in payload 
                    ? (payload as any).text?.body
                    : (payload as any).interactive?.body?.text || "I encountered an error formatting my response.";
                
                const fallbackPayload: WhatsAppTextPayload = {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: payload.to,
                    type: "text",
                    text: { body: textBody },
                };
                
                const fbRes = await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(fallbackPayload),
                });

                if (fbRes.ok) {
                    const fbData = await fbRes.json() as any;
                    console.log(`✅ [DeliveryNode] Fallback text message delivered successfully: ${fbData.messages?.[0]?.id}`);
                } else {
                    const fbErr = await fbRes.text();
                    console.error(`❌ [DeliveryNode] Fallback text message also failed: ${fbErr}`);
                }
            }
        } else {
            const data = await response.json() as any;
            console.log(`✅ [DeliveryNode] Message sent (${payload.type}) to ${payload.to}: ${data.messages?.[0]?.id}`);
        }
    } catch (error) {
        console.error("❌ [DeliveryNode] Network error:", error);
    }
}
