import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createModel } from "../llm/provider.js";
import { globalQdrantManager } from "./qdrant.js";
import { MultiFactorReranker } from "./reranker.js";
import type { QueryAnalysis, RAGResult, RerankedCandidate } from "./types.js";

/**
 * Modular Semantic RAG Pipeline using LangChain LCEL
 */
export class SemanticRAGPipeline {
    private qdrant = globalQdrantManager;
    private reranker = new MultiFactorReranker();
    private llm = createModel();

    /**
     * Executes Query Analysis to extract intent, entities, and metadata filters.
     */
    async analyzeQuery(userQuery: string): Promise<QueryAnalysis> {
        return {
            originalQuery: userQuery,
            intent: "information_retrieval",
            extractedEntities: [],
            metadataFilters: { status: "active" }, // Rule: prefer active docs
            keywords: userQuery.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
        };
    }

    /**
     * Executes full Semantic RAG pipeline for a specific collection / knowledge base.
     */
    async queryKnowledgeBase(
        collectionName: string,
        userQuery: string,
        systemPromptOverride?: string,
        similarityThreshold = 0.1
    ): Promise<RAGResult> {
        // 1. Query Analysis
        const analysis = await this.analyzeQuery(userQuery);

        // 2. Candidate Retrieval (Metadata filter BEFORE vector search, top_k = 10)
        const candidates = await this.qdrant.similaritySearchWithFilter(
            collectionName,
            userQuery,
            analysis.metadataFilters,
            10
        );

        // Filter by threshold if candidates exist
        const validCandidates = candidates.length > 0
            ? candidates.filter((c) => c.score >= similarityThreshold)
            : [];

        // If threshold filtering filtered everything out, take top candidates as fallback
        const finalCandidates = validCandidates.length > 0 ? validCandidates : candidates.slice(0, 5);

        // Abstain if no candidates exist at all
        if (finalCandidates.length === 0) {
            return {
                answer: "I do not have sufficient information in the configured knowledge base to answer your request accurately. Please consult official documentation or contact support.",
                sources: [],
                retrievedChunksCount: 0,
                abstained: true,
            };
        }

        // 3. Multi-Factor Reranking (Select top 5)
        const reranked = this.reranker.rerank(userQuery, finalCandidates, 5);

        // 4. Context Builder with Provenance
        const contextText = this.buildContextWithProvenance(reranked);

        // 5. Generation via LangChain LCEL RunnableSequence
        const systemPrompt = systemPromptOverride || DEFAULT_RAG_SYSTEM_PROMPT;

        const chain = RunnableSequence.from([
            async (input: { context: string; query: string }) => [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `RETRIEVED KNOWLEDGE BASE CONTEXT:\n\n${input.context}\n\nUSER QUERY:\n${input.query}\n\nProvide a precise, grounded response following all citation and evidence rules.`,
                },
            ],
            this.llm,
            new StringOutputParser(),
        ]);

        const answer = await chain.invoke({
            context: contextText,
            query: userQuery,
        });

        const sources = reranked.map((item) => ({
            title: item.chunk.metadata.title,
            heading_path: item.chunk.metadata.heading_path,
            source: item.chunk.metadata.source,
            score: Math.round(item.finalScore * 100) / 100,
            effective_date: item.chunk.metadata.effective_date,
        }));

        return {
            answer,
            sources,
            retrievedChunksCount: reranked.length,
            abstained: false,
        };
    }

    private buildContextWithProvenance(candidates: RerankedCandidate[]): string {
        return candidates
            .map((item, idx) => {
                const meta = item.chunk.metadata;
                return `--- SOURCE [${idx + 1}] ---
Title: ${meta.title}
Section Path: ${meta.heading_path}
Source File: ${meta.source}
Effective Date: ${meta.effective_date}
Relevance Score: ${Math.round(item.finalScore * 100)}%

Content:
${item.chunk.text}
------------------------`;
            })
            .join("\n\n");
    }
}

const DEFAULT_RAG_SYSTEM_PROMPT = `
You are an authoritative enterprise AI assistant. You answer questions strictly using the provided RETRIEVED KNOWLEDGE BASE CONTEXT.

STRICT GENERATION RULES:
1. Answer ONLY from the retrieved context provided. Do NOT use outside knowledge.
2. Cite your source for every claim made (e.g. "[Source 1: Section Path]").
3. If the retrieved evidence is insufficient or ambiguous to answer the query, explicitly state that you abstain due to lack of evidence in the knowledge base.
4. Never speculate, hallucinate, or fabricate policies, numbers, or procedures.
5. Format your output cleanly for readability on mobile chat / WhatsApp.
`;
