import type { Status } from "../types";
import { api } from "../api";

interface Props {
  status: Status | null;
  onRefresh: () => void;
}

export function Settings({ status, onRefresh }: Props) {
  const switchProvider = async (provider: string) => {
    await api.setProvider(provider);
    onRefresh();
  };

  return (
    <div className="settings">
      <p className="eyebrow">Settings</p>
      <h1>How this number is connected</h1>
      <p className="lede">Most teams leave this alone after the first afternoon.</p>

      <div className="card">
        <h2>Channel</h2>
        <div className="seg">
          <button
            type="button"
            className={status?.provider === "meta" ? "on" : ""}
            onClick={() => switchProvider("meta")}
          >
            WhatsApp Cloud API
          </button>
          <button
            type="button"
            className={status?.provider === "twilio" ? "on" : ""}
            onClick={() => switchProvider("twilio")}
          >
            Twilio
          </button>
        </div>
        <p className="muted">
          Cloud API is the usual production path. Twilio is handy for a sandbox number while you wait on Meta approval.
        </p>
      </div>

      <div className="card">
        <h2>Number customers see</h2>
        <p className="big-phone">{status?.displayPhone || "Not set"}</p>
        <p className="muted">
          Ask whoever runs the server to set the customer-facing E.164 number (the one on the WhatsApp Business profile), then restart.
          It should look like +9198xxxxxxx.
        </p>
        {status?.waMeUrl && (
          <a className="btn primary sm" href={status.waMeUrl} target="_blank" rel="noreferrer">Open in WhatsApp</a>
        )}
      </div>

      <div className="card">
        <h2>Connection</h2>
        <ul className="kv">
          <li><span>Status</span><strong>{status?.live ? "Ready to send" : "Credentials missing"}</strong></li>
          <li><span>Assistants</span><strong>{status?.assistantCount ?? 0}</strong></li>
          <li><span>Documents</span><strong>{status?.documentCount ?? 0}</strong></li>
        </ul>
        <p className="muted">{status?.setupHint}</p>
      </div>
    </div>
  );
}
