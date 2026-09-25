import type { Chatbot, PageId, Status } from "../types";

interface Props {
  status: Status | null;
  chatbots: Chatbot[];
  documentCount: number;
  sentHi: boolean;
  onSentHi: () => void;
  onPage: (p: PageId) => void;
}

export function Setup({ status, chatbots, documentCount, sentHi, onSentHi, onPage }: Props) {
  const steps = [
    {
      id: 1,
      title: "Connect WhatsApp",
      done: Boolean(status?.tokenConfigured),
      body: status?.live
        ? `Replies will send through ${status.channelLabel}.`
        : "Connect a WhatsApp Business number in Settings (Meta cookbook), then come back here.",
      action: { label: "Open Settings", page: "settings" as PageId },
    },
    {
      id: 2,
      title: "Name an assistant",
      done: chatbots.length > 0,
      body: chatbots.length
        ? `${chatbots.map((c) => c.name).join(", ")} can answer from documents you attach.`
        : "Give it a job — returns, pricing, onboarding — and how it should speak.",
      action: { label: "Add assistant", page: "assistants" as PageId },
    },
    {
      id: 3,
      title: "Add knowledge",
      done: documentCount > 0,
      body: documentCount
        ? `${documentCount} document${documentCount === 1 ? "" : "s"} on file.`
        : "Paste a policy or playbook. The assistant will only answer from what you add.",
      action: { label: "Add a document", page: "knowledge" as PageId },
    },
    {
      id: 4,
      title: "Message it from your phone",
      done: sentHi,
      body: status?.displayPhone
        ? `Open WhatsApp, start a chat with ${status.displayPhone}, and send Hi.`
        : "Connect a number in Settings, then send Hi from your own phone.",
      action: null,
    },
  ];

  return (
    <div className="setup">
      <p className="eyebrow">Four steps</p>
      <h1>Get a working line this afternoon</h1>
      <p className="lede">Tick these off in order. You can come back; progress stays on this computer.</p>

      <ol className="setup-list">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "done" : ""}>
            <span className="num">{s.done ? "✓" : s.id}</span>
            <div>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              {s.id === 1 && status?.displayPhone && (
                <div className="callout">
                  <strong>Number to share</strong>
                  <code>{status.displayPhone}</code>
                  {status.waMeUrl && (
                    <a href={status.waMeUrl} target="_blank" rel="noreferrer">Open chat</a>
                  )}
                  <small>{status.setupHint}</small>
                </div>
              )}
              {s.id === 4 && (
                <label className="check">
                  <input type="checkbox" checked={sentHi} onChange={onSentHi} />
                  I’ve sent Hi and got a reply
                </label>
              )}
              {s.action && (
                <button type="button" className="btn primary sm" onClick={() => onPage(s.action!.page)}>
                  {s.action.label}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
