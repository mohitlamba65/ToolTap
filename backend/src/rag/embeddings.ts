import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env.js";

export interface EmbeddingsInterface {
    embedQuery(text: string): Promise<number[]>;
    embedDocuments(documents: string[]): Promise<number[][]>;
}

/**
 * Provider-aware Embeddings Factory for Semantic RAG.
 *
 * Respects EMBEDDING_PROVIDER env flag (defaults to MODEL_PROVIDER value).
 * Supported: "gemini" | "openai" | "github"
 *
 * GitHub Models does not currently support embeddings via its inference gateway,
 * so "github" embedding provider falls back to OpenAI text-embedding-3-small
 * using the same GitHub token — or Gemini if GOOGLE_API_KEY is set.
 *
 * Priority: EMBEDDING_PROVIDER → fallback (same provider as LLM) → pseudo-vector.
 */
export function createEmbeddings(): EmbeddingsInterface {
    const provider = env.embeddingProvider.toLowerCase();
    let primary: EmbeddingsInterface | null = null;
    let secondary: EmbeddingsInterface | null = null;

    // Select primary embedding model based on EMBEDDING_PROVIDER
    if (provider === "gemini" && env.googleKey) {
        primary = new GoogleGenerativeAIEmbeddings({
            apiKey: env.googleKey,
            model: env.geminiEmbeddingModel,
        }) as any;
    } else if ((provider === "openai") && env.openaiKey) {
        primary = new OpenAIEmbeddings({
            apiKey: env.openaiKey,
            modelName: env.openaiEmbeddingModel,
        }) as any;
    } else if (provider === "github" && env.githubToken) {
        // GitHub Models uses OpenAI-compatible API — embeddings endpoint is available
        primary = new OpenAIEmbeddings({
            apiKey: env.githubToken,
            modelName: "text-embedding-3-small",
            configuration: { baseURL: env.githubBaseUrl },
        }) as any;
    }

    // Set up secondary fallback (different from primary)
    if (provider !== "gemini" && env.googleKey) {
        secondary = new GoogleGenerativeAIEmbeddings({
            apiKey: env.googleKey,
            model: env.geminiEmbeddingModel,
        }) as any;
    } else if (provider !== "openai" && provider !== "github" && env.openaiKey) {
        secondary = new OpenAIEmbeddings({
            apiKey: env.openaiKey,
            modelName: env.openaiEmbeddingModel,
        }) as any;
    }

    // Pseudo-vector fallback — deterministic but not semantically meaningful
    const pseudoFallback: EmbeddingsInterface = {
        async embedQuery(text: string): Promise<number[]> {
            console.warn("[Embeddings] ⚠️ No embedding API key available — using pseudo-vector fallback. RAG quality will be degraded.");
            return generatePseudoVector(text, 768);
        },
        async embedDocuments(documents: string[]): Promise<number[][]> {
            return documents.map((doc) => generatePseudoVector(doc, 768));
        },
    };

    return {
        async embedQuery(text: string): Promise<number[]> {
            if (primary) {
                try { return await primary.embedQuery(text); }
                catch (e: any) { console.warn(`[Embeddings] Primary (${provider}) failed, trying secondary:`, e?.message || e); }
            }
            if (secondary) {
                try { return await secondary.embedQuery(text); }
                catch (e: any) { console.warn("[Embeddings] Secondary failed:", e?.message || e); }
            }
            return pseudoFallback.embedQuery(text);
        },
        async embedDocuments(documents: string[]): Promise<number[][]> {
            if (primary) {
                try { return await primary.embedDocuments(documents); }
                catch (e: any) { console.warn(`[Embeddings] Primary (${provider}) failed, trying secondary:`, e?.message || e); }
            }
            if (secondary) {
                try { return await secondary.embedDocuments(documents); }
                catch (e: any) { console.warn("[Embeddings] Secondary failed:", e?.message || e); }
            }
            return pseudoFallback.embedDocuments(documents);
        },
    };
}

/**
 * Pseudo-vector: deterministic hash-based vector when no API is available.
 */
function generatePseudoVector(text: string, dimensions = 768): number[] {
    const vector: number[] = new Array(dimensions).fill(0);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        hash = (hash << 5) - hash + text.charCodeAt(i);
        hash |= 0;
    }
    for (let i = 0; i < dimensions; i++) {
        const seed = Math.sin(hash + i) * 10000;
        vector[i] = seed - Math.floor(seed);
    }
    return vector;
}
