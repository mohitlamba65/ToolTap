import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

dotenv.config();
const backendEnvPath = path.resolve("d:/Learnings/ToolTap/backend/.env");
if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath, override: true });
}

export const env = {
    // ── LLM Inference Provider ──────────────────────────────────────────────
    // Supported: "gemini" | "openai" | "github" | "ollama"
    provider: process.env.MODEL_PROVIDER ?? "gemini",

    openaiKey: process.env.OPENAI_API_KEY,
    googleKey: process.env.GOOGLE_API_KEY,

    // GitHub Models — uses OpenAI SDK with custom baseURL
    githubToken: process.env.GITHUB_TOKEN,
    githubBaseUrl: process.env.GITHUB_BASE_URL ?? "https://models.github.ai/inference",
    githubModel: process.env.GITHUB_MODEL ?? "openai/gpt-4.1",

    ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",

    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    ollamaModel: process.env.OLLAMA_MODEL ?? "qwen3:4b",

    // ── Embedding Provider ───────────────────────────────────────────────────
    // Supported: "gemini" | "openai" | "github"
    // Defaults to using the same provider as the LLM provider.
    embeddingProvider: process.env.EMBEDDING_PROVIDER ?? process.env.MODEL_PROVIDER ?? "gemini",
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001",

    // ── Voice Transcription Provider ─────────────────────────────────────────
    // Supported: "gemini" | "openai" | "github"
    // GitHub uses Whisper via OpenAI-compatible API.
    transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER ?? "gemini",
    openaiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
    geminiTranscriptionModel: process.env.GEMINI_TRANSCRIPTION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-2.0-flash",

    // ── Mailgun Engine ──────────────────────────────────────────────────────
    mailgunApiKey: process.env.MAILGUN_API_KEY,
    mailgunDomain: process.env.MAILGUN_DOMAIN,
    mailgunBaseUrl: process.env.MAILGUN_BASE_URL ?? "https://api.mailgun.net",
    mailgunSenderEmail: process.env.MAILGUN_SENDER_EMAIL ?? "eywhatsappbot43@gmail.com",
};
