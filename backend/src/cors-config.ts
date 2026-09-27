import type { CorsOptions } from "cors";

const DEFAULT_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "https://tool-tap.vercel.app",
];

export function buildCorsOptions(): CorsOptions {
    const raw = (process.env.CORS_ORIGINS || "").trim();
    if (raw === "*") {
        return {};
    }

    const extra = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const allowed = new Set([...DEFAULT_ORIGINS, ...extra]);

    return {
        origin(
            origin: string | undefined,
            callback: (err: Error | null, allow?: boolean) => void
        ) {
            if (!origin || allowed.has(origin)) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
    };
}
