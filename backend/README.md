# 🤖 ToolTap WhatsApp Agent Backend

> High-Performance, Multi-Provider Agentic AI Engine for WhatsApp Built with LangGraph, Node.js, and TypeScript.

ToolTap is an enterprise-grade AI WhatsApp agent architecture engineered for low latency (sub-5s response times), rich interactivity (WhatsApp Reply Buttons & Interactive List Menus), dynamic multi-modal reasoning (Text & Voice), and seamless multi-provider fallbacks.

---

## 🌟 Key Features

* **⚡ Sub-5 Second End-to-End Latency**: Built with zero-latency fast-paths for greetings and button clicks, bypassing unnecessary secondary LLM calls.
* **🧭 Dynamic Orchestrator Routing**: Classifies user intents and dynamically routes queries between **Action Tools**, **Knowledge Base RAG Chatbots**, and **Capability Menus**.
* **📱 Adaptive Interactive Messaging**:
  * **1–3 Options**: Automatically rendered as **WhatsApp Reply Buttons** (≤20 char smart word-boundary labels).
  * **4–10 Options**: Automatically promoted into a **WhatsApp Interactive List Menu** (`View Options`) with custom section titles and descriptions (up to 72 chars).
* **📚 Knowledge Base & Semantic RAG**: Integrated with vector retrieval (Qdrant & local store) supporting multiple domain chatbots (e.g. Sales Frameworks, Advisory Assistants).
* **🛠️ Action Tool Suite**:
  * **Web Search**: Real-time news, search, and factual validation via Tavily.
  * **Weather**: Live city forecasts via OpenWeather API.
  * **Email Management**: Send, schedule, and track emails via Mailgun.
  * **CRM Integration**: Manage leads and contacts in PostgreSQL or HubSpot.
  * **Calendar**: Schedule and manage calendar events.
* **🎙️ Voice Note Capabilities**: Speech-to-Text (STT via OpenAI Whisper / Gemini) and Text-to-Speech (TTS via OpenAI / Gemini) for voice notes.
* **🛡️ Provider-Agnostic Engine**: Supports GitHub Models, OpenAI, Google Gemini, and local Ollama models with automated fallback chains.

---

## 🏗️ Architecture Overview

```
                               ┌───► [capabilityNode] ───► WhatsApp List Menu
                               │
[User Message] ──► [orchestratorNode] ──┼───► [ragNode] ──────────┐
                               │                         ▼
                               └───► [agentNode] ───► [formatterNode] ──► [deliveryNode] ──► WhatsApp API
                                        │                      ▲
                                        └───► [toolNode] ──────┘
```

### Graph Execution Nodes
1. **`orchestratorNode`**: Classifies intent (`tool`, `rag`, `capability`) using fast structured models.
2. **`agentNode`**: Reasoning agent bound to tools; executes multi-step task workflows.
3. **`toolNode`**: Executes background actions (Web Search, CRM, Email, Calendar, Weather).
4. **`ragNode`**: Enterprise context retrieval from vector databases and knowledge bases.
5. **`capabilityNode`**: Generates a deterministic WhatsApp Interactive List Menu displaying all available tools and active chatbots.
6. **`formatterNode`**: Deterministically parses response choices into Buttons or Interactive List Menus in 0ms (or converts to structured schema).
7. **`deliveryNode`**: Transmits payload (text, buttons, list, voice note, media) to Meta's WhatsApp API.

---

## 🚀 Quick Start

### 1. Prerequisites
* **Node.js**: v18+
* **Docker & Docker Compose**: Required for PostgreSQL, Redis, and Qdrant Vector DB.

### 2. Installation
```bash
# Clone the repository and navigate to backend
cd backend

# Install dependencies
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env` and fill in your API credentials:

```bash
cp .env.example .env
```

Key environment settings:
* `MODEL_PROVIDER`: Set to `github`, `gemini`, `openai`, or `ollama`.
* `WHATSAPP_API_TOKEN` & `WHATSAPP_PHONE_NUMBER_ID`: Credentials from Meta Developer Portal.
* `TAVILY_API_KEY` & `OPENWEATHER_API_KEY`: API keys for action tools.

### 4. Run Services via Docker
Start PostgreSQL, Redis, and Qdrant vector database:
```bash
docker-compose up -d
```

### 5. Start Development Server
```bash
npm run dev
```

The server listens on `http://localhost:3000`. Set up a public tunnel (e.g. ngrok) to point Meta Webhooks to `/api/v1/workspaces/:workspaceId/whatsapp/:channelId/webhook`.

---

## 📜 Environment Variables Guide

See [.env.example](.env.example) for a complete list of supported variables:

| Variable | Description |
| :--- | :--- |
| `MODEL_PROVIDER` | Active LLM provider (`github`, `openai`, `gemini`, `ollama`) |
| `GITHUB_TOKEN` | Personal Access Token for GitHub Models |
| `GOOGLE_API_KEY` | Key for Google Gemini LLM, Embeddings, and Voice |
| `OPENAI_API_KEY` | Key for OpenAI models, Whisper STT, and TTS |
| `WHATSAPP_API_TOKEN` | Meta WhatsApp Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Business phone number ID |
| `POSTGRES_URL` | PostgreSQL connection string |
| `REDIS_HOST` | Redis host for caching and job queue |

---

## 📂 Project Structure

```
backend/
├── src/
│   ├── agent/            # Agent system prompts and JSON formatters
│   ├── config/           # Environment and app configuration
│   ├── graph/            # LangGraph StateGraph, nodes, and state schema
│   │   └── nodes/        # orchestrator, agent, rag, capability, formatter, delivery
│   ├── kb/               # Knowledge base vector store & document chunking
│   ├── llm/              # Provider models & fallback chain factories
│   ├── rag/              # RAG retrieval pipeline & system prompts
│   ├── tools/            # Web search, weather, email, CRM, calendar tools
│   └── index.ts          # Server entry point & Express webhook setup
├── .env.example          # Environment template
├── docker-compose.yml    # Database & cache orchestration
└── package.json          # Dependencies & npm scripts
```
