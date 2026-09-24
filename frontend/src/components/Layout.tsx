import type { PageId, Status } from "../types";

const NAV: { id: PageId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "setup", label: "Get started" },
  { id: "assistants", label: "Assistants" },
  { id: "knowledge", label: "Knowledge" },
  { id: "try", label: "Try it" },
  { id: "settings", label: "Settings" },
];

interface Props {
  page: PageId;
  onPage: (p: PageId) => void;
  status: Status | null;
  setupDone: number;
  children: React.ReactNode;
}

export function Layout({ page, onPage, status, setupDone, children }: Props) {
  const live = Boolean(status?.live);
  const phone = status?.displayPhone;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Tt</span>
          <div>
            <strong>ToolTap</strong>
            <em>WhatsApp console</em>
          </div>
        </div>
        <nav>
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? "active" : ""}
              onClick={() => onPage(item.id)}
            >
              {item.label}
              {item.id === "setup" && setupDone < 4 && <i>{setupDone}/4</i>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`pulse ${live ? "on" : "off"}`} />
          {live ? "Connected" : "Not connected"}
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className={`status-chip ${live ? "live" : "warn"}`}>
            <span className="dot" />
            {live ? "Live" : "Finish setup"}
            {phone ? ` · ${phone}` : " · No number yet"}
          </div>
          {status?.waMeUrl && (
            <a className="wa-open" href={status.waMeUrl} target="_blank" rel="noreferrer">
              Open in WhatsApp
            </a>
          )}
        </header>
        <main className="page">{children}</main>
      </div>
    </div>
  );
}
