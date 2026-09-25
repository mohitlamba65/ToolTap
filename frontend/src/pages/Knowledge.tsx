import { useCallback, useEffect, useRef, useState } from "react";
import type { Chatbot, DocumentMeta } from "../types";
import { api } from "../api";

interface Props {
  chatbots: Chatbot[];
  preferredId?: string;
  onRefresh: () => void;
  onCreateAssistant: () => void;
}

export function Knowledge({ chatbots, preferredId, onRefresh, onCreateAssistant }: Props) {
  const [botId, setBotId] = useState(preferredId || chatbots[0]?.id || "");
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const bot = chatbots.find((b) => b.id === botId);

  const load = useCallback(() => {
    if (!bot) {
      setDocs([]);
      return;
    }
    api.documents(bot.kbCollectionName).then((d) => setDocs(d.documents)).catch(() => setDocs([]));
  }, [bot]);

  useEffect(() => {
    if (preferredId) setBotId(preferredId);
  }, [preferredId]);

  useEffect(() => {
    if (!botId && chatbots[0]) setBotId(chatbots[0].id);
  }, [chatbots, botId]);

  useEffect(() => {
    load();
  }, [load]);

  const needAssistant = () => {
    setStatus("Create an assistant first, then drop files onto this page.");
    onCreateAssistant();
  };

  const ingestText = async (docTitle: string, body: string, source: string) => {
    if (!bot) {
      needAssistant();
      return;
    }
    setBusy(true);
    setStatus("Saving…");
    try {
      const res = await api.ingest({
        collectionName: bot.kbCollectionName,
        content: body,
        source,
        title: docTitle,
        category: "general",
      });
      setStatus(`Saved ${res.result.chunksCount} sections from “${res.result.title}”.`);
      setTitle("");
      setContent("");
      load();
      onRefresh();
    } catch (err: any) {
      setStatus(err?.message || "Couldn’t save. Check the server is running.");
    } finally {
      setBusy(false);
    }
  };

  const ingestFile = async (file: File) => {
    if (!bot) {
      needAssistant();
      return;
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".md") && !name.endsWith(".markdown") && !name.endsWith(".csv")) {
      setStatus("Upload a .txt, .md, or .csv file. For PDFs, paste the text below.");
      return;
    }
    setBusy(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const res = await api.uploadFile(file, bot.kbCollectionName, title.trim() || file.name);
      setStatus(`Saved ${res.result.chunksCount} sections from “${res.result.title}”.`);
      setTitle("");
      load();
      onRefresh();
    } catch (err: any) {
      setStatus(err?.message || "Upload failed. Is the server running?");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingestFile(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    await ingestText(title.trim(), content, `${title.toLowerCase().replace(/\s+/g, "_")}.md`);
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove “${name}”? Answers will no longer cite it.`)) return;
    try {
      await api.deleteDocument(id);
      load();
      onRefresh();
    } catch (err: any) {
      setStatus(err?.message || "Couldn’t delete.");
    }
  };

  return (
    <div className="knowledge">
      <p className="eyebrow">Knowledge</p>
      <h1>What the assistant can cite</h1>
      <p className="lede">
        Drop a policy or paste the source of truth. Answers stay inside these pages.
      </p>

      {chatbots.length === 0 ? (
        <div className="empty cta-empty">
          <p>Create an assistant first — then drop files here so it has something to answer from.</p>
          <button type="button" className="btn primary" onClick={onCreateAssistant}>
            New assistant
          </button>
        </div>
      ) : (
        <label className="inline-select">
          Assistant
          <select value={botId} onChange={(e) => setBotId(e.target.value)}>
            {chatbots.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
      )}

      <div
        className={`dropzone ${dragOver ? "over" : ""} ${!bot || busy ? "disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (bot && !busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (!bot) {
            onCreateAssistant();
            return;
          }
          if (!busy) fileInput.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void ingestFile(file);
          }}
        />
        <strong>{bot ? `Drop a file for ${bot.name}` : "Drop a file here"}</strong>
        <span>.txt, .md, or .csv — or click to choose. PDFs: paste the text below.</span>
      </div>

      <div className="split tight">
        <form className="card form-card" onSubmit={submit}>
          <h2>Or paste text</h2>
          <label>
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Warranty 2026"
              required
              disabled={!bot || busy}
            />
          </label>
          <label>
            Content
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder={"# Returns\nItems can be exchanged within 14 days..."}
              required
              disabled={!bot || busy}
            />
          </label>
          <button type="submit" className="btn primary" disabled={!bot || busy}>
            {busy ? "Saving…" : `Save to ${bot?.name || "assistant"}`}
          </button>
          {status && <p className="form-note">{status}</p>}
        </form>

        <div className="card">
          <h2>On file</h2>
          {docs.length === 0 && (
            <p className="muted">
              {bot ? "Nothing uploaded for this assistant yet." : "Documents will appear here after you add an assistant."}
            </p>
          )}
          <ul className="doc-list">
            {docs.map((d) => (
              <li key={d.id}>
                <div>
                  <strong>{d.title}</strong>
                  <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                </div>
                <button type="button" className="danger-text" onClick={() => remove(d.id, d.title)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
