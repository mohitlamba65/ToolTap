import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { env } from "../config/env.js";
import { ModelProvider } from "./config.js";

/**
 * GitHub Models currently returns text/plain completions. LangChain's OpenAI
 * client expects chat.completion JSON, so wrap plain bodies before parse.
 */
export function githubCompatibleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return fetch(input, init).then(async (res) => {
        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("text/event-stream") || ct.includes("application/json")) {
            return res;
        }
        if (!res.ok) return res;
        const text = await res.text();
        const trimmed = text.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            return new Response(trimmed, {
                status: res.status,
                headers: { "Content-Type": "application/json" },
            });
        }
        const wrapped = JSON.stringify({
            id: "chatcmpl-github-plain",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "github",
            choices: [
                {
                    index: 0,
                    message: { role: "assistant", content: text.replace(/\r\n/g, "\n").trim() },
                    finish_reason: "stop",
                },
            ],
        });
        return new Response(wrapped, {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    });
}
function getRawModels(maxOutputTokens?: number) {
    let primaryModel: any;
    const tokenCap = maxOutputTokens ? { maxTokens: maxOutputTokens } : {};
    const tokenCapGemini = maxOutputTokens ? { maxOutputTokens } : {};

    switch (env.provider) {
        case ModelProvider.GITHUB:
            if (!env.githubToken) throw new Error("GITHUB_TOKEN is not set");
            primaryModel = new ChatOpenAI({
                apiKey: env.githubToken,
                model: env.githubModel,
                temperature: 0,
                timeout: 20_000,
                maxRetries: 1,
                useResponsesApi: false,
                configuration: { baseURL: env.githubBaseUrl, fetch: githubCompatibleFetch },
                ...tokenCap,
            });
            break;

        case ModelProvider.OPENAI:
            if (!env.openaiKey) throw new Error("OPENAI_API_KEY is not set");
            primaryModel = new ChatOpenAI({
                apiKey: env.openaiKey,
                model: env.openaiModel,
                temperature: 0,
                timeout: 20_000,
                maxRetries: 1,
                useResponsesApi: false,
                ...tokenCap,
            });
            break;

        case ModelProvider.GEMINI:
            if (!env.googleKey) throw new Error("GOOGLE_API_KEY is not set");
            primaryModel = new ChatGoogleGenerativeAI({
                apiKey: env.googleKey,
                model: env.geminiModel,
                temperature: 0,
                maxRetries: 1,
                ...tokenCapGemini,
            });
            break;

        case ModelProvider.OLLAMA:
            primaryModel = new ChatOllama({
                baseUrl: env.ollamaBaseUrl,
                model: env.ollamaModel,
                temperature: 0,
                numCtx: 4096,
            });
            break;

        default:
            throw new Error(`Unsupported MODEL_PROVIDER: "${env.provider}". Supported: openai, gemini, github, ollama`);
    }

    return primaryModel;
}

/**
 * Creates the primary LLM instance.
 * Uses MODEL_PROVIDER from .env to select the backend. No serial fallback chain.
 */
export function createModel() {
    return getRawModels();
}

/**
 * Creates the same configured model with an output token cap.
 */
export function createTokenCappedModel(maxOutputTokens = 1024) {
    return getRawModels(maxOutputTokens);
}

/**
 * Creates a model with action tools bound (for the agent reasoning node).
 */
export function createModelWithTools(tools: any[]) {
    return getRawModels().bindTools(tools);
}

/**
 * Creates a model with structured output (Zod schema).
 */
export function createStructuredModel<T extends any>(schema: T, name?: string) {
    const options = name ? { name } : undefined;
    return getRawModels().withStructuredOutput(schema, options);
}

