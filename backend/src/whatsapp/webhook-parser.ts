import type { InboundMessage } from "../graph/types.js";

/**
 * Parses incoming Meta WhatsApp webhook payloads into normalized InboundMessage objects.
 * 
 * Supports ALL message types:
 * - text, image, audio, video, document, sticker
 * - button (quick reply), interactive (list/button reply)
 * - location, contacts, reaction
 * - unsupported, system, edit, revoke
 */
export function parseMetaWebhook(body: any): InboundMessage[] {
    const messages: InboundMessage[] = [];

    if (body.object !== "whatsapp_business_account") return messages;

    for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
            const value = change.value;
            if (!value.messages || value.messages.length === 0) continue;

            // Get profile name from contacts
            const contactsMap = new Map<string, string>();
            for (const contact of value.contacts || []) {
                contactsMap.set(contact.wa_id, contact.profile?.name || "");
            }

            for (const msg of value.messages) {
                const base: InboundMessage = {
                    from: msg.from,
                    messageId: msg.id,
                    timestamp: msg.timestamp,
                    type: "text",
                    profileName: contactsMap.get(msg.from) || "",
                };

                switch (msg.type) {
                    case "text":
                        base.type = "text";
                        base.text = msg.text?.body || "";
                        break;

                    case "button":
                        // Quick reply button tapped on a template
                        base.type = "button_reply";
                        base.buttonReply = {
                            id: msg.button?.payload || "",
                            title: msg.button?.text || "",
                        };
                        base.text = msg.button?.text || "";
                        break;

                    case "interactive":
                        if (msg.interactive?.type === "button_reply") {
                            base.type = "button_reply";
                            base.buttonReply = {
                                id: msg.interactive.button_reply?.id || "",
                                title: msg.interactive.button_reply?.title || "",
                            };
                            base.text = msg.interactive.button_reply?.title || "";
                        } else if (msg.interactive?.type === "list_reply") {
                            base.type = "list_reply";
                            base.listReply = {
                                id: msg.interactive.list_reply?.id || "",
                                title: msg.interactive.list_reply?.title || "",
                                description: msg.interactive.list_reply?.description,
                            };
                            base.text = msg.interactive.list_reply?.title || "";
                        }
                        break;

                    case "image":
                        base.type = "image";
                        base.mediaId = msg.image?.id;
                        base.mediaUrl = msg.image?.url;
                        base.mimeType = msg.image?.mime_type;
                        base.caption = msg.image?.caption;
                        base.text = msg.image?.caption || "[User sent an image]";
                        break;

                    case "audio":
                        base.type = "audio";
                        base.mediaId = msg.audio?.id;
                        base.mediaUrl = msg.audio?.url;
                        base.mimeType = msg.audio?.mime_type;
                        base.text = "[User sent a voice note]";
                        break;

                    case "video":
                        base.type = "video";
                        base.mediaId = msg.video?.id;
                        base.mediaUrl = msg.video?.url;
                        base.mimeType = msg.video?.mime_type;
                        base.caption = msg.video?.caption;
                        base.text = msg.video?.caption || "[User sent a video]";
                        break;

                    case "document":
                        base.type = "document";
                        base.mediaId = msg.document?.id;
                        base.mediaUrl = msg.document?.url;
                        base.mimeType = msg.document?.mime_type;
                        base.caption = msg.document?.caption;
                        base.filename = msg.document?.filename;
                        base.text = msg.document?.caption || `[User sent a document: ${msg.document?.filename || "unknown"}]`;
                        break;

                    case "location":
                        base.type = "location";
                        base.location = {
                            latitude: msg.location?.latitude,
                            longitude: msg.location?.longitude,
                            name: msg.location?.name,
                            address: msg.location?.address,
                        };
                        base.text = `[User shared a location: ${msg.location?.name || ""} ${msg.location?.address || `${msg.location?.latitude}, ${msg.location?.longitude}`}]`;
                        break;

                    case "contacts":
                        base.type = "contacts";
                        const contactNames = (msg.contacts || [])
                            .map((c: any) => c.name?.formatted_name || "Unknown")
                            .join(", ");
                        base.text = `[User shared contacts: ${contactNames}]`;
                        break;

                    case "reaction":
                        base.type = "reaction";
                        base.text = msg.reaction?.emoji
                            ? `[User reacted with ${msg.reaction.emoji}]`
                            : "[User removed their reaction]";
                        break;

                    case "sticker":
                        base.type = "unsupported";
                        base.text = "[User sent a sticker]";
                        break;

                    default:
                        base.type = "unsupported";
                        base.text = `[Unsupported message type: ${msg.type}]`;
                        break;
                }

                messages.push(base);
            }
        }
    }

    return messages;
}
