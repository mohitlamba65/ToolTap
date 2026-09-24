import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { env } from "../config/env.js";
import { ModelProvider } from "./config.js";

/**
 * Builds a raw (unbound, no fallback) model instance for the configured provider.
 * GitHub Models uses the OpenAI SDK with a custom baseURL — same token, many models.
 */
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
                configuration: { baseURL: env.githubBaseUrl },
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

