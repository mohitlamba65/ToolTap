export type PageId = "home" | "setup" | "assistants" | "knowledge" | "try" | "settings";

export interface Chatbot {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  triggerKeywords: string[];
  kbCollectionName: string;
  enabled: boolean;
}

export interface Status {
  provider: "meta" | "twilio" | string;
  displayPhone: string | null;
  waMeUrl: string | null;
  tokenConfigured: boolean;
  live: boolean;
  assistantCount: number;
  documentCount: number;
  channelLabel: string;
  setupHint: string;
}

export interface DocumentMeta {
  id: string;
  collectionName: string;
  source: string;
  title: string;
  category: string;
  tags: string[];
  createdAt: string;
}

export interface RagSource {
  title: string;
  heading_path: string;
  source: string;
  score: number;
  effective_date: string;
}

export interface RagResult {
  answer: string;
  sources: RagSource[];
  retrievedChunksCount: number;
  abstained: boolean;
}

export type WaButton = { id: string; title: string };
export type WaListRow = { id: string; title: string; description?: string };
export type WaListSection = { title: string; rows: WaListRow[] };

export type WaMessage =
  | { id: string; from: "user" | "assistant"; kind: "text"; text: string; time: string }
  | { id: string; from: "assistant"; kind: "buttons"; text: string; buttons: WaButton[]; time: string }
  | {
      id: string;
      from: "assistant";
      kind: "list";
      text: string;
      header?: string;
      footer?: string;
      buttonText: string;
      sections: WaListSection[];
      time: string;
    };
