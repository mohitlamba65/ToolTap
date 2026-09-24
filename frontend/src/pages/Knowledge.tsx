import { useEffect, useState } from "react";
import type { Chatbot, DocumentMeta } from "../types";
import { api } from "../api";

interface Props {
  chatbots: Chatbot[];
  preferredId?: string;
}

export function Knowledge({ chatbots, preferredId }: Props) {
  const [botId, setBotId] = useState(preferredId || chatbots[0]?.id || "");
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");

  const bot = chatbots.find((b) => b.id === botId);

  const load = () => {
    if (!bot) {
      setDocs([]);
      return;
    }
    api.documents(bot.kbCollectionName).then((d) => setDocs(d.documents)).catch(() => setDocs([]));
  };

  useEffect(() => {
    if (preferredId) setBotId(preferredId);
  }, [preferredId]);

  useEffect(() => {
    load();
  }, [botId, bot?.kbCollectionName]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bot || !title.trim() || !content.trim()) return;
    setStatus("Saving…");
    try {
      const res = await api.ingest({
        collectionName: bot.kbCollectionName,
        content,
        source: `${title.toLowerCase().replace(/\s+/g, "_")}.md`,
        title: title.trim(),
        category: "general",
      });
      setStatus(`Saved ${res.result.chunksCount} sections.`);
      setTitle("");
      setContent("");
      load();
    } catch {
      setStatus("Couldn’t save. Check the server is running.");
    }
  };

  if (chatbots.length === 0) {
    return (
      <div className="empty">
        <p>Create an assistant first, then add the files it should learn from.</p>
      </div>
    );
  }

  return (
    <div className="knowledge">
      <p className="eyebrow">Knowledge</p>
      <h1>What {bot?.name || "the assistant"} can cite</h1>
      <p className="lede">Paste the source of truth. Answers stay inside these pages.</p>

      <label className="inline-select">
        Assistant
        <select value={botId} onChange={(e) => setBotId(e.target.value)}>
          {chatbots.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>

      <div className="split tight">
        <form className="card form-card" onSubmit={submit}>
          <h2>Add a document</h2>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Warranty 2026" required />
          </label>
          <label>
            Content
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder={"# Returns\nItems can be exchanged within 14 days..."}
              required
            />
          </label>
          <button type="submit" className="btn primary">Save to {bot?.name}</button>
          {status && <p className="form-note">{status}</p>}
        </form>

        <div className="card">
          <h2>On file</h2>
          {docs.length === 0 && <p className="muted">Nothing uploaded for this assistant yet.</p>}
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.id}>
                <strong>{d.title}</strong>
                <span>{new Date(d.createdAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
