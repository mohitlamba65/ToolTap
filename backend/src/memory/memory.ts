import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { InMemoryStore } from "@langchain/langgraph";
import pg from "pg";

const { Pool } = pg;

/**
 * ToolTap Memory Layer
 *
 * Short-term memory  → PostgresSaver   (per-thread conversation checkpoints, survives restarts)
 * Long-term memory   → PostgresStore   (cross-session user facts / preferences, custom impl)
 *
 * Falls back gracefully to MemorySaver + InMemoryStore when Postgres is unavailable (local dev).
 */

let pool: InstanceType<typeof Pool> | null = null;

function buildConnectionString(): string {
    return (
        process.env.POSTGRES_URL ??
        `postgresql://${process.env.POSTGRES_USER ?? "tooltap"}:${process.env.POSTGRES_PASSWORD ?? "tooltap_secret"}@${process.env.POSTGRES_HOST ?? "localhost"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "tooltap"}?sslmode=disable`
    );
}

function getPool(): InstanceType<typeof Pool> {
    if (!pool) {
        const connStr = buildConnectionString(); // includes ?sslmode=disable
        pool = new Pool({
            connectionString: connStr,
            ssl: false,
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
        pool.on("error", (err) => {
            console.error("[Memory] Postgres pool error:", err.message);
        });
    }
    return pool;
}

/**
 * Lightweight Postgres-backed long-term store.
 *
 * Stores arbitrary JSON values keyed by (namespace[], key).
 * Used to persist cross-session user preferences, profile data, and summaries.
 *
 * Table: tooltap_store
 *   namespace TEXT   — dot-joined namespace array (e.g. "user.+1234567890")
 *   key       TEXT   — item key (e.g. "profile", "preferences")
 *   value     JSONB  — stored data
 *   updated_at TIMESTAMPTZ
 */
export class PostgresStore {
    constructor(private readonly pool: InstanceType<typeof Pool>) {}

    async setup(): Promise<void> {
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS tooltap_store (
                namespace TEXT NOT NULL,
                key       TEXT NOT NULL,
                value     JSONB NOT NULL DEFAULT '{}',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (namespace, key)
            );
        `);
    }

    async put(namespace: string[], key: string, value: Record<string, any>): Promise<void> {
        const ns = namespace.join(".");
        await this.pool.query(
            `INSERT INTO tooltap_store (namespace, key, value, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (namespace, key) DO UPDATE
             SET value = $3, updated_at = NOW()`,
            [ns, key, JSON.stringify(value)]
        );
    }

    async get(namespace: string[], key: string): Promise<Record<string, any> | null> {
        const ns = namespace.join(".");
        const result = await this.pool.query(
            `SELECT value FROM tooltap_store WHERE namespace = $1 AND key = $2`,
            [ns, key]
        );
        return result.rows[0]?.value ?? null;
    }

    async search(namespace: string[]): Promise<Array<{ key: string; value: Record<string, any> }>> {
        const ns = namespace.join(".");
        const result = await this.pool.query(
            `SELECT key, value FROM tooltap_store WHERE namespace = $1 ORDER BY updated_at DESC`,
            [ns]
        );
        return result.rows.map((r) => ({ key: r.key, value: r.value }));
    }

    async delete(namespace: string[], key: string): Promise<void> {
        const ns = namespace.join(".");
        await this.pool.query(
            `DELETE FROM tooltap_store WHERE namespace = $1 AND key = $2`,
            [ns, key]
        );
    }
}

let checkpointerInstance: PostgresSaver | null = null;
let storeInstance: PostgresStore | null = null;
let ready = false;

/**
 * Initialise memory — creates tables if they don't exist.
 * Call once at server startup before handling any requests.
 *
 * Returns PostgresSaver + PostgresStore on success.
 * Throws on connection failure so the caller can fall back to in-process memory.
 */
export async function setupMemory(): Promise<{
    checkpointer: PostgresSaver;
    store: PostgresStore;
}> {
    if (ready && checkpointerInstance && storeInstance) {
        return { checkpointer: checkpointerInstance, store: storeInstance };
    }

    const connStr = buildConnectionString();

    // Short-term: per-thread conversation checkpoints
    checkpointerInstance = PostgresSaver.fromConnString(connStr);
    await checkpointerInstance.setup();

    // Long-term: cross-session persistent store
    storeInstance = new PostgresStore(getPool());
    await storeInstance.setup();

    ready = true;
    console.log("✅ [Memory] PostgresSaver (short-term) + PostgresStore (long-term) ready");
    return { checkpointer: checkpointerInstance, store: storeInstance };
}

export function getCheckpointer(): PostgresSaver | null {
    return checkpointerInstance;
}

export function getStore(): PostgresStore | null {
    return storeInstance;
}

/**
 * Create a fallback in-memory store compatible with the graph API.
 */
export function createInMemoryStore(): InMemoryStore {
    return new InMemoryStore();
}

/**
 * Gracefully close the Postgres pool on process exit.
 */
export async function closeMemory(): Promise<void> {
    if (pool) {
        await pool.end();
        console.log("[Memory] Postgres pool closed");
    }
}
