import fs from "node:fs";
import path from "node:path";
import type { CustomChatbot, RAGResult } from "../rag/types.js";
import { StructureAwareChunker } from "../rag/chunker.ts";
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
        // 1. Seed default support bot ONLY if no chatbots exist at all
        if (this.chatbots.size === 0) {
            const defaultBot: CustomChatbot = {
                id: "cb_default_support",
                name: "ToolTap Enterprise Guide & Support Bot",
                description: "Handles questions regarding ToolTap architecture, CRM setup, Brevo email setup, and system commands.",
                systemPrompt: "You are the ToolTap Product Specialist. Answer questions accurately based on official product docs.",
                triggerKeywords: ["support", "help", "guide", "pricing", "setup", "docs", "how to"],
                kbCollectionName: "kb_tooltap_support",
                enabled: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            this.chatbots.set(defaultBot.id, defaultBot);
            this.saveChatbots();

            const defaultDocContent = `# ToolTap Enterprise AI Platform Guide

## Overview
ToolTap is an enterprise WhatsApp AI orchestration engine designed for high-scalability workflows.

## Key Features
- **Multi-Provider Engine**: Switch seamlessly between Meta Cloud API and Twilio without server restart.
- **Rich WhatsApp Formatting**: LLM dynamically outputs Quick Reply Buttons (<=3 choices), Scrollable Lists (>3 choices), or Media payloads.
- **Action Tools**: Real-time web search (Tavily), Weather forecast, Brevo email dispatcher, and Dual-backend CRM (HubSpot & Postgres).
- **Semantic RAG**: Qdrant-backed structure-aware retrieval with multi-factor reranking.

## CRM Configuration
Users can choose between two backends:
1. **HubSpot**: Requires user-supplied HubSpot API Key.
2. **Direct Postgres**: Requires Postgres connection string and target table name.

## Email Operations
Powered by Brevo REST API. Supports sending transactional HTML emails and tracking delivery history.
`;

            await this.ingestDocument(
                defaultBot.kbCollectionName,
                defaultDocContent,
                "tooltap_guide.md",
                "ToolTap Product Documentation",
                "platform_guides",
                ["architecture", "support", "setup"]
            );
        }

        // 2. Re-hydrate stored documents into Qdrant vector memory on startup
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
            userPromptTemplate: botData.userPromptTemplate,
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

        console.log(`[KBStore] Deleted chatbot '${id}' and purged collection '${collectionName}'`);
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
     */
    async queryChatbot(chatbotId: string, query: string, conversationContext?: string): Promise<RAGResult> {
        const bot = this.chatbots.get(chatbotId);
        if (!bot) {
            throw new Error(`Chatbot '${chatbotId}' not found.`);
        }

        // Compose the RAG system prompt: base policy + chatbot-specific persona
        const ragSystemPrompt = `${RAG_PROMPT}\n\n## Your Chatbot Persona\n${bot.systemPrompt || "You are a helpful assistant for this business."}${conversationContext ? `\n\n## Conversation So Far\n${conversationContext}` : ""}`;

        return this.ragPipeline.queryKnowledgeBase(
            bot.kbCollectionName,
            query,
            ragSystemPrompt
        );
    }
}

export const kbStore = new KnowledgeBaseStore();
