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
    const fallbacks: any[] = [];

    const tokenCap = maxOutputTokens ? { maxTokens: maxOutputTokens } : {};
    const tokenCapGemini = maxOutputTokens ? { maxOutputTokens } : {};

    switch (env.provider) {
        case ModelProvider.GITHUB:
            if (!env.githubToken) throw new Error("GITHUB_TOKEN is not set");
            primaryModel = new ChatOpenAI({
                apiKey: env.githubToken,
                model: env.githubModel,
                temperature: 0,
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
                ...tokenCap,
            });
            break;

        case ModelProvider.GEMINI:
            if (!env.googleKey) throw new Error("GOOGLE_API_KEY is not set");
            primaryModel = new ChatGoogleGenerativeAI({
                apiKey: env.googleKey,
                model: env.geminiModel,
                temperature: 0,
                ...tokenCapGemini,
            });
            // Gemini fallback chain
            fallbacks.push(
                new ChatGoogleGenerativeAI({
                    apiKey: env.googleKey,
                    model: "gemini-2.0-flash",
                    temperature: 0,
                    ...tokenCapGemini,
                }),
                new ChatGoogleGenerativeAI({
                    apiKey: env.googleKey,
                    model: "gemini-1.5-flash",
                    temperature: 0,
                    ...tokenCapGemini,
                })
            );
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

    // Universal OpenAI fallback (if openai key exists and we're not already on openai)
    if (env.openaiKey && env.provider !== ModelProvider.OPENAI && env.provider !== ModelProvider.GITHUB) {
        fallbacks.push(
            new ChatOpenAI({
                apiKey: env.openaiKey,
                model: "gpt-4o-mini",
                temperature: 0,
                ...tokenCap,
            })
        );
    }

    return { primaryModel, fallbacks };
}

/**
 * Creates the primary LLM instance with automatic fallback chain.
 * Uses MODEL_PROVIDER from .env to select the backend.
 */
export function createModel() {
    const { primaryModel, fallbacks } = getRawModels();
    if (fallbacks.length > 0) {
        return primaryModel.withFallbacks(fallbacks);
    }
    return primaryModel;
}

/**
 * Creates the same configured model with an output token cap.
 * Used in the formatter node to avoid truncated JSON from streaming models.
 * Cap is applied at constructor level (not via .bind()) to avoid RunnableWithFallbacks issues.
 */
export function createTokenCappedModel(maxOutputTokens = 1024) {
    const { primaryModel, fallbacks } = getRawModels(maxOutputTokens);
    if (fallbacks.length > 0) {
        return primaryModel.withFallbacks(fallbacks);
    }
    return primaryModel;
}

/**
 * Creates a model with action tools bound (for the agent reasoning node).
 */
export function createModelWithTools(tools: any[]) {
    const { primaryModel, fallbacks } = getRawModels();
    const boundPrimary = primaryModel.bindTools(tools);

    if (fallbacks.length > 0) {
        const boundFallbacks = fallbacks.map((f) => f.bindTools(tools));
        return boundPrimary.withFallbacks(boundFallbacks);
    }
    return boundPrimary;
}

/**
 * Creates a model with structured output (Zod schema) bound safely with fallbacks.
 * Prevents "withStructuredOutput is not a function" errors when fallback wrappers are present.
 */
export function createStructuredModel<T extends any>(schema: T, name?: string) {
    const { primaryModel, fallbacks } = getRawModels();
    const options = name ? { name } : undefined;
    const structuredPrimary = primaryModel.withStructuredOutput(schema, options);

    if (fallbacks.length > 0) {
        const structuredFallbacks = fallbacks.map((f: any) => f.withStructuredOutput(schema, options));
        return structuredPrimary.withFallbacks(structuredFallbacks);
    }
    return structuredPrimary;
}

