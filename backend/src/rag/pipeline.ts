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
     *
     * @param collectionName  - Qdrant collection to search
     * @param userQuery       - The clean semantic query (already extracted from button/list reply)
     * @param systemPromptOverride - Optional custom system prompt for this bot
     * @param similarityThreshold - Minimum vector similarity score (default 0.1)
     * @param previousAnswers - Stringified summary of previously given AI answers in this session.
     *                         Used to avoid repeating the same content on follow-up turns.
     * @param conversationHistory - Recent conversation turns for session context
     */
    async queryKnowledgeBase(
        collectionName: string,
        userQuery: string,
        systemPromptOverride?: string,
        similarityThreshold = 0.1,
        previousAnswers?: string,
        conversationHistory?: string
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

        // 5. Build System Prompt — inject anti-repetition block if prior answers exist
        const baseSystemPrompt = systemPromptOverride || DEFAULT_RAG_SYSTEM_PROMPT;

        let systemPrompt = baseSystemPrompt;

        if (previousAnswers && previousAnswers.trim().length > 0) {
            systemPrompt += `\n\n---\nCONVERSATION DEDUPLICATION (CRITICAL):\nThe following answers were ALREADY given to the user in this session. Do NOT repeat this information:\n\n${previousAnswers}\n\nYou MUST:\n- Provide NEW information, a DEEPER explanation, or a DIFFERENT aspect of the topic.\n- If you have covered all available information on this topic, explicitly tell the user: "I've shared everything available on this topic. Would you like to explore a related subject?"\n- Never summarise or paraphrase what was already said above.\n---`;
        }

        if (conversationHistory && conversationHistory.trim().length > 0) {
            systemPrompt += `\n\nRECENT CONVERSATION CONTEXT:\n${conversationHistory}`;
        }

        // 6. Generation via LangChain LCEL RunnableSequence
        const chain = RunnableSequence.from([
            async (input: { context: string; query: string }) => [
                { role: "system", content: systemPrompt },
                {
                    role: "user",
                    content: `RETRIEVED KNOWLEDGE BASE CONTEXT:\n\n${input.context}\n\nUSER QUERY:\n${input.query}\n\nProvide a precise, grounded response following all citation and evidence rules. Do not repeat information already given in CONVERSATION DEDUPLICATION section.`,
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

## STRICT ACCURACY RULES
1. Answer ONLY from the retrieved context. Do NOT use outside knowledge.
2. Cite sources inline (e.g., "[Source 1]") for key facts.
3. If evidence is insufficient, say: "I don't have enough information on this in my knowledge base."
4. Never fabricate policies, numbers, or procedures.

## WHATSAPP RESPONSE FORMAT (MANDATORY)
Structure every response for mobile chat readability:

*CRITICAL BOLDING RULE*: WhatsApp uses single asterisk *bold* for bolding text. NEVER use double asterisks **bold**, as double asterisks result in literal asterisks displayed on user screens!

Use 1-2 relevant professional emojis to open sections — NOT decorative emoji spam.
Keep paragraphs short (2-3 sentences max). Use line breaks liberally.

*Professional emoji palette to use (pick 1-2 relevant ones per response):*
📋 for frameworks/processes, 🎯 for goals/objectives, 💡 for insights/tips,
📊 for metrics/KPIs, 🔍 for analysis, ⚙️ for operations, 🤝 for partnerships/collaboration,
✅ for achievements/completions, 📈 for performance/growth, 🛡️ for governance/compliance,
🔗 for integrations, 📌 for key points. 
Avoid: 🎉🥳😂❤️ and other casual/emotional emojis.

## DISCOVERY & OPTIONS RULE (MANDATORY)
When asked for discovery questions, options, key pillars, recommendations, or next steps:
- Keep the introduction short (1-2 concise sentences max).
- Present options or questions as a clean numbered list (1., 2., 3., etc.).
- Keep option titles short (≤20 chars) so they can be seamlessly rendered as interactive WhatsApp buttons or list pickers!

## FOLLOW-UP OPTIONS (MANDATORY — include at the end of EVERY response)
After your main answer, ALWAYS add 2-3 short follow-up options to continue the conversation.
Format them as a numbered list where each option is ≤20 chars (for WhatsApp button labels):

*Want to explore further?*
1. [Short option ≤20 chars]
2. [Short option ≤20 chars]
3. [Short option ≤20 chars]

*Good option examples:* "View KPIs", "Governance model", "Implementation steps", "Case study", "Cost breakdown", "Next steps", "Learn more", "Best practices"
*Bad option examples:* "Tell me more about the managed services framework implementation" (too long)

This ensures every response ends with interactive buttons — keeping the conversation flowing.
`;


