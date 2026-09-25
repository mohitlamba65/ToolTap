import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Setup } from "./pages/Setup";
import { Assistants } from "./pages/Assistants";
import { Knowledge } from "./pages/Knowledge";
import { TryIt } from "./pages/TryIt";
import { Settings } from "./pages/Settings";
import { api } from "./api";
import type { Chatbot, PageId, Status } from "./types";

const SENT_KEY = "tooltap.sentHi";

export default function App() {
  const [page, setPage] = useState<PageId>("home");
  const [status, setStatus] = useState<Status | null>(null);
  const [chatbots, setChatbots] = useState<Chatbot[]>([]);
  const [knowledgeBot, setKnowledgeBot] = useState<string | undefined>();
  const [sentHi, setSentHi] = useState(() => localStorage.getItem(SENT_KEY) === "1");
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([api.status(), api.chatbots()])
      .then(([s, c]) => {
        setStatus(s);
        setChatbots(c.chatbots || []);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setupDone = useMemo(() => {
    let n = 0;
    if (status?.tokenConfigured) n++;
    if (chatbots.length > 0) n++;
    if ((status?.documentCount ?? 0) > 0) n++;
    if (sentHi) n++;
    return n;
  }, [status, chatbots.length, sentHi]);

  useEffect(() => {
    if (status && setupDone < 4 && page === "home") {
      /* stay on home; chip points to setup */
    }
  }, [status, setupDone, page]);

  const goKnowledge = (id: string) => {
    setKnowledgeBot(id);
    setPage("knowledge");
  };

  return (
    <Layout page={page} onPage={setPage} status={status} setupDone={setupDone}>
      {offline && (
        <div className="banner warn">
          Can’t reach the ToolTap server. Start the backend on port 3000, then refresh.
        </div>
      )}
      {page === "home" && (
        <Home status={status} chatbots={chatbots} onPage={setPage} setupDone={setupDone} />
      )}
      {page === "setup" && (
        <Setup
          status={status}
          chatbots={chatbots}
          documentCount={status?.documentCount ?? 0}
          sentHi={sentHi}
          onSentHi={() => {
            const next = !sentHi;
            setSentHi(next);
            localStorage.setItem(SENT_KEY, next ? "1" : "0");
          }}
          onPage={setPage}
        />
      )}
      {page === "assistants" && (
        <Assistants chatbots={chatbots} onRefresh={refresh} onOpenKnowledge={goKnowledge} />
      )}
      {page === "knowledge" && (
        <Knowledge
          chatbots={chatbots}
          preferredId={knowledgeBot}
          onRefresh={refresh}
          onCreateAssistant={() => setPage("assistants")}
        />
      )}
      {page === "try" && <TryIt chatbots={chatbots} onPage={setPage} />}
      {page === "settings" && <Settings status={status} onRefresh={refresh} />}
    </Layout>
  );
}
