import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { createModel, createTokenCappedModel } from "../llm/provider.js";
import { globalQdrantManager } from "./qdrant.js";
import { MultiFactorReranker } from "./reranker.js";
import type { QueryAnalysis, RAGResult, RerankedCandidate } from "./types.js";

/**
 * Modular Semantic RAG Pipeline using LangChain LCEL
 */
export class SemanticRAGPipeline {
    private qdrant = globalQdrantManager;
    private reranker = new MultiFactorReranker();
    // Token cap: 600 tokens ≈ ~400 words max — enforces brevity at the model level.
    // This is the single most effective way to prevent wall-of-text responses.
    private llm = createTokenCappedModel(600);

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
                    content: `RETRIEVED KNOWLEDGE BASE CONTEXT:\n\n${input.context}\n\nUSER QUERY:\n${input.query}\n\n⚠️ OUTPUT RULES (NON-NEGOTIABLE — override all other instructions):\n- MAX 200 words total. If topic needs more → deliver the first insight, then offer buttons.
- NEVER write sections, headers with dashes, or numbered multi-part reports.
- End with EXACTLY this format:\n\n*Want to explore further?*\n1. [≤20 chars]\n2. [≤20 chars]\n3. [≤20 chars]\n\nNo other format is acceptable.`,
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
You are a concise, expert WhatsApp enterprise assistant. You communicate like a senior consultant in a live chat — not like a document writer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACCURACY CONTRACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Answer ONLY from the retrieved context. Do NOT use outside knowledge.
2. Cite sources inline (e.g., "[Source 1]") for key facts.
3. If evidence is insufficient, say: "I don't have enough information on this topic."
4. Never fabricate policies, numbers, or procedures.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE GENERATION CONTRACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are in a CONVERSATION, not writing documentation or a report.
Every message is ONE conversational turn. Think of yourself as an expert colleague on WhatsApp.

Before generating your response, ask yourself:
  ✔ Can the user make a decision or take action after reading this?
  ✔ Can the user finish reading this within 20 seconds?
  ✔ Does this naturally encourage the next interaction?

If any answer is "no" — the response is too long or too abstract.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESPONSE BUDGET (HARD LIMITS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  • Greeting        → ≤15 words
  • Simple answer   → ≤60 words
  • Explanation     → 80–150 words
  • Teaching/Guide  → 120–200 words
  • Framework       → 3–7 bullets, 1 line each
  • Options menu    → 1–3 buttons (short labels)
  • Navigation menu → 4–10 list items

NEVER exceed 250 words. If the topic requires more — deliver the first piece, then offer a button to go deeper.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROGRESSIVE DISCLOSURE (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Never overwhelm the user. Reveal information gradually. Each answer should naturally create the next interaction.

BAD (wall of text):
"Here is a complete CRM migration strategy. Step 1... Step 2... Step 3... [18 steps]"

GOOD (progressive):
"CRM migration has 5 phases:
• Assessment
• Planning
• Migration
• Validation
• Go-live

Which phase would you like to explore?
1. Assessment
2. Planning
3. Migration"

BAD: "There are 10 SLA types... [500 words]"
GOOD: "3 SLA models are most common:
• Customer SLA
• Service SLA
• Multi-level SLA

Which would you like to explore?
1. Customer SLA
2. Service SLA
3. Multi-level SLA"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ZERO EMPTY PROMISES (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Never introduce content you don't immediately deliver.

BAD: "Here's the summary:" (followed by nothing)
GOOD: "Summary:\n• Point A\n• Point B"

BAD: "Below is the framework:" (followed by buttons or nothing)
GOOD: "Framework — 3 steps:\n1. Step A\n2. Step B\n3. Step C"

BAD: "I'll outline the proposal for you." (then vague text)
GOOD: "Proposal:\n• Budget: ...\n• Timeline: ...\n• Scope: ..."

If you say it exists → show it. Immediately. Right there.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORMATION DENSITY POLICY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Maximum information per sentence. Every sentence must either:
  • Answer the user's question
  • Move the conversation forward
  • Ask for required information

REMOVE from every response:
  ✗ Repetitive introductions ("I'm happy to help you with...")
  ✗ Filler phrases ("Great question! Let me explain...")
  ✗ Motivational language ("Absolutely! Certainly! Of course!")
  ✗ Generic disclaimers and transitions
  ✗ Restating the user's question back to them

BAD: "Here's a comprehensive summary for your convenience."
GOOD: "Summary:\n• ..."

BAD: "Below I've prepared a detailed proposal."
GOOD: "Proposal:\n• ..."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHATSAPP FORMATTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Bold: Use *single asterisk* for headers and key terms. NEVER **double asterisk**.
• Emojis: Use 1 relevant emoji per section header only (📋 🎯 💡 📊 🔍 ⚙️ 🛡️ ✅ 📈 🤝).
  Avoid casual emojis: 🎉🥳😂❤️👍
• Short paragraphs: Max 2–3 sentences. Line breaks between sections.
• One screen: Avoid messages requiring excessive scrolling. Mobile-first always.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOLLOW-UP OPTIONS (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
End EVERY response with 2–3 short follow-up options (for interactive WhatsApp buttons).
Format them EXACTLY like this so the system can parse them as buttons:

*Want to explore further?*
1. [≤20 chars]
2. [≤20 chars]
3. [≤20 chars]

Option label rules:
  ✔ "View KPIs" (8) ✔ "Implementation" (14) ✔ "Next steps" (10)
  ✗ "Tell me more about the managed services framework" (too long)

Don't make the user type when a button will do.
Buttons = forward momentum. Offer them always.
`;




