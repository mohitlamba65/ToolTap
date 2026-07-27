import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

dotenv.config();
const backendEnvPath = path.resolve("d:/Learnings/ToolTap/backend/.env");
if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath, override: true });
}

export const env = {
    provider: process.env.MODEL_PROVIDER ?? "openai",

    openaiKey: process.env.OPENAI_API_KEY,

    googleKey: process.env.GOOGLE_API_KEY,

    ollamaBaseUrl:
        process.env.OLLAMA_BASE_URL ??
        "http://localhost:11434",

    openaiModel:
        process.env.OPENAI_MODEL ??
        "gpt-5.5",

    geminiModel:
        process.env.GEMINI_MODEL ??
        "gemini-3.5-flash",

    ollamaModel:
        process.env.OLLAMA_MODEL ??
        "gpt-oss:20b",

    smtpHost: process.env.SMTP_HOST,

    smtpPort: Number(process.env.SMTP_PORT),

    smtpSecure: process.env.SMTP_SECURE === "true",

    smtpUser: process.env.SMTP_USER,

    smtpPass: process.env.SMTP_PASS,

    emailFrom: process.env.EMAIL_FROM,
};
