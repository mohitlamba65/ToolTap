/**
 * WhatsApp Message Types & Response Intent
 * 
 * These types define the structured output the LLM produces
 * to describe WHAT message format to send on WhatsApp.
 */

export interface ButtonOption {
    id: string;
    title: string; // Max 20 chars
}

export interface ListRow {
    id: string;
    title: string;       // Max 24 chars
    description?: string; // Max 72 chars
}

export interface ListSection {
    title: string;   // Max 24 chars
    rows: ListRow[];
}

/**
 * ResponseIntent: The structured output the LLM returns to indicate
 * what type of WhatsApp message to send.
 * 
 * The formatter node reads this and constructs the correct API payload.
 */
export interface ResponseIntent {
    messageType: "text" | "buttons" | "list" | "image" | "document";
    text: string;                // Body text (always required)
    header?: string;             // Optional header for interactive messages
    footer?: string;             // Optional footer text
    buttons?: ButtonOption[];    // For quick reply buttons (max 3)
    listButtonText?: string;     // Button label for list messages (e.g. "View Options")
    listSections?: ListSection[];// For list messages (>3 options)
    mediaUrl?: string;           // For image/document messages
    mediaId?: string;            // Meta media ID alternative
    caption?: string;            // Caption for media messages
    filename?: string;           // Filename for document messages
}

/**
 * WhatsApp API Payload Types (outbound messages)
 */
export interface WhatsAppTextPayload {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
    type: "text";
    text: { body: string };
}

export interface WhatsAppButtonsPayload {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
    type: "interactive";
    interactive: {
        type: "button";
        header?: { type: "text"; text: string };
        body: { text: string };
        footer?: { text: string };
        action: {
            buttons: Array<{
                type: "reply";
                reply: { id: string; title: string };
            }>;
        };
    };
}

export interface WhatsAppListPayload {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
    type: "interactive";
    interactive: {
        type: "list";
        header?: { type: "text"; text: string };
        body: { text: string };
        footer?: { text: string };
        action: {
            button: string;
            sections: Array<{
                title: string;
                rows: Array<{
                    id: string;
                    title: string;
                    description?: string;
                }>;
            }>;
        };
    };
}

export interface WhatsAppImagePayload {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
    type: "image";
    image: {
        link?: string;
        id?: string;
        caption?: string;
    };
}

export interface WhatsAppDocumentPayload {
    messaging_product: "whatsapp";
    recipient_type: "individual";
    to: string;
    type: "document";
    document: {
        link?: string;
        id?: string;
        caption?: string;
        filename?: string;
    };
}

export type WhatsAppPayload =
    | WhatsAppTextPayload
    | WhatsAppButtonsPayload
    | WhatsAppListPayload
    | WhatsAppImagePayload
    | WhatsAppDocumentPayload;

/**
 * Normalized inbound message from webhook
 */
export interface InboundMessage {
    from: string;
    messageId: string;
    timestamp: string;
    type: "text" | "button_reply" | "list_reply" | "image" | "audio" | "document" | "video" | "location" | "contacts" | "reaction" | "unsupported";
    text?: string;
    buttonReply?: { id: string; title: string };
    listReply?: { id: string; title: string; description?: string };
    mediaId?: string;
    mediaUrl?: string;
    mimeType?: string;
    caption?: string;
    filename?: string;
    location?: { latitude: number; longitude: number; name?: string; address?: string };
    profileName?: string;
}
