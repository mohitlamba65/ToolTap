import { useState } from "react";
import type { Chatbot, PageId, RagSource, WaMessage } from "../types";
import { WhatsAppPhone, buildCapabilityList } from "../components/WhatsAppPhone";
import { parseAssistantReply, userText } from "../parseReply";
import { api } from "../api";

interface Props {
  chatbots: Chatbot[];
  onPage: (p: PageId) => void;
}

export function TryIt({ chatbots, onPage }: Props) {
  const [botId, setBotId] = useState(chatbots[0]?.id || "");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<WaMessage[]>(() => starter(chatbots));
  const [sources, setSources] = useState<RagSource[]>([]);
  const [showSources, setShowSources] = useState(false);
  const [hint, setHint] = useState(true);

  const bot = chatbots.find((b) => b.id === botId);

  const send = async (text: string) => {
    if (!text.trim()) return;
    const trimmed = text.trim();
    setHint(false);
    setDraft("");
    setSending(true);
    setMessages((prev) => [...prev, userText(trimmed, `u-${Date.now()}`)]);
    if (!bot) {
      setMessages((prev) => [
        ...prev,
        parseAssistantReply("Add an assistant and a document, then try a customer question here.", `e-${Date.now()}`),
      ]);
      setSending(false);
      return;
    }
    try {
      const res = await api.query(bot.id, trimmed);
      setMessages((prev) => [...prev, parseAssistantReply(res.result.answer, `a-${Date.now()}`)]);
      setSources(res.result.sources || []);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        parseAssistantReply(
          err?.message
            ? `I couldn’t complete that: ${err.message}`
            : "I couldn’t reach the server. Is the console backend running?",
          `e-${Date.now()}`
        ),
      ]);
    } finally {
      setSending(false);
    }
  };

  if (chatbots.length === 0) {
    return (
      <div className="empty cta-empty">
        <p>Add an assistant and a document, then try a customer question here.</p>
        <button type="button" className="btn primary" onClick={() => onPage("assistants")}>
          New assistant
        </button>
      </div>
    );
  }

  return (
    <div className="split">
      <section className="copy-col">
        <p className="eyebrow">Try it</p>
        <h1>Ask as a customer would</h1>
        <p className="lede">
          This preview uses the same short replies and buttons they’ll see on WhatsApp.
          It does not send a real message to anyone’s phone.
        </p>
        <label className="inline-select">
          Assistant
          <select
            value={botId}
            onChange={(e) => {
              setBotId(e.target.value);
              setMessages(starter(chatbots));
              setSources([]);
              setHint(true);
            }}
          >
            {chatbots.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        {bot?.triggerKeywords.length ? (
          <p className="muted">Try mentioning: {bot.triggerKeywords.slice(0, 4).join(", ")}</p>
        ) : null}
        {sources.length > 0 && (
          <div>
            <button type="button" className="linkish" onClick={() => setShowSources((s) => !s)}>
              {showSources ? "Hide sources" : "Show sources"}
            </button>
            {showSources && (
              <ul className="src-list">
                {sources.map((s, i) => (
                  <li key={i}>
                    {s.title}
                    {s.heading_path ? ` — ${s.heading_path}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <aside className="phone-col">
        <p className="phone-caption">Tap View options or type below.</p>
        <WhatsAppPhone
          businessName={bot?.name || "Assistant"}
          subtitle="preview"
          messages={messages}
          composer
          composerValue={draft}
          onComposerChange={setDraft}
          onSend={() => send(draft)}
          sending={sending}
          onButton={(title) => send(title)}
          onListRow={(title) => send(title)}
          pulseListCta={hint}
          placeholder="Type a customer question"
        />
      </aside>
    </div>
  );
}

function starter(chatbots: Chatbot[]): WaMessage[] {
  return [
    { id: "t1", from: "user", kind: "text", text: "Hi", time: "10:42" },
    {
      id: "t2",
      from: "assistant",
      kind: "list",
      header: "What I can help with",
      text: "Here’s everything I can help you with. Pick a topic or just type.",
      footer: "Or send a message in your own words.",
      buttonText: "View options",
      sections: buildCapabilityList(chatbots),
      time: "10:42",
    },
  ];
}
