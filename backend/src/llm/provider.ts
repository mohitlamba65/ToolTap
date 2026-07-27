import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { env } from "../config/env.js";
import { ModelProvider } from "./config.js";

function getRawModels() {
    let primaryModel: any;
    const fallbacks: any[] = [];

    switch (env.provider) {
        case ModelProvider.OPENAI:
            if (!env.openaiKey) throw new Error("OPENAI_API_KEY is not set");
            primaryModel = new ChatOpenAI({
                apiKey: env.openaiKey,
                model: env.openaiModel,
                temperature: 0,
            });
            break;

        case ModelProvider.GEMINI:
            if (!env.googleKey) throw new Error("GOOGLE_API_KEY is not set");
            primaryModel = new ChatGoogleGenerativeAI({
                apiKey: env.googleKey,
                model: env.geminiModel,
                temperature: 0,
            });

            fallbacks.push(
                new ChatGoogleGenerativeAI({
                    apiKey: env.googleKey,
                    model: "gemini-1.5-flash",
                    temperature: 0,
                })
            );
            break;

        case ModelProvider.OLLAMA:
            primaryModel = new ChatOllama({
                baseUrl: env.ollamaBaseUrl,
                model: env.ollamaModel,
                temperature: 0,
                numCtx: 2048,
            });
            break;

        default:
            throw new Error("Unsupported Provider");
    }

    if (env.openaiKey && env.provider !== ModelProvider.OPENAI) {
        fallbacks.push(
            new ChatOpenAI({
                apiKey: env.openaiKey,
                model: "gpt-4o-mini",
                temperature: 0,
            })
        );
    }

    return { primaryModel, fallbacks };
}

/**
 * Creates plain LLM instance (with fallback)
 */
export function createModel() {
    const { primaryModel, fallbacks } = getRawModels();
    if (fallbacks.length > 0) {
        return primaryModel.withFallbacks(fallbacks);
    }
    return primaryModel;
}

/**
 * Creates LLM instance bound with action tools (with fallback)
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
