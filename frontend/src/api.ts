import type { Chatbot, DocumentMeta, RagResult, Status } from "./types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => json<Status>(fetch("/api/status")),
  chatbots: () => json<{ chatbots: Chatbot[] }>(fetch("/api/chatbots")),
  documents: (collection?: string) =>
    json<{ documents: DocumentMeta[] }>(
      fetch(collection ? `/api/documents?collection=${encodeURIComponent(collection)}` : "/api/documents")
    ),
  setProvider: (provider: string) =>
    json<{ success: boolean; provider: string }>(
      fetch("/api/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
    ),
  createChatbot: (payload: {
    name: string;
    description: string;
    systemPrompt: string;
    triggerKeywords: string[];
    kbCollectionName: string;
  }) =>
    json<{ success: boolean; chatbot: Chatbot }>(
      fetch("/api/chatbots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ),
  deleteChatbot: (id: string) => fetch(`/api/chatbots/${id}`, { method: "DELETE" }),
  ingest: (payload: {
    collectionName: string;
    content: string;
    source: string;
    title: string;
    category: string;
  }) =>
    json<{ success: boolean; result: { chunksCount: number; title: string } }>(
      fetch("/api/kb/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, tags: ["dashboard_upload"] }),
      })
    ),
  query: (chatbotId: string, query: string) =>
    json<{ success: boolean; result: RagResult }>(
      fetch("/api/kb/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, query }),
      })
    ),
};
