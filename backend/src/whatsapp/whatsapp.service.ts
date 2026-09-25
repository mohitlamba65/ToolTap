import { resolveWhatsAppCloud, graphApiBase } from "./cloud-config.js";

export class WhatsAppService {
    private readonly apiUrl: string;

    constructor() {
        this.apiUrl = graphApiBase();
    }

    async sendText(to: string, text: string): Promise<string> {
        const cloud = await resolveWhatsAppCloud();
        if (!cloud) {
            throw new Error("No WhatsApp Cloud credentials configured. Connect a number in Settings.");
        }
        const payload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { body: text || "..." },
        };

        const url = `${this.apiUrl}/${cloud.phoneNumberId}/messages`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${cloud.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as { messages?: Array<{ id: string }> };
        return data.messages?.[0]?.id ?? "";
    }
}
