import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOllama } from "@langchain/ollama";
import { env } from "../config/env.js";
import { ModelProvider } from "./config.js";

export function createModel() {
    switch (env.provider) {
        case ModelProvider.OPENAI:
            if (!env.openaiKey) {
                throw new Error("OPENAI_API_KEY is not set");
            }
            return new ChatOpenAI({
                apiKey: env.openaiKey,
                model: env.openaiModel,
                temperature: 0
            });

        case ModelProvider.GEMINI:
            if (!env.googleKey) {
                throw new Error("GOOGLE_API_KEY is not set");
            }
            return new ChatGoogleGenerativeAI({
                apiKey: env.googleKey,
                model: env.geminiModel,
                temperature: 0
            });

        case ModelProvider.OLLAMA:

            return new ChatOllama({

                baseUrl: env.ollamaBaseUrl,

                model: env.ollamaModel,

                temperature: 0,
                numCtx: 2048

            });

        default:

            throw new Error("Unsupported Provider");
    }
}
