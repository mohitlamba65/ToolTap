import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env.js";
import { githubCompatibleFetch } from "../llm/provider.js";

export interface EmbeddingsInterface {
    embedQuery(text: string): Promise<number[]>;
    embedDocuments(documents: string[]): Promise<number[][]>;
}

/**
 * Single-provider embeddings. No serial secondary API — a failed primary call
 * falls back to a local pseudo-vector so the request does not wait on another vendor.
 */
export function createEmbeddings(): EmbeddingsInterface {
    const provider = env.embeddingProvider.toLowerCase();
    let primary: EmbeddingsInterface | null = null;

    if (provider === "gemini" && env.googleKey) {
        primary = new GoogleGenerativeAIEmbeddings({
            apiKey: env.googleKey,
            model: env.geminiEmbeddingModel,
        }) as any;
    } else if (provider === "openai" && env.openaiKey) {
        primary = new OpenAIEmbeddings({
            apiKey: env.openaiKey,
            modelName: env.openaiEmbeddingModel,
        }) as any;
    } else if (provider === "github" && env.githubToken) {
        primary = new OpenAIEmbeddings({
            apiKey: env.githubToken,
            modelName: "text-embedding-3-small",
            configuration: { baseURL: env.githubBaseUrl, fetch: githubCompatibleFetch },
        }) as any;
    }

    const dim = env.embeddingDimensions || 768;
    const pseudoFallback: EmbeddingsInterface = {
        async embedQuery(text: string): Promise<number[]> {
            console.warn("[Embeddings] Using pseudo-vector fallback. RAG quality will be degraded.");
            return generatePseudoVector(text, dim);
        },
        async embedDocuments(documents: string[]): Promise<number[][]> {
            return documents.map((doc) => generatePseudoVector(doc, dim));
        },
    };

    return {
        async embedQuery(text: string): Promise<number[]> {
            if (!primary) return pseudoFallback.embedQuery(text);
            try {
                return await primary.embedQuery(text);
            } catch (e: any) {
                console.warn(`[Embeddings] Primary (${provider}) failed:`, e?.message || e);
                return pseudoFallback.embedQuery(text);
            }
        },
        async embedDocuments(documents: string[]): Promise<number[][]> {
            if (!primary) return pseudoFallback.embedDocuments(documents);
            try {
                return await primary.embedDocuments(documents);
            } catch (e: any) {
                console.warn(`[Embeddings] Primary (${provider}) failed:`, e?.message || e);
                return pseudoFallback.embedDocuments(documents);
            }
        },
    };
}

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
