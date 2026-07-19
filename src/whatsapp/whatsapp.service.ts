import "dotenv/config";

export class WhatsAppService {
    private readonly apiUrl: string;
    private readonly apiToken: string;
    private readonly phoneNumberId: string;

    constructor() {
        this.apiUrl = process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v19.0';
        this.apiToken = process.env.WHATSAPP_API_TOKEN || '';
        this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    }

    async sendText(to: string, text: string): Promise<string> {
        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { body: text || '...' }
        };

        const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as { messages?: Array<{ id: string }> };
        return data.messages?.[0]?.id ?? '';
    }
}
