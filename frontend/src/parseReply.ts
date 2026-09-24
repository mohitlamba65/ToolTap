import type { WaButton, WaMessage } from "./types";

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function parseAssistantReply(raw: string, id: string): WaMessage {
  const headerRegex =
    /\n*\*?(?:Want to explore further|What's next|Next steps|Explore further|Suggested options|Available Tools|Available options|What would you like)\??:?\*?\n/i;
  const match = raw.match(headerRegex);

  if (match && match.index !== undefined) {
    const bodyText = raw.slice(0, match.index).trim();
    const optionsBlock = raw.slice(match.index + match[0].length).trim();
    const items: WaButton[] = [];
    for (const line of optionsBlock.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const itemMatch = line.match(/^(?:[1-9][.)]|\*|-|•)\s*(.+)$/);
      if (!itemMatch?.[1]) continue;
      const title = itemMatch[1].replace(/\s+[—–-]\s+.+$/, "").trim().slice(0, 20);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `opt_${items.length + 1}`;
      items.push({ id: slug, title });
    }
    if (items.length > 0 && items.length <= 3) {
      return { id, from: "assistant", kind: "buttons", text: bodyText || raw, buttons: items, time: nowLabel() };
    }
    if (items.length > 3) {
      return {
        id,
        from: "assistant",
        kind: "list",
        text: bodyText || raw,
        buttonText: "View options",
        sections: [{ title: "Options", rows: items.map((b) => ({ id: b.id, title: b.title })) }],
        time: nowLabel(),
      };
    }
  }

  return { id, from: "assistant", kind: "text", text: raw, time: nowLabel() };
}

export function userText(text: string, id: string): WaMessage {
  return { id, from: "user", kind: "text", text, time: nowLabel() };
}
