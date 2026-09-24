import { useState } from "react";
import type { Chatbot, PageId, Status, WaMessage } from "../types";
import { WhatsAppPhone, buildCapabilityList } from "../components/WhatsAppPhone";
import { userText } from "../parseReply";

interface Props {
  status: Status | null;
  chatbots: Chatbot[];
  onPage: (p: PageId) => void;
  setupDone: number;
}

export function Home({ status, chatbots, onPage, setupDone }: Props) {
  const [messages, setMessages] = useState<WaMessage[]>(() => demoStart(chatbots, status));

  const phone = status?.displayPhone;
  const live = Boolean(status?.live);

  const handleChoice = (title: string) => {
    const bot = chatbots.find((b) => b.name.toLowerCase().includes(title.toLowerCase().slice(0, 12))) || chatbots[0];
    setMessages((prev) => [
      ...prev,
      userText(title, `u-${prev.length}`),
      {
        id: `a-${prev.length}`,
        from: "assistant",
        kind: "buttons",
        text: bot
          ? `I can help with ${bot.name.toLowerCase()} using the documents you’ve added. Ask a real question from your phone — I’ll keep answers short and offer the next step as buttons.`
          : "Tell me what you need. I can look up live information, or answer from the files you upload here.",
        buttons: [
          { id: "deeper", title: "Go deeper" },
          { id: "other", title: "Something else" },
          { id: "menu", title: "Show menu" },
        ],
        time: "10:43",
      },
    ]);
  };

  return (
    <div className="split">
      <section className="copy-col">
        <p className="eyebrow">Your WhatsApp line</p>
        <h1>Customers message this number. You stay in control of what it knows.</h1>
        <p className="lede">
          ToolTap replies on WhatsApp using your documents and a few everyday actions — search, weather, email.
          No one needs an app. They already have WhatsApp.
        </p>

        <div className="number-card">
          <span>Ask people to message</span>
          <strong>{phone || "Add your business number in Settings"}</strong>
          <p>
            {live
              ? status?.setupHint
              : "Connect WhatsApp in Get started so this line can reply."}
          </p>
          <div className="row-actions">
            {status?.waMeUrl && (
              <a className="btn primary" href={status.waMeUrl} target="_blank" rel="noreferrer">
                Message this number
              </a>
            )}
            <button type="button" className="btn ghost" onClick={() => onPage("setup")}>
              {setupDone < 4 ? "Continue setup" : "Review setup"}
            </button>
          </div>
        </div>

        <ol className="how">
          <li>
            <button type="button" onClick={() => onPage("setup")}>Save the number</button>
            <span>on your phone as you would a colleague.</span>
          </li>
          <li>
            <button type="button" onClick={() => onPage("knowledge")}>Add a document</button>
            <span>policies, playbooks, FAQs — plain text is enough.</span>
          </li>
          <li>
            <span className="plain">Send Hi</span>
            <span>You should get a menu of actions and topics.</span>
          </li>
        </ol>

        <svg className="path-svg" viewBox="0 0 520 88" aria-hidden="true">
          <text x="8" y="22" className="path-label">Phone</text>
          <text x="150" y="22" className="path-label">WhatsApp</text>
          <text x="300" y="22" className="path-label">Your files</text>
          <text x="430" y="22" className="path-label">Reply</text>
          <rect x="4" y="36" width="88" height="40" rx="10" />
          <rect x="146" y="36" width="88" height="40" rx="10" />
          <rect x="288" y="36" width="88" height="40" rx="10" />
          <rect x="430" y="36" width="86" height="40" rx="10" />
          <path d="M92 56 H146 M234 56 H288 M376 56 H430" />
        </svg>
      </section>

      <aside className="phone-col">
        <p className="phone-caption">Tap the menu. This is how a first conversation looks.</p>
        <WhatsAppPhone
          businessName={status?.displayPhone ? "Your business" : "ToolTap"}
          subtitle={live ? "online" : "preview"}
          messages={messages}
          onButton={(title) => handleChoice(title)}
          onListRow={(title) => handleChoice(title)}
        />
        <button type="button" className="linkish" onClick={() => setMessages(demoStart(chatbots, status))}>
          Replay conversation
        </button>
      </aside>
    </div>
  );
}

function demoStart(chatbots: Chatbot[], status: Status | null): WaMessage[] {
  return [
    { id: "d1", from: "user", kind: "text", text: "Hi", time: "10:42" },
    {
      id: "d2",
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
