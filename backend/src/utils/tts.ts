import { env } from "../config/env.js";

interface TTSOptions {
    voice?: string;
    instructions?: string;
    format?: "mp3" | "opus" | "aac" | "flac" | "wav";
    provider?: "openai" | "gemini";
}

/**
 * Synthesizes audio using Gemini TTS API (Interactions API & generateContent API).
 * Supports prebuilt voices such as Kore, Puck, Zephyr, Charon, Fenrir, Aoede, etc.
 */
export async function generateGeminiSpeech(textToSpeak: string, options: TTSOptions = {}): Promise<Buffer | null> {
    const apiKey = env.googleKey || process.env.GOOGLE_API_KEY || "";
    if (!apiKey) {
        console.warn("⚠️ [TTS Gemini] GOOGLE_API_KEY is missing.");
        return null;
    }

    const model = env.geminiTtsModel || "gemini-3.1-flash-tts-preview";
    const voice = options.voice || env.geminiTtsVoice || "Kore";

    console.log(`🎙️ [TTS Gemini] Generating speech using model '${model}' and voice '${voice}'...`);

    // ── Attempt 1: Gemini Interactions API ──────────────────────────────────────
    try {
        const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`;
        const interactionsBody = {
            model,
            input: textToSpeak,
            response_format: { type: "audio" },
            generation_config: {
                speech_config: [{ voice }],
            },
        };

        const res = await fetch(interactionsUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify(interactionsBody),
        });

        if (res.ok) {
            const data = (await res.json()) as any;
            const b64Data = data?.output_audio?.data || data?.outputAudio?.data || data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (b64Data && typeof b64Data === "string") {
                console.log("✅ [TTS Gemini] Audio successfully generated via Interactions API!");
                return Buffer.from(b64Data, "base64");
            }
        } else {
            console.warn(`[TTS Gemini] Interactions API returned HTTP ${res.status}. Falling back to generateContent...`);
        }
    } catch (e: any) {
        console.warn("[TTS Gemini] Interactions API request error:", e?.message || e);
    }

    // ── Attempt 2: Gemini generateContent REST API ──────────────────────────────
    try {
        const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const genBody = {
            contents: [{ parts: [{ text: textToSpeak }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: voice },
                    },
                },
            },
        };

        const res = await fetch(genUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(genBody),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`❌ [TTS Gemini] generateContent API error (${res.status}): ${errText}`);
            return null;
        }

        const data = (await res.json()) as any;
        const b64Data = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (b64Data && typeof b64Data === "string") {
            console.log("✅ [TTS Gemini] Audio successfully generated via generateContent API!");
            return Buffer.from(b64Data, "base64");
        }
    } catch (e: any) {
        console.error("❌ [TTS Gemini] generateContent API request error:", e?.message || e);
    }

    return null;
}

/**
 * Synthesizes audio using OpenAI Text-To-Speech (TTS) API (`gpt-4o-mini-tts` / `tts-1`).
 */
export async function generateOpenAISpeech(textToSpeak: string, options: TTSOptions = {}): Promise<Buffer | null> {
    const apiKey = env.openaiKey || process.env.OPENAI_API_KEY || "";
    if (!apiKey) {
        console.warn("⚠️ [TTS OpenAI] OPENAI_API_KEY is missing.");
        return null;
    }

    const model = env.openaiTtsModel || "gpt-4o-mini-tts";
    const voice = options.voice || env.openaiTtsVoice || "coral";
    const format = options.format || "mp3";

    try {
        console.log(`🎙️ [TTS OpenAI] Generating speech audio using model '${model}' and voice '${voice}'...`);

        const body: Record<string, any> = {
            model,
            voice,
            input: textToSpeak,
            response_format: format,
        };

        if (options.instructions && model.includes("gpt-4o-mini-tts")) {
            body.instructions = options.instructions;
        }

        const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`❌ [TTS OpenAI] OpenAI Speech API error (${response.status}): ${errText}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    } catch (e: any) {
        console.error("❌ [TTS OpenAI] Network error generating speech audio:", e?.message || e);
        return null;
    }
}

/**
 * Provider-Agnostic Text-To-Speech Generator with Automatic Failover.
 * Configured via `TTS_PROVIDER` ("gemini" | "openai").
 */
export async function generateSpeechAudio(text: string, options: TTSOptions = {}): Promise<Buffer | null> {
    const provider = (options.provider || env.ttsProvider || process.env.TTS_PROVIDER || "openai").toLowerCase();

    // Clean text for speech output
    const cleanText = text
        .replace(/https?:\/\/[^\s]+/g, "")
        .replace(/[*_~#]/g, "")
        .trim();

    const textToSpeak = cleanText.slice(0, 4000) || "Here is your requested information.";

    const providers = provider === "gemini"
        ? [generateGeminiSpeech, generateOpenAISpeech]
        : [generateOpenAISpeech, generateGeminiSpeech];

    for (const providerFn of providers) {
        const audioBuf = await providerFn(textToSpeak, options);
        if (audioBuf) {
            return audioBuf;
        }
    }

    console.error("❌ [TTS] All Text-To-Speech providers failed or missing API keys.");
    return null;
}

/**
 * Uploads an audio Buffer to Meta's WhatsApp Media API to obtain a `media_id`.
 * This allows sending native voice notes on WhatsApp without hosting public files.
 */
export async function uploadAudioToMeta(audioBuffer: Buffer, mimeType = "audio/mpeg"): Promise<string | null> {
    const apiToken = process.env.WHATSAPP_API_TOKEN || "";
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    const apiUrl = process.env.WHATSAPP_API_URL || "https://graph.facebook.com/v19.0";

    if (!apiToken || !phoneNumberId) {
        console.warn("⚠️ [Meta Media] WHATSAPP_API_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing.");
        return null;
    }

    try {
        const formData = new FormData();
        const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("wav") ? "wav" : "mp3";
        const uint8 = new Uint8Array(audioBuffer);
        formData.append("file", new Blob([uint8], { type: mimeType }), `speech.${ext}`);
        formData.append("messaging_product", "whatsapp");
        formData.append("type", mimeType);

        const response = await fetch(`${apiUrl}/${phoneNumberId}/media`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiToken}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`❌ [Meta Media Upload] Error (${response.status}): ${errText}`);
            return null;
        }

        const data = (await response.json()) as any;
        if (data && data.id) {
            console.log(`✅ [Meta Media Upload] Audio uploaded successfully! Media ID: ${data.id}`);
            return data.id;
        }
        return null;
    } catch (e: any) {
        console.error("❌ [Meta Media Upload] Network error uploading audio to Meta:", e?.message || e);
        return null;
    }
}
