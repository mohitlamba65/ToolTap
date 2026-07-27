import type { RerankedCandidate, StructuredChunk } from "./types.js";

/**
 * Multi-Factor Reranker
 * 
 * Reranks candidates using the exact formula:
 * FinalScore = 0.6 * SemanticSimilarity + 0.25 * StructuralScore + 0.15 * RecencyScore
 */
export class MultiFactorReranker {
    /**
     * Reranks candidate chunks and returns top N items (e.g. top 5 out of top 10).
     */
    rerank(
        query: string,
        candidates: Array<{ chunk: StructuredChunk; score: number }>,
        topN = 5
    ): RerankedCandidate[] {
        const queryLower = query.toLowerCase();
        const now = new Date().getTime();

        const reranked: RerankedCandidate[] = candidates.map((cand) => {
            const rawScore = Number.isNaN(cand.score) || cand.score === undefined ? 0.5 : cand.score;
            const semanticScore = Math.max(0, Math.min(1, rawScore));

            // 1. Structural Score (Heading match, hierarchy depth, tags)
            const headingPath = cand.chunk.metadata.heading_path.toLowerCase();
            const title = cand.chunk.metadata.title.toLowerCase();

            let structuralScore = 0.5; // Baseline
            if (headingPath.includes(queryLower) || queryLower.includes(title)) {
                structuralScore += 0.3;
            }
            if (cand.chunk.metadata.heading_path.includes(">")) {
                // Higher score for deeper structured section hierarchy
                structuralScore += 0.2;
            }
            structuralScore = Math.min(1.0, structuralScore);

            // 2. Recency Score
            let recencyScore = 0.7;
            try {
                const docDate = new Date(cand.chunk.metadata.effective_date).getTime();
                const daysOld = (now - docDate) / (1000 * 60 * 60 * 24);
                if (daysOld < 30) recencyScore = 1.0;
                else if (daysOld < 90) recencyScore = 0.9;
                else if (daysOld < 365) recencyScore = 0.7;
                else recencyScore = 0.4;
            } catch (e) {
                recencyScore = 0.5;
            }

            // Combine using exact requested formula
            const finalScore =
                0.6 * semanticScore +
                0.25 * structuralScore +
                0.15 * recencyScore;

            return {
                chunk: cand.chunk,
                semanticScore,
                structuralScore,
                recencyScore,
                finalScore,
            };
        });

        // Sort descending by finalScore
        reranked.sort((a, b) => b.finalScore - a.finalScore);

        return reranked.slice(0, topN);
    }
}
