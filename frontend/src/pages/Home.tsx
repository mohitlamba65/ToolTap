import { useEffect, useState } from "react";
import type { Chatbot, PageId, RagSource, Status, WaMessage } from "../types";
import { WhatsAppPhone, buildCapabilityList } from "../components/WhatsAppPhone";
import { PipelineStepper } from "../components/PipelineStepper";
import { parseAssistantReply, userText } from "../parseReply";
import { api } from "../api";

interface Props {
  status: Status | null;
  chatbots: Chatbot[];
  onPage: (p: PageId) => void;
  setupDone: number;
}

export function Home({ status, chatbots, onPage, setupDone }: Props) {
  const [messages, setMessages] = useState<WaMessage[]>(() => demoStart(chatbots));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [hint, setHint] = useState(true);
  const [sources, setSources] = useState<RagSource[]>([]);
  const [showSources, setShowSources] = useState(false);

  const phone = status?.displayPhone;
  const live = Boolean(status?.live);
  const bot = chatbots[0];

  useEffect(() => {
    if (hint) setMessages(demoStart(chatbots));
  }, [chatbots, hint]);

  const ask = async (text: string, botId?: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setHint(false);
    setDraft("");
    setSending(true);
    setMessages((prev) => [...prev, userText(trimmed, `u-${Date.now()}`)]);

    const target = (botId && chatbots.find((b) => b.id === botId)) || bot;
    if (!target) {
      setMessages((prev) => [
        ...prev,
        parseAssistantReply(
          "Create an assistant and add a document first — then this preview answers from your files. Until then, tap View options to see the menu a customer gets.",
          `a-${Date.now()}`
        ),
      ]);
      setSending(false);
      return;
    }

    try {
      const res = await api.query(target.id, trimmed);
      setMessages((prev) => [...prev, parseAssistantReply(res.result.answer, `a-${Date.now()}`)]);
      setSources(res.result.sources || []);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        parseAssistantReply(
          err?.message
            ? `I couldn’t complete that: ${err.message}`
            : "I couldn’t reach the server. Start the ToolTap backend, then try again.",
          `e-${Date.now()}`
        ),
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleChoice = (title: string, id: string) => {
    setHint(false);
    if (id === "menu") {
      setMessages((prev) => [
        ...prev,
        userText(title, `u-${Date.now()}`),
        {
          id: `list-${Date.now()}`,
          from: "assistant",
          kind: "list",
          header: "What I can help with",
          text: "Here’s everything I can help you with. Pick a topic or just type.",
          footer: "Or send a message in your own words.",
          buttonText: "View options",
          sections: buildCapabilityList(chatbots),
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      return;
    }
    if (id.startsWith("cap_")) {
      setMessages((prev) => [
        ...prev,
        userText(title, `u-${Date.now()}`),
        capabilityReply(id),
      ]);
      return;
    }
    if (id.startsWith("bot_")) {
      const chosen = chatbots.find((b) => id === `bot_${b.id}`);
      void ask(`Tell me what you can help with on ${title}.`, chosen?.id);
      return;
    }
    void ask(title);
  };

  const replay = () => {
    setMessages(demoStart(chatbots));
    setHint(true);
    setSources([]);
    setDraft("");
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
            <span>You should get a menu of actions and topics. Try it in the phone on the right.</span>
          </li>
        </ol>

        <PipelineStepper
          documentCount={status?.documentCount ?? 0}
          onAddKnowledge={() => onPage("knowledge")}
        />

        {sources.length > 0 && (
          <div>
            <button type="button" className="linkish" onClick={() => setShowSources((s) => !s)}>
              {showSources ? "Hide sources" : "Show sources"}
            </button>
            {showSources && (
              <ul className="src-list">
                {sources.map((s, i) => (
                  <li key={i}>
                    {s.title}
                    {s.heading_path ? ` — ${s.heading_path}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <aside className="phone-col">
        <p className="phone-caption">
          Tap <strong>View options</strong>, pick a topic, then type a question. This preview does not send a real WhatsApp message.
        </p>
        <WhatsAppPhone
          businessName={status?.displayPhone ? "Your business" : "ToolTap"}
          subtitle={live ? "online" : "preview"}
          messages={messages}
          composer
          composerValue={draft}
          onComposerChange={setDraft}
          onSend={() => void ask(draft)}
          sending={sending}
          onButton={(title, id) => handleChoice(title, id)}
          onListRow={(title, id) => handleChoice(title, id)}
          pulseListCta={hint}
          placeholder="Type a question"
        />
        <button type="button" className="linkish" onClick={replay}>
          Replay conversation
        </button>
      </aside>
    </div>
  );
}

function demoStart(chatbots: Chatbot[]): WaMessage[] {
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

function capabilityReply(id: string): WaMessage {
  const copy: Record<string, string> = {
    cap_web: "On the live line I can search the web for you. In this preview, type a question about your documents instead — or open WhatsApp on your phone.",
    cap_weather: "On the live line I can fetch a forecast. Type a city on your phone after you connect WhatsApp, or ask about your documents here.",
    cap_email: "On the live line I can send or check mail when that’s set up. Here, ask a question from a document you’ve uploaded.",
  };
  return {
    id: `cap-${Date.now()}`,
    from: "assistant",
    kind: "buttons",
    text: copy[id] || "Pick another option, or type in your own words.",
    buttons: [
      { id: "menu", title: "Show menu" },
    ],
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}
