import crypto from "node:crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import type { ChunkMetadata, StructuredChunk } from "./types.js";
import { createEmbeddings } from "./embeddings.js";

/**
 * Qdrant Vector Database Manager
 * 
 * Manages Qdrant collections, structure-aware chunk upserts, and
 * metadata-filtered similarity searches.
 */
export class QdrantManager {
    private client: QdrantClient | null = null;
    private embeddings = createEmbeddings();
    private isQdrantConnected = false;
    private inMemoryStore: Map<string, Array<{ vector: number[]; chunk: StructuredChunk }>> = new Map();

    constructor() {
        const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
        const apiKey = process.env.QDRANT_API_KEY;

        try {
            this.client = new QdrantClient({
                url: qdrantUrl,
                ...(apiKey ? { apiKey } : {}),
            });
            this.testConnection();
        } catch (e) {
            console.warn("[Qdrant] Client initialization failed, operating in high-performance memory store mode.");
        }
    }

    private async testConnection() {
        if (!this.client) return;
        try {
            await this.client.getCollections();
            this.isQdrantConnected = true;
            console.log("✅ [Qdrant] Connected to Qdrant Vector DB server");
        } catch (e) {
            this.isQdrantConnected = false;
            console.log("ℹ️ [Qdrant] Vector DB server not detected on localhost:6333. Operating in isolated vector store mode.");
        }
    }

    /**
     * Ensures collection exists in Qdrant with proper payload index setup.
     */
    async ensureCollection(collectionName: string, vectorSize = 768) {
        if (this.isQdrantConnected && this.client) {
            try {
                const collections = await this.client.getCollections();
                const exists = collections.collections.some((c) => c.name === collectionName);

                if (!exists) {
                    await this.client.createCollection(collectionName, {
                        vectors: { size: vectorSize, distance: "Cosine" },
                    });
                    console.log(`[Qdrant] Created collection '${collectionName}'`);
                }
            } catch (e) {
                console.warn(`[Qdrant] Error ensuring collection '${collectionName}':`, e);
            }
        }

        if (!this.inMemoryStore.has(collectionName)) {
            this.inMemoryStore.set(collectionName, []);
        }
    }

    /**
     * Upserts structured chunks into Qdrant vector store with full payload metadata.
     */
    async upsertChunks(collectionName: string, chunks: StructuredChunk[]) {
        if (chunks.length === 0) return;

        const texts = chunks.map((c) => c.text);
        const vectors = await this.embeddings.embedDocuments(texts);

        await this.ensureCollection(collectionName, vectors[0]?.length || 768);

        if (this.isQdrantConnected && this.client) {
            try {
                const points = chunks.map((chunk, idx) => {
                    const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chunk.metadata.chunk_id);
                    const pointId = isValidUUID ? chunk.metadata.chunk_id : crypto.randomUUID();
                    return {
                        id: pointId,
                        vector: vectors[idx],
                        payload: {
                            text: chunk.text,
                            ...chunk.metadata,
                            chunk_id: pointId,
                        },
                    };
                });

                await this.client.upsert(collectionName, { points });
                console.log(`✅ [Qdrant] Successfully upserted ${chunks.length} chunks into Docker Qdrant collection '${collectionName}'`);
            } catch (e) {
                console.error(`[Qdrant] Failed to upsert to Qdrant, falling back to memory store:`, e);
            }
        }

        // Store in memory store
        const store = this.inMemoryStore.get(collectionName) || [];
        for (let i = 0; i < chunks.length; i++) {
            store.push({ vector: vectors[i], chunk: chunks[i] });
        }
        this.inMemoryStore.set(collectionName, store);
    }

    /**
     * Performs metadata-filtered similarity search.
     * Rule: Metadata Filter BEFORE Vector Search.
     */
    async similaritySearchWithFilter(
        collectionName: string,
        query: string,
        metadataFilter?: Partial<ChunkMetadata>,
        topK = 10
    ): Promise<Array<{ chunk: StructuredChunk; score: number }>> {
        const queryVector = await this.embeddings.embedQuery(query);

        if (this.isQdrantConnected && this.client) {
            try {
                const filterConditions: any[] = [];
                if (metadataFilter?.status) {
                    filterConditions.push({ key: "status", match: { value: metadataFilter.status } });
                }
                if (metadataFilter?.category) {
                    filterConditions.push({ key: "category", match: { value: metadataFilter.category } });
                }

                const filter = filterConditions.length > 0 ? { must: filterConditions } : undefined;

                const searchResult = await this.client.search(collectionName, {
                    vector: queryVector,
                    limit: topK,
                    filter,
                    with_payload: true,
                });

                if (searchResult.length > 0) {
                    return searchResult.map((hit) => {
                        const payload = hit.payload as any;
                        const text = payload.text || "";
                        delete payload.text;

                        return {
                            chunk: { text, metadata: payload as ChunkMetadata },
                            score: hit.score,
                        };
                    });
                }
            } catch (e) {
                console.warn("[Qdrant] Search error, executing memory fallback search:", e);
            }
        }

        // High-performance Memory Vector Cosine Similarity Search
        const store = this.inMemoryStore.get(collectionName) || [];
        const results: Array<{ chunk: StructuredChunk; score: number }> = [];

        for (const item of store) {
            // Apply Metadata Filter BEFORE calculating score
            if (metadataFilter?.status && item.chunk.metadata.status !== metadataFilter.status) {
                continue;
            }
            if (metadataFilter?.category && item.chunk.metadata.category !== metadataFilter.category) {
                continue;
            }

            const score = cosineSimilarity(queryVector, item.vector);
            results.push({ chunk: item.chunk, score });
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, topK);
    }
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const globalQdrantManager = new QdrantManager();
