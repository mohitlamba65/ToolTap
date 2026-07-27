import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config/env.js";

export interface EmbeddingsInterface {
    embedQuery(text: string): Promise<number[]>;
    embedDocuments(documents: string[]): Promise<number[][]>;
}

/**
 * Robust Embeddings Factory for Semantic RAG
 * 
 * Tries GoogleGenerativeAIEmbeddings (text-embedding-004) primary.
 * Auto-falls back to OpenAI / pseudo-vector if model name is invalid or API fails.
 */
export function createEmbeddings(): EmbeddingsInterface {
    let primary: EmbeddingsInterface | null = null;
    let secondary: EmbeddingsInterface | null = null;

    if (env.googleKey) {
        primary = new GoogleGenerativeAIEmbeddings({
            apiKey: env.googleKey,
            model: "gemini-embedding-001",
        }) as any;
    }

    if (env.openaiKey) {
        secondary = new OpenAIEmbeddings({
            apiKey: env.openaiKey,
            modelName: "text-embedding-3-small",
        }) as any;
    }

    const fallback: EmbeddingsInterface = {
        async embedQuery(text: string): Promise<number[]> {
            return generatePseudoVector(text, 768);
        },
        async embedDocuments(documents: string[]): Promise<number[][]> {
            return documents.map((doc) => generatePseudoVector(doc, 768));
        },
    };

    return {
        async embedQuery(text: string): Promise<number[]> {
            if (primary) {
                try {
                    return await primary.embedQuery(text);
                } catch (e: any) {
                    console.warn("[Embeddings] Primary Google embedding failed, switching to fallback:", e?.message || e);
                }
            }
            if (secondary) {
                try {
                    return await secondary.embedQuery(text);
                } catch (e: any) {
                    console.warn("[Embeddings] Secondary OpenAI embedding failed:", e?.message || e);
                }
            }
            return fallback.embedQuery(text);
        },

        async embedDocuments(documents: string[]): Promise<number[][]> {
            if (primary) {
                try {
                    return await primary.embedDocuments(documents);
                } catch (e: any) {
                    console.warn("[Embeddings] Primary Google embedDocuments failed, switching to fallback:", e?.message || e);
                }
            }
            if (secondary) {
                try {
                    return await secondary.embedDocuments(documents);
                } catch (e: any) {
                    console.warn("[Embeddings] Secondary OpenAI embedDocuments failed:", e?.message || e);
                }
            }
            return fallback.embedDocuments(documents);
        },
    };
}

/**
 * Pseudo-vector generator for local fallback mode when no embedding API key is present
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
