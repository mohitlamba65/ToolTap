import { useState } from "react";
import type { Chatbot } from "../types";
import { api } from "../api";

interface Props {
  chatbots: Chatbot[];
  onRefresh: () => void;
  onOpenKnowledge: (id: string) => void;
}

export function Assistants({ chatbots, onRefresh, onOpenKnowledge }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tone, setTone] = useState("Be clear, brief, and professional. Answer only from the documents provided.");
  const [phrases, setPhrases] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.createChatbot({
        name: name.trim(),
        description: description.trim(),
        systemPrompt: tone.trim(),
        triggerKeywords: phrases.split(",").map((s) => s.trim()).filter(Boolean),
        kbCollectionName: `kb_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      });
      setOpen(false);
      setName("");
      setDescription("");
      setPhrases("");
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Assistants</p>
          <h1>Topics your number can speak to</h1>
          <p className="lede">Each assistant owns its own documents. Customers don’t pick a bot — they just write.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setOpen(true)}>
          New assistant
        </button>
      </div>

      {chatbots.length === 0 && !open && (
        <div className="empty cta-empty">
          <p>No assistants yet. Create one for a single job — returns, pricing, a playbook.</p>
          <button type="button" className="btn primary" onClick={() => setOpen(true)}>
            New assistant
          </button>
        </div>
      )}

      <div className="card-grid">
        {chatbots.map((bot) => (
          <article key={bot.id} className="card">
            <header>
              <h2>{bot.name}</h2>
              <button type="button" className="danger-text" onClick={async () => {
                if (!confirm(`Remove ${bot.name}?`)) return;
                await api.deleteChatbot(bot.id);
                onRefresh();
              }}>
                Remove
              </button>
            </header>
            <p>{bot.description || "Answers from its knowledge files."}</p>
            {bot.triggerKeywords.length > 0 && (
              <p className="phrases">
                People often mention: {bot.triggerKeywords.slice(0, 6).join(", ")}
              </p>
            )}
            <button type="button" className="btn ghost sm" onClick={() => onOpenKnowledge(bot.id)}>
              Add knowledge
            </button>
          </article>
        ))}
      </div>

      {open && (
        <div className="modal" onClick={() => setOpen(false)}>
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <h2>New assistant</h2>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Returns & warranty" required />
            </label>
            <label>
              What it’s for
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Helps customers with exchanges and coverage" />
            </label>
            <label>
              How it should talk
              <textarea value={tone} onChange={(e) => setTone(e.target.value)} rows={4} />
            </label>
            <label>
              Phrases that should find it
              <input value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder="warranty, return, refund" />
            </label>
            <div className="row-actions end">
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
