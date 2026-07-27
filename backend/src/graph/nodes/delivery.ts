import type { AgentState } from "../state.js";
import type {
    ResponseIntent,
    WhatsAppPayload,
    WhatsAppTextPayload,
    WhatsAppButtonsPayload,
    WhatsAppListPayload,
    WhatsAppImagePayload,
    WhatsAppDocumentPayload,
} from "../types.js";

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

    const payload = buildPayload(responseIntent, recipientPhone);
    await sendToWhatsApp(payload);

    return { whatsappPayload: payload };
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

function buildButtonsPayload(intent: ResponseIntent, to: string): WhatsAppButtonsPayload {
    const buttons = (intent.buttons || []).slice(0, 3).map((btn) => ({
        type: "reply" as const,
        reply: {
            id: btn.id.slice(0, 256),
            title: btn.title.slice(0, 20),
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
        title: section.title.slice(0, 24),
        rows: section.rows.map((row) => ({
            id: row.id.slice(0, 200),
            title: row.title.slice(0, 24),
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
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl }),
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
            ...(intent.mediaId ? { id: intent.mediaId } : { link: intent.mediaUrl }),
            ...(intent.caption ? { caption: intent.caption.slice(0, 1024) } : {}),
            ...(intent.filename ? { filename: intent.filename } : {}),
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
            console.error(`[DeliveryNode] WhatsApp API error: ${response.status} - ${errorText}`);
            
            // If interactive message fails (e.g. format issue), fall back to text
            if (payload.type === "interactive" || payload.type === "image" || payload.type === "document") {
                console.log("[DeliveryNode] Falling back to text message...");
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
                
                await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(fallbackPayload),
                });
            }
        } else {
            const data = await response.json() as any;
            console.log(`[DeliveryNode] Message sent (${payload.type}): ${data.messages?.[0]?.id}`);
        }
    } catch (error) {
        console.error("[DeliveryNode] Network error:", error);
    }
}
