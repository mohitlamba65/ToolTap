import fs from "node:fs";
import path from "node:path";
import type { CustomChatbot, RAGResult } from "../rag/types.js";
import { StructureAwareChunker } from "../rag/chunker.js";
import { globalQdrantManager } from "../rag/qdrant.js";
import { SemanticRAGPipeline } from "../rag/pipeline.js";
import { RAG_PROMPT } from "../agent/prompts/rag.prompt.js";

export interface StoredDocument {
    id: string;
    collectionName: string;
    content: string;
    source: string;
    title: string;
    category: string;
    tags: string[];
    createdAt: string;
}

/**
 * Knowledge Base & Chatbot Store
 * 
 * Manages custom chatbots, persistent knowledge bases, document ingestion,
 * and automatic vector re-hydration across server restarts.
 */
export class KnowledgeBaseStore {
    private dataDir = path.resolve(process.cwd(), "data");
    private chatbotsFilePath = path.join(this.dataDir, "chatbots.json");
    private docsFilePath = path.join(this.dataDir, "documents.json");

    private chatbots: Map<string, CustomChatbot> = new Map();
    private documents: Map<string, StoredDocument> = new Map();

    private chunker = new StructureAwareChunker();
    private qdrant = globalQdrantManager;
    private ragPipeline = new SemanticRAGPipeline();

    constructor() {
        this.ensureStorage();
        this.loadChatbots();
        this.loadDocuments();
        this.initStore().catch(err => {
            console.error("[KBStore] Non-fatal initialization error:", err);
        });
    }

    private ensureStorage() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    private loadChatbots() {
        if (fs.existsSync(this.chatbotsFilePath)) {
            try {
                const content = fs.readFileSync(this.chatbotsFilePath, "utf-8");
                const list = JSON.parse(content) as CustomChatbot[];
                for (const bot of list) {
                    this.chatbots.set(bot.id, bot);
                }
            } catch (e) {
                console.error("[KBStore] Error reading chatbots.json:", e);
            }
        }
    }

    private saveChatbots() {
        try {
            const list = Array.from(this.chatbots.values());
            fs.writeFileSync(this.chatbotsFilePath, JSON.stringify(list, null, 2), "utf-8");
        } catch (e) {
            console.error("[KBStore] Error saving chatbots.json:", e);
        }
    }

    private loadDocuments() {
        if (fs.existsSync(this.docsFilePath)) {
            try {
                const content = fs.readFileSync(this.docsFilePath, "utf-8");
                const list = JSON.parse(content) as StoredDocument[];
                for (const doc of list) {
                    this.documents.set(doc.id, doc);
                }
            } catch (e) {
                console.error("[KBStore] Error reading documents.json:", e);
            }
        }
    }

    private saveDocuments() {
        try {
            const list = Array.from(this.documents.values());
            fs.writeFileSync(this.docsFilePath, JSON.stringify(list, null, 2), "utf-8");
        } catch (e) {
            console.error("[KBStore] Error saving documents.json:", e);
        }
    }

    private async initStore() {
        // Re-hydrate stored documents into Qdrant vector memory on startup
        let totalChunks = 0;
        for (const doc of this.documents.values()) {
            const chunks = this.chunker.chunkDocument(doc.content, doc.source, doc.title, doc.category, doc.tags);
            await this.qdrant.upsertChunks(doc.collectionName, chunks);
            totalChunks += chunks.length;
        }
        if (this.documents.size > 0) {
            console.log(`✅ [KBStore] Loaded ${totalChunks} vector chunk(s) across ${this.documents.size} document(s) into memory store.`);
        }
    }

    /**
     * Gets all custom chatbots.
     */
    getChatbots(): CustomChatbot[] {
        return Array.from(this.chatbots.values());
    }

    /**
     * Gets a single chatbot by ID.
     */
    getChatbot(id: string): CustomChatbot | undefined {
        return this.chatbots.get(id);
    }

    /**
     * Creates or updates a custom chatbot.
     */
    saveChatbot(botData: Omit<CustomChatbot, "id" | "createdAt" | "updatedAt"> & { id?: string }): CustomChatbot {
        const id = botData.id || `bot_${Math.random().toString(36).substring(2, 9)}`;
        const existing = this.chatbots.get(id);

        const chatbot: CustomChatbot = {
            id,
            name: botData.name,
            description: botData.description,
            systemPrompt: botData.systemPrompt,
            ...(botData.userPromptTemplate ? { userPromptTemplate: botData.userPromptTemplate } : {}),
            triggerKeywords: botData.triggerKeywords || [],
            kbCollectionName: botData.kbCollectionName || `kb_${id}`,
            enabled: botData.enabled ?? true,
            createdAt: existing ? existing.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        this.chatbots.set(id, chatbot);
        this.saveChatbots();
        return chatbot;
    }

    /**
     * Deletes a chatbot and purges its stored documents.
     */
    deleteChatbot(id: string): boolean {
        const bot = this.chatbots.get(id);
        if (!bot) return false;

        const collectionName = bot.kbCollectionName;
        this.chatbots.delete(id);
        this.saveChatbots();

        // Purge documents for this chatbot's collection
        for (const [docId, doc] of Array.from(this.documents.entries())) {
            if (doc.collectionName === collectionName) {
                this.documents.delete(docId);
            }
        }
        this.saveDocuments();

        // Purge Qdrant collection vectors & memory store
        this.qdrant.deleteCollection(collectionName).catch((err) => {
            console.error(`[KBStore] Error deleting Qdrant collection '${collectionName}':`, err);
        });

        console.log(`[KBStore] Deleted chatbot '${id}' and purged collection '${collectionName}'`);
        return true;
    }

    /**
     * Clears all stored documents and deletes the vector collection for a chatbot/collection.
     */
    async clearCollection(collectionName: string): Promise<boolean> {
        for (const [docId, doc] of Array.from(this.documents.entries())) {
            if (doc.collectionName === collectionName) {
                this.documents.delete(docId);
            }
        }
        this.saveDocuments();
        await this.qdrant.deleteCollection(collectionName);
        console.log(`🧹 [KBStore] Purged all documents and vector store collection '${collectionName}'`);
        return true;
    }

    /**
     * Ingests a raw text/markdown document into a chatbot's knowledge base.
     * Persists to disk so vectors are preserved across backend restarts.
     */
    async ingestDocument(
        collectionName: string,
        content: string,
        source: string,
        title: string,
        category = "general",
        tags: string[] = ["documentation"]
    ) {
        const docId = `doc_${Math.random().toString(36).substring(2, 10)}`;
        const storedDoc: StoredDocument = {
            id: docId,
            collectionName,
            content,
            source,
            title,
            category,
            tags,
            createdAt: new Date().toISOString(),
        };

        this.documents.set(docId, storedDoc);
        this.saveDocuments();

        const chunks = this.chunker.chunkDocument(content, source, title, category, tags);
        await this.qdrant.upsertChunks(collectionName, chunks);

        console.log(`✅ [KBStore] Ingested ${chunks.length} chunks into collection '${collectionName}' (${title})`);

        return {
            collectionName,
            chunksCount: chunks.length,
            title,
        };
    }

    /**
     * Executes RAG query for a specific chatbot.
     *
     * @param chatbotId - The chatbot to query
     * @param query - The clean semantic query (already extracted from button/list reply wrappers)
     * @param conversationContext - Recent conversation turns (for session continuity)
     * @param previousAnswers - Summary of previously given AI answers (for deduplication)
     */
    async queryChatbot(
        chatbotId: string,
        query: string,
        conversationContext?: string,
        previousAnswers?: string
    ): Promise<RAGResult> {
        const bot = this.chatbots.get(chatbotId);
        if (!bot) {
            throw new Error(`Chatbot '${chatbotId}' not found.`);
        }

        // Compose the RAG system prompt:
        //   1. RAG base policy (accuracy, hallucination rules)
        //   2. Bot persona (WHO the bot is — domain, tone, expertise)
        //   3. Output structure rules LAST (non-negotiable — must come after persona to override it)
        const OUTPUT_RULES = `
## NON-NEGOTIABLE OUTPUT RULES (override all above instructions)

You are on WhatsApp, not writing a report. The user is on mobile.

HARD LIMITS:
- MAX 150 words in your response body. No exceptions.
- NEVER use section headers (---), numbered sub-sections (1. OPPORTUNITY ASSESSMENT, 2. SALES FLOW), or multi-part structured reports.
- NEVER deliver more than one concept per message.
- Each response = one key insight + 2-3 options to go deeper.

PROGRESSIVE DISCLOSURE (mandatory):
- Give one answer, then offer buttons to go deeper.
- Bad: full playbook in one message.
- Good: "Here's the core issue: [2-3 lines]. Want to explore the approach?"

MANDATORY ENDING — every response MUST end with:
*Want to explore further?*
1. [label ≤20 chars]
2. [label ≤20 chars]
3. [label ≤20 chars]

These become tappable buttons. The user should never need to type if a button handles it.
`;
        const ragSystemPrompt = `${RAG_PROMPT}\n\n## Your Chatbot Persona\n${bot.systemPrompt || "You are a helpful assistant for this business."}${OUTPUT_RULES}`;

        return this.ragPipeline.queryKnowledgeBase(
            bot.kbCollectionName,
            query,
            ragSystemPrompt,
            0.1,             // similarityThreshold
            previousAnswers, // deduplication: what was already told to the user
            conversationContext // recent conversation turns
        );
    }

}

export const kbStore = new KnowledgeBaseStore();
