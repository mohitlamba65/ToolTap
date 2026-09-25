import { useEffect, useState } from "react";
import type { Status, WhatsAppCredential } from "../types";
import { api } from "../api";
import { WhatsAppCookbook } from "../components/WhatsAppCookbook";

interface Props {
  status: Status | null;
  onRefresh: () => void;
}

export function Settings({ status, onRefresh }: Props) {
  const [numbers, setNumbers] = useState<WhatsAppCredential[]>([]);
  const [wizard, setWizard] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = () => {
    api.whatsappCredentials()
      .then((d) => {
        setNumbers(d.credentials || []);
        setLoadError("");
      })
      .catch((err: any) => {
        setNumbers([]);
        setLoadError(err?.message || "Couldn’t load numbers.");
      });
  };

  useEffect(() => {
    load();
  }, []);

  const switchProvider = async (provider: string) => {
    await api.setProvider(provider);
    onRefresh();
  };

  const activate = async (id: string) => {
    await api.activateWhatsAppCredential(id);
    load();
    onRefresh();
  };

  const remove = async (c: WhatsAppCredential) => {
    if (!confirm(`Remove “${c.name}”? This does not delete the number in Meta.`)) return;
    await api.deleteWhatsAppCredential(c.id);
    load();
    onRefresh();
  };

  return (
    <div className="settings">
      <p className="eyebrow">Settings</p>
      <h1>WhatsApp numbers</h1>
      <p className="lede">
        Connect Cloud API numbers here. ToolTap stores the token encrypted and uses the active number to send and receive.
      </p>

      <div className="page-head">
        <div>
          <h2>Connected lines</h2>
          <p className="muted">Switch which number is live without editing the server environment.</p>
        </div>
        <button type="button" className="btn primary" onClick={() => setWizard(true)}>
          Connect number
        </button>
      </div>

      {loadError && <p className="banner warn">{loadError}</p>}

      {numbers.length === 0 && (
        <div className="empty cta-empty">
          <p>No WhatsApp Business numbers yet. Walk through the Meta cookbook — about ten minutes if the app already exists.</p>
          <button type="button" className="btn primary" onClick={() => setWizard(true)}>
            Connect a WhatsApp Business number
          </button>
        </div>
      )}

      <div className="card-grid">
        {numbers.map((c) => (
          <article key={c.id} className={`card number-card-item ${c.isActive ? "active-num" : ""}`}>
            <header>
              <h2>{c.name}</h2>
              {c.isActive && <span className="status-chip live"><span className="dot" /> Active</span>}
            </header>
            <p className="big-phone">{c.metadata.displayPhoneNumber || "Unknown number"}</p>
            {c.metadata.verifiedName && <p className="muted">{c.metadata.verifiedName}</p>}
            <p className="muted">Phone number ID {c.metadata.phoneNumberId}</p>
            <div className="row-actions">
              {!c.isActive && (
                <button type="button" className="btn ghost sm" onClick={() => void activate(c.id)}>
                  Make active
                </button>
              )}
              <button type="button" className="danger-text" onClick={() => void remove(c)}>
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>

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
          Cloud API is the production path. Twilio remains a sandbox while you wait on Meta. Twilio still uses environment variables.
        </p>
      </div>

      <div className="card">
        <h2>Connection</h2>
        <ul className="kv">
          <li><span>Status</span><strong>{status?.live ? "Ready to send" : "No active number"}</strong></li>
          <li><span>Active line</span><strong>{status?.displayPhone || "None"}</strong></li>
          <li><span>Saved numbers</span><strong>{status?.numberCount ?? numbers.length}</strong></li>
          <li><span>Assistants</span><strong>{status?.assistantCount ?? 0}</strong></li>
        </ul>
        <p className="muted">{status?.setupHint}</p>
      </div>

      <WhatsAppCookbook
        open={wizard}
        onClose={() => setWizard(false)}
        onCreated={() => {
          load();
          onRefresh();
        }}
      />
    </div>
  );
}
