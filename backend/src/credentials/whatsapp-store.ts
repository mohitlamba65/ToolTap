import { randomUUID } from "node:crypto";
import { getPool } from "../memory/memory.js";
import { CredentialSecretCrypto } from "./crypto.js";

const LOCAL_ORG = "local";

export interface WhatsAppCredentialMetadata {
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName?: string;
    whatsappBusinessAccountId?: string;
}

export interface WhatsAppSecret {
    accessToken: string;
    phoneNumberId: string;
}

export interface WhatsAppCredentialView {
    id: string;
    orgId: string;
    name: string;
    type: "WHATSAPP_CLOUD";
    metadata: WhatsAppCredentialMetadata;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    revokedAt: string | null;
}

export interface ResolvedWhatsAppCloud {
    accessToken: string;
    phoneNumberId: string;
    displayPhoneNumber: string | null;
    credentialId: string | null;
    source: "db" | "env";
}

interface CredentialRow {
    id: string;
    org_id: string;
    name: string;
    ciphertext: Buffer;
    iv: Buffer;
    auth_tag: Buffer;
    key_version: number;
    metadata: WhatsAppCredentialMetadata;
    is_active: boolean;
    revoked_at: Date | null;
    created_at: Date;
    updated_at: Date;
}

function toView(row: CredentialRow): WhatsAppCredentialView {
    return {
        id: row.id,
        orgId: row.org_id,
        name: row.name,
        type: "WHATSAPP_CLOUD",
        metadata: row.metadata || { phoneNumberId: "", displayPhoneNumber: "" },
        isActive: row.is_active,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        revokedAt: row.revoked_at ? row.revoked_at.toISOString() : null,
    };
}

function getCrypto(): CredentialSecretCrypto {
    return CredentialSecretCrypto.fromEnv();
}

export class WhatsAppCredentialStore {
    private ready: Promise<void> | null = null;

    async ensureReady(): Promise<void> {
        if (!this.ready) {
            this.ready = this.setupSchema().catch((err) => {
                this.ready = null;
                throw err;
            });
        }
        return this.ready;
    }

    private async setupSchema(): Promise<void> {
        const pool = getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_credentials (
                id UUID PRIMARY KEY,
                org_id TEXT NOT NULL DEFAULT 'local',
                name TEXT NOT NULL,
                ciphertext BYTEA NOT NULL,
                iv BYTEA NOT NULL,
                auth_tag BYTEA NOT NULL,
                key_version INT NOT NULL DEFAULT 1,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                is_active BOOLEAN NOT NULL DEFAULT false,
                revoked_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE (org_id, name)
            )
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS whatsapp_credentials_org_active_idx
            ON whatsapp_credentials (org_id, is_active)
        `);
        await pool.query(`
            CREATE INDEX IF NOT EXISTS whatsapp_credentials_phone_idx
            ON whatsapp_credentials ((metadata->>'phoneNumberId'))
        `);
        console.log("✅ [WhatsApp credentials] Table ready");
    }

    async list(orgId = LOCAL_ORG): Promise<WhatsAppCredentialView[]> {
        await this.ensureReady();
        const result = await getPool().query(
            `SELECT * FROM whatsapp_credentials
             WHERE org_id = $1 AND revoked_at IS NULL
             ORDER BY is_active DESC, updated_at DESC`,
            [orgId]
        );
        return result.rows.map((row) => toView(row as CredentialRow));
    }

    async getById(id: string, orgId = LOCAL_ORG): Promise<CredentialRow | null> {
        await this.ensureReady();
        const result = await getPool().query(
            `SELECT * FROM whatsapp_credentials WHERE id = $1 AND org_id = $2 AND revoked_at IS NULL`,
            [id, orgId]
        );
        return (result.rows[0] as CredentialRow) || null;
    }

    async getActive(orgId = LOCAL_ORG): Promise<CredentialRow | null> {
        await this.ensureReady();
        const result = await getPool().query(
            `SELECT * FROM whatsapp_credentials
             WHERE org_id = $1 AND is_active = true AND revoked_at IS NULL
             ORDER BY updated_at DESC LIMIT 1`,
            [orgId]
        );
        return (result.rows[0] as CredentialRow) || null;
    }

    async findByPhoneNumberId(phoneNumberId: string, orgId = LOCAL_ORG): Promise<CredentialRow | null> {
        await this.ensureReady();
        const result = await getPool().query(
            `SELECT * FROM whatsapp_credentials
             WHERE org_id = $1 AND revoked_at IS NULL AND metadata->>'phoneNumberId' = $2
             ORDER BY is_active DESC, updated_at DESC LIMIT 1`,
            [orgId, phoneNumberId]
        );
        return (result.rows[0] as CredentialRow) || null;
    }

    decryptSecret(row: CredentialRow): WhatsAppSecret {
        const crypto = getCrypto();
        const json = crypto.decryptToString({
            ciphertext: row.ciphertext,
            iv: row.iv,
            authTag: row.auth_tag,
            keyVersion: row.key_version,
        });
        const parsed = JSON.parse(json) as Record<string, unknown>;
        const accessToken = String(parsed.accessToken || parsed.systemToken || "");
        const phoneNumberId = String(parsed.phoneNumberId || row.metadata?.phoneNumberId || "");
        if (!accessToken || !phoneNumberId) {
            throw new Error("Stored WhatsApp secret is missing accessToken or phoneNumberId");
        }
        return { accessToken, phoneNumberId };
    }

    async create(input: {
        name: string;
        accessToken: string;
        phoneNumberId: string;
        displayPhoneNumber: string;
        verifiedName?: string;
        whatsappBusinessAccountId?: string;
        orgId?: string;
    }): Promise<WhatsAppCredentialView> {
        await this.ensureReady();
        const orgId = input.orgId || LOCAL_ORG;
        const name = input.name.trim() || "WhatsApp number";
        const crypto = getCrypto();
        const payload = crypto.encryptString(
            JSON.stringify({
                accessToken: input.accessToken,
                phoneNumberId: input.phoneNumberId,
            })
        );
        const existing = await this.list(orgId);
        const makeActive = existing.length === 0;
        const id = randomUUID();
        const metadata: WhatsAppCredentialMetadata = {
            phoneNumberId: input.phoneNumberId,
            displayPhoneNumber: input.displayPhoneNumber,
            ...(input.verifiedName ? { verifiedName: input.verifiedName } : {}),
            ...(input.whatsappBusinessAccountId
                ? { whatsappBusinessAccountId: input.whatsappBusinessAccountId }
                : {}),
        };
        const result = await getPool().query(
            `INSERT INTO whatsapp_credentials
                (id, org_id, name, ciphertext, iv, auth_tag, key_version, metadata, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
             RETURNING *`,
            [
                id,
                orgId,
                name,
                payload.ciphertext,
                payload.iv,
                payload.authTag,
                payload.keyVersion,
                JSON.stringify(metadata),
                makeActive,
            ]
        );
        return toView(result.rows[0] as CredentialRow);
    }

    async activate(id: string, orgId = LOCAL_ORG): Promise<WhatsAppCredentialView | null> {
        await this.ensureReady();
        const row = await this.getById(id, orgId);
        if (!row) return null;
        const pool = getPool();
        await pool.query(
            `UPDATE whatsapp_credentials SET is_active = false, updated_at = NOW() WHERE org_id = $1 AND revoked_at IS NULL`,
            [orgId]
        );
        const result = await pool.query(
            `UPDATE whatsapp_credentials SET is_active = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        return toView(result.rows[0] as CredentialRow);
    }

    async delete(id: string, orgId = LOCAL_ORG): Promise<boolean> {
        await this.ensureReady();
        const row = await this.getById(id, orgId);
        if (!row) return false;
        const pool = getPool();
        await pool.query(`DELETE FROM whatsapp_credentials WHERE id = $1 AND org_id = $2`, [id, orgId]);
        if (row.is_active) {
            const next = await pool.query(
                `SELECT id FROM whatsapp_credentials
                 WHERE org_id = $1 AND revoked_at IS NULL
                 ORDER BY updated_at DESC LIMIT 1`,
                [orgId]
            );
            const nextId = next.rows[0]?.id;
            if (nextId) {
                await pool.query(`UPDATE whatsapp_credentials SET is_active = true, updated_at = NOW() WHERE id = $1`, [
                    nextId,
                ]);
            }
        }
        return true;
    }

    /**
     * 1. Match inbound phone_number_id
     * 2. Else explicit credential id
     * 3. Else active row
     * 4. Else env fallback
     */
    async resolve(opts?: {
        phoneNumberId?: string | undefined;
        credentialId?: string | undefined;
    }): Promise<ResolvedWhatsAppCloud | null> {
        try {
            await this.ensureReady();
        } catch (err: any) {
            console.warn("[WhatsApp credentials] Store unavailable:", err?.message || err);
            return envFallback();
        }

        if (opts?.credentialId) {
            const byId = await this.getById(opts.credentialId);
            if (byId) return this.rowToResolved(byId);
        }
        if (opts?.phoneNumberId) {
            const byPhone = await this.findByPhoneNumberId(opts.phoneNumberId);
            if (byPhone) return this.rowToResolved(byPhone);
        }
        const active = await this.getActive();
        if (active) return this.rowToResolved(active);
        return envFallback();
    }

    private rowToResolved(row: CredentialRow): ResolvedWhatsAppCloud {
        const secret = this.decryptSecret(row);
        return {
            accessToken: secret.accessToken,
            phoneNumberId: secret.phoneNumberId,
            displayPhoneNumber: row.metadata?.displayPhoneNumber || null,
            credentialId: row.id,
            source: "db",
        };
    }
}

function envFallback(): ResolvedWhatsAppCloud | null {
    const accessToken = process.env.WHATSAPP_API_TOKEN || "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    if (!accessToken || !phoneNumberId) return null;
    return {
        accessToken,
        phoneNumberId,
        displayPhoneNumber: process.env.WHATSAPP_DISPLAY_NUMBER || null,
        credentialId: null,
        source: "env",
    };
}

export const whatsappCredentials = new WhatsAppCredentialStore();
