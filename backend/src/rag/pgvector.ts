import { createEmbeddings } from "./embeddings.js";
import type { EmbeddingsInterface } from "./embeddings.js";
import type { ChunkMetadata, StructuredChunk } from "./types.js";
import { env } from "../config/env.js";
import { getPool } from "../memory/memory.js";

const EMBED_CACHE = new Map<string, { vector: number[]; ts: number }>();
const EMBED_CACHE_TTL_MS = 5 * 60 * 1000;
const EMBED_CACHE_MAX = 500;

async function cachedEmbedQuery(text: string, embedder: EmbeddingsInterface): Promise<number[]> {
    const key = text.trim().toLowerCase().slice(0, 500);
    const cached = EMBED_CACHE.get(key);
    if (cached && Date.now() - cached.ts < EMBED_CACHE_TTL_MS) {
        return cached.vector;
    }
    const vector = await embedder.embedQuery(text);
    if (EMBED_CACHE.size >= EMBED_CACHE_MAX) {
        const oldestKey = EMBED_CACHE.keys().next().value;
        if (oldestKey !== undefined) EMBED_CACHE.delete(oldestKey);
    }
    EMBED_CACHE.set(key, { vector, ts: Date.now() });
    return vector;
}

function toVectorLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
}

/**
 * Postgres + pgvector store for knowledge-base chunks.
 * One table, many collections (chatbot KBs). Vectors survive restarts — no re-embed on boot.
 */
export class PgVectorStore {
    private embeddings = createEmbeddings();
    private ready: Promise<void> | null = null;
    private dimension = env.embeddingDimensions;

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
        try {
            await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
        } catch (err: any) {
            throw new Error(
                `[pgvector] CREATE EXTENSION vector failed. Use the pgvector/pgvector image (see docker-compose.yml). ${err?.message ?? err}`
            );
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS kb_vector_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `);

        const meta = await pool.query("SELECT value FROM kb_vector_meta WHERE key = 'embedding_dimensions'");
        const storedDim = meta.rows[0]?.value ? Number(meta.rows[0].value) : null;

        const tableExists = await pool.query(`
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'kb_chunks'
        `);

        if (tableExists.rowCount && storedDim && storedDim !== this.dimension) {
            console.warn(
                `[pgvector] Stored embedding dim ${storedDim} != configured ${this.dimension}. Recreating kb_chunks (re-ingest documents after this).`
            );
            await pool.query("DROP TABLE IF EXISTS kb_chunks");
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS kb_chunks (
                id TEXT PRIMARY KEY,
                collection_name TEXT NOT NULL,
                document_id TEXT,
                text TEXT NOT NULL,
                embedding vector(${this.dimension}) NOT NULL,
                metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS kb_chunks_collection_idx ON kb_chunks (collection_name)
        `);

        try {
            await pool.query(`
                CREATE INDEX IF NOT EXISTS kb_chunks_embedding_hnsw
                ON kb_chunks USING hnsw (embedding vector_cosine_ops)
            `);
        } catch (err: any) {
            console.warn("[pgvector] HNSW index skipped (seq scan is fine for small KBs):", err?.message ?? err);
        }

        await pool.query(
            `INSERT INTO kb_vector_meta (key, value) VALUES ('embedding_dimensions', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
            [String(this.dimension)]
        );

        console.log(`✅ [pgvector] Ready (vector(${this.dimension}))`);
    }

    async countAll(): Promise<number> {
        await this.ensureReady();
        const result = await getPool().query("SELECT COUNT(*)::int AS n FROM kb_chunks");
        return result.rows[0]?.n ?? 0;
    }

    async countCollection(collectionName: string): Promise<number> {
        await this.ensureReady();
        const result = await getPool().query(
            "SELECT COUNT(*)::int AS n FROM kb_chunks WHERE collection_name = $1",
            [collectionName]
        );
        return result.rows[0]?.n ?? 0;
    }

    async deleteCollection(collectionName: string): Promise<void> {
        await this.ensureReady();
        await getPool().query("DELETE FROM kb_chunks WHERE collection_name = $1", [collectionName]);
        console.log(`[pgvector] Deleted collection '${collectionName}'`);
    }

    async upsertChunks(collectionName: string, chunks: StructuredChunk[], documentId?: string): Promise<void> {
        if (chunks.length === 0) return;
        await this.ensureReady();

        const texts = chunks.map((c) => c.text);
        const vectors = await this.embeddings.embedDocuments(texts);
        const first = vectors[0];
        if (!first) return;

        if (first.length !== this.dimension) {
            throw new Error(
                `[pgvector] Embedding length ${first.length} does not match column vector(${this.dimension}). Set EMBEDDING_DIMENSIONS=${first.length}.`
            );
        }

        const pool = getPool();
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const vector = vectors[i];
                if (!chunk || !vector) continue;
                const id = chunk.metadata.chunk_id;
                await client.query(
                    `INSERT INTO kb_chunks (id, collection_name, document_id, text, embedding, metadata)
                     VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
                     ON CONFLICT (id) DO UPDATE SET
                        collection_name = EXCLUDED.collection_name,
                        document_id = EXCLUDED.document_id,
                        text = EXCLUDED.text,
                        embedding = EXCLUDED.embedding,
                        metadata = EXCLUDED.metadata`,
                    [
                        id,
                        collectionName,
                        documentId ?? null,
                        chunk.text,
                        toVectorLiteral(vector),
                        JSON.stringify(chunk.metadata),
                    ]
                );
            }
            await client.query("COMMIT");
            console.log(`✅ [pgvector] Upserted ${chunks.length} chunks into '${collectionName}'`);
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    }

    async similaritySearchWithFilter(
        collectionName: string,
        query: string,
        metadataFilter?: Partial<ChunkMetadata>,
        topK = 6
    ): Promise<Array<{ chunk: StructuredChunk; score: number }>> {
        await this.ensureReady();
        const queryVector = await cachedEmbedQuery(query, this.embeddings);

        const conditions = ["collection_name = $2"];
        const params: unknown[] = [toVectorLiteral(queryVector), collectionName];
        let p = 3;

        if (metadataFilter?.status) {
            conditions.push(`metadata->>'status' = $${p}`);
            params.push(metadataFilter.status);
            p++;
        }
        if (metadataFilter?.category) {
            conditions.push(`metadata->>'category' = $${p}`);
            params.push(metadataFilter.category);
            p++;
        }

        params.push(topK);
        const limitParam = `$${p}`;

        const sql = `
            SELECT text, metadata, 1 - (embedding <=> $1::vector) AS score
            FROM kb_chunks
            WHERE ${conditions.join(" AND ")}
            ORDER BY embedding <=> $1::vector
            LIMIT ${limitParam}
        `;

        const result = await getPool().query(sql, params);
        return result.rows.map((row) => ({
            chunk: {
                text: row.text as string,
                metadata: (row.metadata || {}) as ChunkMetadata,
            },
            score: Number(row.score) || 0,
        }));
    }
}

export const globalVectorStore = new PgVectorStore();
