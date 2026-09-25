import { useEffect, useState } from "react";
import { api } from "../api";
import type { WebhookConfig } from "../types";

const STEPS = ["Requirements", "User token", "Phone number", "Webhook"];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function WhatsAppCookbook({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [name, setName] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolvedPhone, setResolvedPhone] = useState<string | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [hook, setHook] = useState<WebhookConfig | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!open) return;
    api.webhookConfig().then(setHook).catch(() => setHook(null));
  }, [open]);

  const reset = () => {
    setStep(0);
    setAccessToken("");
    setPhoneNumberId("");
    setName("");
    setWabaId("");
    setError(null);
    setBusy(false);
    setResolvedPhone(null);
    setResolvedName(null);
  };

  const close = () => {
    onClose();
    setTimeout(reset, 200);
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setError(`Couldn’t copy ${label}. Select the text and copy it yourself.`);
    }
  };

  const validateToken = () => {
    const t = accessToken.trim();
    if (!t) {
      setError("Access token is required.");
      return false;
    }
    if (!t.startsWith("EA")) {
      setError("Meta tokens typically start with EA. Paste the full system-user token.");
      return false;
    }
    if (t.length < 20) {
      setError("That token is too short. Paste the whole value from Meta.");
      return false;
    }
    return true;
  };

  const verifyPhone = async () => {
    const id = phoneNumberId.trim();
    if (!id) {
      setError("Phone number ID is required.");
      return false;
    }
    if (!/^\d{10,}$/.test(id)) {
      setError("Phone number ID is the numeric ID from Meta — not the +91… number.");
      return false;
    }
    setBusy(true);
    try {
      const result = await api.lookupPhoneNumber(accessToken.trim(), id);
      setResolvedPhone(result.displayPhoneNumber);
      setResolvedName(result.verifiedName);
      if (!name.trim() && result.verifiedName) setName(result.verifiedName);
      return true;
    } catch (err: any) {
      setError(err?.message || "Meta could not verify that ID with this token.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    setError(null);
    if (step === 1 && !validateToken()) return;
    if (step === 2) {
      const ok = await verifyPhone();
      if (!ok) return;
    }
    if (step === STEPS.length - 1) {
      if (!resolvedPhone) {
        setError("Verify the Phone number ID before finishing.");
        return;
      }
      setBusy(true);
      try {
        await api.createWhatsAppCredential({
          name: name.trim() || resolvedName || "WhatsApp number",
          accessToken: accessToken.trim(),
          phoneNumberId: phoneNumberId.trim(),
          displayPhoneNumber: resolvedPhone,
          verifiedName: resolvedName || undefined,
          whatsappBusinessAccountId: wabaId.trim() || undefined,
        });
        onCreated();
        close();
      } catch (err: any) {
        setError(err?.message || "Couldn’t save this number.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep((s) => s + 1);
  };

  if (!open) return null;

  const webhookUrl = hook?.callbackUrl || `${window.location.origin.replace(/:\d+$/, ":3000")}/api/webhooks/whatsapp`;
  const verifyToken = hook?.verifyToken || "";

  return (
    <div className="modal" onClick={close}>
      <div className="modal-card cookbook" onClick={(e) => e.stopPropagation()}>
        <div className="cook-head">
          {step > 0 && (
            <button type="button" className="linkish cook-back" onClick={() => { setError(null); setStep((s) => Math.max(0, s - 1)); }}>
              Back
            </button>
          )}
          <h2>Connect a WhatsApp Business number</h2>
          <ol className="cook-steps">
            {STEPS.map((title, i) => (
              <li key={title} className={i === step ? "on" : i < step ? "done" : ""}>
                <span>{i < step ? "✓" : i + 1}</span>
                {title}
              </li>
            ))}
          </ol>
        </div>

        {error && <p className="banner warn">{error}</p>}
        {copied && <p className="form-note">Copied {copied}.</p>}

        {step === 0 && (
          <div className="cook-body">
            <p>
              Create a Meta app with the WhatsApp product, then come back with a system-user token and a Phone number ID.
            </p>
            <p>
              <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">
                Open Meta Developer apps
              </a>
            </p>
            <ol className="cook-list">
              <li>Create an app (type: Business) and add <strong>WhatsApp</strong>.</li>
              <li>You should land on API Setup / Quickstart for that app.</li>
              <li>Keep that tab open — the next steps copy values from it.</li>
            </ol>
            <p className="muted">The webhook must be HTTPS. Until App Review, only tester numbers you add in Meta can message this line.</p>
          </div>
        )}

        {step === 1 && (
          <div className="cook-body">
            <ol className="cook-list">
              <li>
                Open{" "}
                <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer">
                  System users
                </a>
                .
              </li>
              <li>Click <strong>Add</strong>, any name, role <strong>Admin</strong>.</li>
              <li>Add assets → Apps → your app → <strong>Manage app</strong>.</li>
              <li>
                Generate a token for that app. Expiration: Never. Permissions:{" "}
                <code>whatsapp_business_messaging</code>, <code>whatsapp_business_management</code>.
              </li>
            </ol>
            <label>
              System user token
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="EAxxxx…"
                autoComplete="off"
              />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="cook-body">
            <ol className="cook-list">
              <li>In WhatsApp → API Setup, add a phone number if you don’t have one.</li>
              <li>Copy the <strong>Phone number ID</strong> (digits only — not +91…).</li>
            </ol>
            <label>
              Phone number ID
              <input value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} placeholder="986914541176866" />
            </label>
            <label>
              Label
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 100))} placeholder="Support line" />
            </label>
            <label>
              WhatsApp Business Account ID <span className="muted">(optional)</span>
              <input value={wabaId} onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ""))} placeholder="942080224962111" />
            </label>
            {resolvedPhone && (
              <p className="form-note">
                Verified {resolvedPhone}
                {resolvedName ? ` (${resolvedName})` : ""}
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="cook-body">
            {resolvedPhone && (
              <p className="form-note">This line will send as {resolvedPhone}.</p>
            )}
            <p>
              In Meta → WhatsApp → Configuration, edit the webhook and paste these values. Subscribe to <strong>messages</strong>.
            </p>
            <CopyRow label="Callback URL" value={webhookUrl} onCopy={() => copy(webhookUrl, "callback URL")} />
            {hook?.fallbackCallbackUrl && hook.fallbackCallbackUrl !== webhookUrl && (
              <CopyRow
                label="Fallback callback"
                value={hook.fallbackCallbackUrl}
                onCopy={() => copy(hook.fallbackCallbackUrl, "fallback URL")}
              />
            )}
            <CopyRow
              label="Verify token"
              value={verifyToken || "Set WHATSAPP_VERIFY_TOKEN on the server, then reopen this step."}
              onCopy={() => verifyToken && copy(verifyToken, "verify token")}
            />
            {!hook?.verifyTokenConfigured && (
              <p className="banner warn">Set WHATSAPP_VERIFY_TOKEN on the server before Meta can verify the webhook.</p>
            )}
            <p className="muted">
              One Meta app can point at the shared callback. ToolTap routes inbound messages by Phone number ID.
              You can also use a per-number path: <code>/api/webhooks/whatsapp/&lt;id&gt;</code>.
            </p>
          </div>
        )}

        <div className="row-actions end">
          <button type="button" className="btn ghost" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void next()} disabled={busy}>
            {busy ? (step === 2 ? "Verifying…" : "Saving…") : step === STEPS.length - 1 ? "Finish" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div className="copy-row">
      <span>{label}</span>
      <code>{value}</code>
      <button type="button" className="btn ghost sm" onClick={onCopy}>Copy</button>
    </div>
  );
}
