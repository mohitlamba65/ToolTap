# ToolTap — Application Purpose (agent reference)

Internal reference for what this product is and what we are building toward.

## What this application is

ToolTap is a WhatsApp-native AI agent with an operator dashboard. A person messages a WhatsApp Business number. An Express server receives the Meta or Twilio webhook, runs a LangGraph workflow, and replies on WhatsApp as text, reply buttons, an interactive list, or a voice note.

The React app (`frontend/`) is the control surface, branded **ToolTap Agent Hub**. It is not the chat client. Operators use it to:

- Switch the live WhatsApp provider between Meta Cloud API and Twilio.
- Create **any** domain chatbot (name, description, system prompt, trigger keywords, collection name).
- Ingest markdown/text into that chatbot’s knowledge base.
- Test retrieval: grounded answer, abstain flag, and reranked sources with heading paths.

The product goal is a single assistant that can both **do things** (search, weather, email, CRM, calendar) and **answer from private knowledge** (operator-defined chatbots + uploaded docs), then deliver that answer in WhatsApp’s native interactive formats with low latency.

The engine is **not** coupled to EY or any other tenant. Sample data under `backend/data/` may include an example bot; RAG code only uses `bot.systemPrompt` + retrieved chunks.

## What we are trying to achieve

1. **One WhatsApp conversation, many capabilities.** The user should not pick a bot first. An orchestrator decides whether the turn is an action, a knowledge-base question, or a “what can you do?” menu.
2. **Grounded domain answers.** Knowledge replies must come from that chatbot’s ingested documents. If evidence is weak, the system abstains (it does not invent, and it does not fall through to the tool agent).
3. **WhatsApp-native UX.** Short choices become reply buttons. Longer menus become an interactive list. Greetings skip the LLM. Voice notes are transcribed before the graph runs.
4. **Low-latency turns.** Keyword / greeting / button fast-paths skip the router LLM. RAG uses one generation call, top-3 chunks, and a token cap. Vectors live in Postgres so boot does not re-embed.
5. **Provider independence.** LLM, embeddings, STT, and TTS can run on Gemini, OpenAI, GitHub Models, or Ollama. WhatsApp ingress can be Meta or Twilio.
6. **One database.** Postgres holds LangGraph checkpoints, the long-term store, and pgvector embeddings. Qdrant, Redis, and RabbitMQ are not part of the runtime.

## How a message is handled

```
WhatsApp (Meta or Twilio)
  → Express (ack 200 immediately)
  → parse webhook, skip reactions, drop duplicate message IDs
  → voice notes transcribed
  → LangGraph.invoke(thread per phone)
       START → orchestrator (heuristics first, LLM only if needed)
         tool        → agent ⇄ tools → formatter → delivery → END
         rag         → rag node → formatter → delivery → END
         capability  → capability list → delivery → END
  → Meta / Twilio outbound message
```

Orchestrator intents:

| Intent | When | Node |
| --- | --- | --- |
| `capability` | hi / help / “what can you do” | Deterministic list. No LLM. |
| `rag` | Keyword match, last-bot follow-up, or LLM classify | pgvector search on that bot’s collection + bot system prompt. |
| `tool` | Search, weather, email, CRM, calendar | Tool-calling agent. |

RAG path: structure-aware chunking → embed (cached) → pgvector cosine search → rerank top 3 → one short generation. Abstain stays in RAG.

## Action tools (registered)

- **Web search** — Tavily
- **Weather** — OpenWeather
- **Email** — Mailgun
- **CRM** — list / add / update / delete leads
- **Calendar** — create events

## Surfaces and stores

| Piece | Role |
| --- | --- |
| `backend/src/server.ts` | HTTP: webhooks, provider toggle, chatbot CRUD, KB ingest, RAG test |
| `backend/src/graph/` | LangGraph: orchestrator, agent, tools, rag, capability, formatter, delivery |
| `frontend/src/App.tsx` | Dashboard. Calls `http://localhost:3000/api/*` |
| `backend/data/chatbots.json`, `documents.json` | Chatbot configs and raw documents on disk |
| Postgres + pgvector | Checkpoints, `tooltap_store`, `kb_chunks` embeddings. Host port 5433. |

## Decisions to preserve when changing the code

- Route first, then answer. Do not collapse orchestrator, RAG, and tools into one prompt.
- Knowledge answers stay inside retrieved chunks plus the **chatbot’s** system prompt. No tenant-specific rules in engine prompts.
- Interactive replies are continuations of the last RAG bot unless the user clearly changes topic.
- Formatter output respects WhatsApp limits. Capability menus stay deterministic.
- Ack the webhook before the LLM runs.
- Latency budget: skip extra LLM calls; do not re-embed on boot; do not escalate RAG misses to the tool agent.
