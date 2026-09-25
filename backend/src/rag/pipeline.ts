import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { createTokenCappedModel } from "../llm/provider.js";
import { globalVectorStore } from "./pgvector.js";
import { MultiFactorReranker } from "./reranker.js";
import type { RAGResult, RerankedCandidate } from "./types.js";
import { RAG_PROMPT } from "../agent/prompts/rag.prompt.js";

/**
 * Semantic RAG: embed → pgvector search → light rerank → one short generation.
 */
export class SemanticRAGPipeline {
    private vectors = globalVectorStore;
    private reranker = new MultiFactorReranker();
    private llm = createTokenCappedModel(400);

    async queryKnowledgeBase(
        collectionName: string,
        userQuery: string,
        systemPromptOverride?: string,
        similarityThreshold = 0.15,
        previousAnswers?: string,
        conversationHistory?: string
    ): Promise<RAGResult> {
        const candidates = await this.vectors.similaritySearchWithFilter(
            collectionName,
            userQuery,
            { status: "active" },
            6
        );

        const validCandidates = candidates.filter((c) => c.score >= similarityThreshold);
        const finalCandidates = validCandidates.length > 0 ? validCandidates : candidates.slice(0, 3);

        if (finalCandidates.length === 0) {
            return {
                answer:
                    "I don't have enough in this knowledge base to answer that accurately.\n\n*Want to explore further?*\n1. Rephrase question\n2. Other topic\n3. What can you do",
                sources: [],
                retrievedChunksCount: 0,
                abstained: true,
            };
        }

        const reranked = this.reranker.rerank(userQuery, finalCandidates, 3);
        const contextText = this.buildContextWithProvenance(reranked);

        let systemPrompt = systemPromptOverride || RAG_PROMPT;
        if (previousAnswers && previousAnswers.trim().length > 0) {
            systemPrompt += `\n\nAlready covered this session (do not repeat):\n${previousAnswers}`;
        }
        if (conversationHistory && conversationHistory.trim().length > 0) {
            systemPrompt += `\n\nRecent turns:\n${conversationHistory}`;
        }

        let answerText = "";
        try {
            const answer = await this.llm.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(
                    `CONTEXT:\n${contextText}\n\nQUESTION:\n${userQuery}\n\nAnswer in ≤150 words from the context only. End with:\n*Want to explore further?*\n1. [≤20 chars]\n2. [≤20 chars]\n3. [≤20 chars]`
                ),
            ]);
            answerText = typeof answer?.content === "string"
                ? answer.content
                : Array.isArray(answer?.content)
                    ? answer.content.map((c: any) => (typeof c === "string" ? c : c?.text || "")).join("")
                    : String(answer?.content ?? "");
        } catch (err: any) {
            console.error("[RAG] Generation failed:", err?.stack || err?.message || err);
            return {
                answer:
                    "I found matching files but couldn’t write a reply just now. Try again in a moment.\n\n*Want to explore further?*\n1. Try again\n2. Other topic\n3. What can you do",
                sources: reranked.map((item) => ({
                    title: item.chunk.metadata?.title || "Untitled",
                    heading_path: item.chunk.metadata?.heading_path || "",
                    source: item.chunk.metadata?.source || "",
                    score: Math.round(item.finalScore * 100) / 100,
                    effective_date: item.chunk.metadata?.effective_date || "",
                })),
                retrievedChunksCount: reranked.length,
                abstained: true,
            };
        }

        const sources = reranked.map((item) => ({
            title: item.chunk.metadata?.title || "Untitled",
            heading_path: item.chunk.metadata?.heading_path || "",
            source: item.chunk.metadata?.source || "",
            score: Math.round(item.finalScore * 100) / 100,
            effective_date: item.chunk.metadata?.effective_date || "",
        }));

        return {
            answer: answerText,
            sources,
            retrievedChunksCount: reranked.length,
            abstained: false,
        };
    }

    private buildContextWithProvenance(candidates: RerankedCandidate[]): string {
        return candidates
            .map((item, idx) => {
                const meta = item.chunk.metadata || {};
                return `[${idx + 1}] ${meta.title || "Untitled"} > ${meta.heading_path || ""} (${Math.round(item.finalScore * 100)}%)\n${item.chunk.text}`;
            })
            .join("\n\n");
    }
}
