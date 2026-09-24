import { useEffect, useRef, useState } from "react";
import type { WaListSection, WaMessage } from "./types";

interface Props {
  businessName: string;
  subtitle?: string;
  messages: WaMessage[];
  onButton?: (title: string, id: string) => void;
  onListRow?: (title: string, id: string) => void;
  composer?: boolean;
  composerValue?: string;
  onComposerChange?: (v: string) => void;
  onSend?: () => void;
  sending?: boolean;
  placeholder?: string;
}

export function WhatsAppPhone({
  businessName,
  subtitle = "online",
  messages,
  onButton,
  onListRow,
  composer = false,
  composerValue = "",
  onComposerChange,
  onSend,
  sending,
  placeholder = "Message",
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [listOpen, setListOpen] = useState<WaMessage & { kind: "list" } | null>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, listOpen]);

  return (
    <div className="wa-phone">
      <div className="wa-notch">
        <span>9:41</span>
        <span className="wa-notch-icons">▮▮▮ ⬤</span>
      </div>
      <header className="wa-header">
        <span className="wa-back">‹</span>
        <div className="wa-avatar">{businessName.slice(0, 1).toUpperCase()}</div>
        <div className="wa-header-text">
          <strong>{businessName}</strong>
          <span>{subtitle}</span>
        </div>
        <span className="wa-header-actions">📹 📞 ⋮</span>
      </header>

      <div className="wa-thread" ref={scroller}>
        <p className="wa-today">Today</p>
        {messages.map((m) => (
          <div key={m.id} className={`wa-row ${m.from}`}>
            <div className={`wa-bubble ${m.from}`}>
              {m.kind !== "text" && m.kind === "list" && m.header && (
                <div className="wa-header-in">{m.header}</div>
              )}
              <p>{m.text}</p>
              {m.kind === "buttons" && (
                <div className="wa-chips">
                  {m.buttons.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onButton?.(b.title, b.id)}
                    >
                      {b.title}
                    </button>
                  ))}
                </div>
              )}
              {m.kind === "list" && (
                <button
                  type="button"
                  className="wa-list-cta"
                  onClick={() => setListOpen(m)}
                >
                  {m.buttonText}
                </button>
              )}
              {m.kind === "list" && m.footer && <p className="wa-footer-in">{m.footer}</p>}
              <time>{m.time}{m.from === "user" ? " ✓✓" : ""}</time>
            </div>
          </div>
        ))}
      </div>

      {listOpen && (
        <div className="wa-sheet" role="dialog" aria-label="Options">
          <button type="button" className="wa-sheet-scrim" onClick={() => setListOpen(null)} />
          <div className="wa-sheet-card">
            <div className="wa-sheet-handle" />
            <h3>{listOpen.header || "Options"}</h3>
            {listOpen.sections.map((section) => (
              <div key={section.title} className="wa-section">
                <p>{section.title}</p>
                {section.rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setListOpen(null);
                      onListRow?.(row.title, row.id);
                    }}
                  >
                    <strong>{row.title}</strong>
                    {row.description && <span>{row.description}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {composer && (
        <form
          className="wa-composer"
          onSubmit={(e) => {
            e.preventDefault();
            onSend?.();
          }}
        >
          <input
            value={composerValue}
            onChange={(e) => onComposerChange?.(e.target.value)}
            placeholder={placeholder}
            disabled={sending}
          />
          <button type="submit" disabled={sending || !composerValue.trim()} aria-label="Send">
            ➤
          </button>
        </form>
      )}
    </div>
  );
}

export function buildCapabilityList(assistants: { id: string; name: string; description: string }[]): WaListSection[] {
  const sections: WaListSection[] = [
    {
      title: "Quick actions",
      rows: [
        { id: "cap_web", title: "Web search", description: "Look up live information" },
        { id: "cap_weather", title: "Weather", description: "Forecast for a city" },
        { id: "cap_email", title: "Email", description: "Send or check mail" },
      ],
    },
  ];
  if (assistants.length > 0) {
    sections.push({
      title: "Ask about",
      rows: assistants.slice(0, 5).map((a) => ({
        id: `bot_${a.id}`,
        title: a.name.slice(0, 24),
        description: (a.description || "Answers from your documents").slice(0, 72),
      })),
    });
  }
  return sections;
}
