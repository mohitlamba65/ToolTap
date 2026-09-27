import type { Chatbot, DocumentMeta, RagResult, Status, WebhookConfig, WhatsAppCredential } from "./types";
import { apiUrl } from "./lib/api-base";

async function json<T>(res: Response | Promise<Response>): Promise<T> {
  const response = await res;
  const body = await response.text();
  let parsed: any = {};
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { error: body };
    }
  }
  if (!response.ok) {
    throw new Error(parsed.error || body || response.statusText);
  }
  return parsed as T;
}

export const api = {
  status: () => json<Status>(fetch(apiUrl("/api/status"))),
  chatbots: () => json<{ chatbots: Chatbot[] }>(fetch(apiUrl("/api/chatbots"))),
  documents: (collection?: string) =>
    json<{ documents: DocumentMeta[] }>(
      fetch(
        collection
          ? apiUrl(`/api/documents?collection=${encodeURIComponent(collection)}`)
          : apiUrl("/api/documents")
      )
    ),
  setProvider: (provider: string) =>
    json<{ success: boolean; provider: string }>(
      fetch(apiUrl("/api/provider"), {
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
      fetch(apiUrl("/api/chatbots"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ),
  deleteChatbot: (id: string) => fetch(apiUrl(`/api/chatbots/${id}`), { method: "DELETE" }),
  deleteDocument: (id: string) =>
    json<{ success: boolean }>(fetch(apiUrl(`/api/documents/${id}`), { method: "DELETE" })),
  uploadFile: (file: File, collectionName: string, title?: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("collectionName", collectionName);
    if (title) form.append("title", title);
    return json<{ success: boolean; result: { chunksCount: number; title: string } }>(
      fetch(apiUrl("/api/kb/upload"), { method: "POST", body: form })
    );
  },
  ingest: (payload: {
    collectionName: string;
    content: string;
    source: string;
    title: string;
    category: string;
  }) =>
    json<{ success: boolean; result: { chunksCount: number; title: string } }>(
      fetch(apiUrl("/api/kb/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, tags: ["dashboard_upload"] }),
      })
    ),
  query: (chatbotId: string, query: string) =>
    json<{ success: boolean; result: RagResult }>(
      fetch(apiUrl("/api/kb/query"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, query }),
      })
    ),
  whatsappCredentials: () =>
    json<{ credentials: WhatsAppCredential[] }>(fetch(apiUrl("/api/whatsapp/credentials"))),
  createWhatsAppCredential: (payload: {
    name: string;
    accessToken: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName?: string;
    whatsappBusinessAccountId?: string;
  }) =>
    json<{ success: boolean; credential: WhatsAppCredential }>(
      fetch(apiUrl("/api/whatsapp/credentials"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    ),
  deleteWhatsAppCredential: (id: string) =>
    json<{ success: boolean }>(fetch(apiUrl(`/api/whatsapp/credentials/${id}`), { method: "DELETE" })),
  activateWhatsAppCredential: (id: string) =>
    json<{ success: boolean; credential: WhatsAppCredential }>(
      fetch(apiUrl(`/api/whatsapp/credentials/${id}/activate`), { method: "POST" })
    ),
  lookupPhoneNumber: (accessToken: string, phoneNumberId: string) =>
    json<{ displayPhoneNumber: string; formattedPhoneNumber: string; verifiedName: string | null }>(
      fetch(apiUrl("/api/whatsapp/phone-number"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, phoneNumberId }),
      })
    ),
  webhookConfig: () => json<WebhookConfig>(fetch(apiUrl("/api/whatsapp/webhook-config"))),
};
