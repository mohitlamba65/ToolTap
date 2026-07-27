/**
 * Semantic RAG & Knowledge Base Type Definitions
 */

export interface ChunkMetadata {
    chunk_id: string;
    node_id: string;
    source: string;
    title: string;
    heading_path: string;
    category: string;
    tags: string[];
    effective_date: string;
    status: "active" | "superseded" | "draft";
    author?: string;
    version?: string;
}

export interface StructuredChunk {
    text: string;
    metadata: ChunkMetadata;
}

export interface QueryAnalysis {
    originalQuery: string;
    intent: string;
    extractedEntities: string[];
    metadataFilters: Partial<ChunkMetadata>;
    keywords: string[];
}

export interface RerankedCandidate {
    chunk: StructuredChunk;
    semanticScore: number;
    structuralScore: number;
    recencyScore: number;
    finalScore: number;
}

export interface RAGResult {
    answer: string;
    sources: Array<{
        title: string;
        heading_path: string;
        source: string;
        score: number;
        effective_date: string;
    }>;
    retrievedChunksCount: number;
    abstained: boolean;
}

export interface CustomChatbot {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    userPromptTemplate?: string;
    triggerKeywords: string[];
    kbCollectionName: string;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}
