import { whatsappCredentials, type ResolvedWhatsAppCloud } from "../credentials/whatsapp-store.js";

export type { ResolvedWhatsAppCloud };

export async function resolveWhatsAppCloud(opts?: {
    phoneNumberId?: string | undefined;
    credentialId?: string | undefined;
}): Promise<ResolvedWhatsAppCloud | null> {
    return whatsappCredentials.resolve(opts);
}

export function graphApiBase(): string {
    return process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";
}
