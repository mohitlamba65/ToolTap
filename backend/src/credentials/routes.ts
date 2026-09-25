import type { Request, Response } from "express";
import { Router } from "express";
import { whatsappCredentials } from "./whatsapp-store.js";
import { graphApiBase } from "../whatsapp/cloud-config.js";

export const whatsappCredentialRouter = Router();

function publicBaseUrl(req: Request): string {
    const fromEnv = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    if (fromEnv) return fromEnv;
    const protoRaw = req.get("x-forwarded-proto") || req.protocol || "http";
    const hostRaw = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
    const proto = protoRaw.split(",")[0]?.trim() || "http";
    const host = hostRaw.split(",")[0]?.trim() || "localhost:3000";
    return `${proto}://${host}`;
}

whatsappCredentialRouter.get("/credentials", async (_req: Request, res: Response) => {
    try {
        const credentials = await whatsappCredentials.list();
        res.json({ credentials });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

whatsappCredentialRouter.post("/credentials", async (req: Request, res: Response) => {
    try {
        const {
            name,
            accessToken,
            phoneNumberId,
            displayPhoneNumber,
            verifiedName,
            whatsappBusinessAccountId,
        } = req.body || {};
        if (!accessToken || !phoneNumberId || !displayPhoneNumber) {
            return res.status(400).json({
                error: "accessToken, phoneNumberId, and displayPhoneNumber are required. Verify the number with Meta first.",
            });
        }
        const duplicate = await whatsappCredentials.findByPhoneNumberId(String(phoneNumberId));
        if (duplicate) {
            return res.status(409).json({ error: "A number with this Phone number ID is already connected." });
        }
        const credential = await whatsappCredentials.create({
            name: String(name || "").trim() || "WhatsApp number",
            accessToken: String(accessToken).trim(),
            phoneNumberId: String(phoneNumberId).trim(),
            displayPhoneNumber: String(displayPhoneNumber).trim(),
            ...(verifiedName ? { verifiedName: String(verifiedName) } : {}),
            ...(whatsappBusinessAccountId
                ? { whatsappBusinessAccountId: String(whatsappBusinessAccountId).trim() }
                : {}),
        });
        res.status(201).json({ success: true, credential });
    } catch (e: any) {
        const msg = e?.message || String(e);
        if (String(msg).includes("INTEGRATION_ENCRYPTION_KEY")) {
            return res.status(503).json({
                error: "Set INTEGRATION_ENCRYPTION_KEY in the server environment (32-byte key) and restart.",
            });
        }
        if (String(msg).includes("unique") || String(msg).includes("duplicate")) {
            return res.status(409).json({ error: "A credential with this name already exists." });
        }
        res.status(500).json({ error: msg });
    }
});

whatsappCredentialRouter.delete("/credentials/:id", async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ error: "ID is required" });
    try {
        const deleted = await whatsappCredentials.delete(id);
        res.json({ success: deleted });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

whatsappCredentialRouter.post("/credentials/:id/activate", async (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ error: "ID is required" });
    try {
        const credential = await whatsappCredentials.activate(id);
        if (!credential) return res.status(404).json({ error: "Number not found" });
        res.json({ success: true, credential });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

whatsappCredentialRouter.post("/phone-number", async (req: Request, res: Response) => {
    try {
        const accessToken = String(req.body?.accessToken || req.body?.systemToken || "").trim();
        const phoneNumberId = String(req.body?.phoneNumberId || "").trim();
        if (!accessToken || !phoneNumberId) {
            return res.status(400).json({ error: "accessToken and phoneNumberId are required." });
        }
        const metaUrl = `${graphApiBase()}/${phoneNumberId}?fields=display_phone_number,verified_name`;
        const metaResponse = await fetch(metaUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!metaResponse.ok) {
            const errorBody = await metaResponse.json().catch(() => ({}));
            const metaError = (errorBody as any)?.error;
            if (metaResponse.status === 400 || metaResponse.status === 404) {
                return res.status(400).json({
                    error: metaError?.message || "Phone Number ID is invalid or not accessible with this token.",
                });
            }
            if (metaResponse.status === 401 || metaResponse.status === 403) {
                return res.status(401).json({
                    error: "The access token is invalid or missing WhatsApp permissions.",
                });
            }
            return res.status(502).json({
                error: metaError?.message || "Failed to communicate with Meta API.",
            });
        }
        const data = (await metaResponse.json()) as { display_phone_number?: string; verified_name?: string };
        if (!data.display_phone_number) {
            return res.status(404).json({ error: "Could not resolve a display phone number for this ID." });
        }
        const cleanNumber = data.display_phone_number.replace(/[\s\-()]/g, "");
        res.json({
            displayPhoneNumber: cleanNumber,
            formattedPhoneNumber: data.display_phone_number,
            verifiedName: data.verified_name || null,
        });
    } catch (e: any) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

whatsappCredentialRouter.get("/webhook-config", (req: Request, res: Response) => {
    const base = publicBaseUrl(req);
    const custom = process.env.WEBHOOK_URL?.trim();
    const defaultPath = "/api/webhooks/whatsapp";
    const asUrl = (path: string) => `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const callbackUrl = custom && /^https?:\/\//i.test(custom)
        ? custom.replace(/\/$/, "")
        : asUrl(defaultPath);
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || "";
    res.json({
        callbackUrl,
        fallbackCallbackUrl: asUrl(defaultPath),
        perNumberPathHint: `${asUrl(defaultPath)}/:credentialId`,
        usesCustomWebhookPath: Boolean(custom && /^https?:\/\//i.test(custom) && callbackUrl !== asUrl(defaultPath)),
        verifyToken,
        verifyTokenConfigured: Boolean(verifyToken),
    });
});
