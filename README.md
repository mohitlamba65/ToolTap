# WhatsApp AI Agent (LangChain)

This project is an AI-powered conversational agent that operates directly on WhatsApp. It leverages LangChain for the agentic tool-calling capabilities and connects to the Meta WhatsApp Business API via webhooks.

## Architecture
The application runs a Node.js Express server that listens for incoming WhatsApp messages via webhooks. When a message is received, it invokes a LangChain `ConversationManager` that processes the input, potentially executes registered tools, and replies to the user via the Meta WhatsApp API.

- **Framework**: Node.js, Express
- **AI/LLM Engine**: LangChain, LangGraph
- **API Provider**: Meta (WhatsApp Cloud API)
- **State Management**: In-memory `Map` (development only)

## Prerequisites
- Node.js (v18 or higher recommended)
- A Meta Developer Account with a WhatsApp Business app configured
- A registered phone number in the Meta Developer portal
- [Ngrok](https://ngrok.com/) or another tunneling service for local development

## Environment Variables
Create a `.env` file in the root directory and add the following keys:

```env
# Server Port
PORT=3000

# Meta WhatsApp API Credentials
WHATSAPP_API_URL=https://graph.facebook.com/v19.0
WHATSAPP_API_TOKEN=your_meta_access_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_VERIFY_TOKEN=your_custom_verify_token_here

# LLM Providers (Configure at least one)
MODEL_PROVIDER=ollama
OPENAI_API_KEY=your_openai_api_key
OLLAMA_BASE_URL=http://localhost:11434
```

## Running the Application

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Development Server**
   ```bash
   npm run dev
   ```

3. **Expose Localhost via Ngrok**
   In a separate terminal, run:
   ```bash
   ngrok http 3000
   ```
   Take note of the HTTPS Forwarding URL.

4. **Configure Meta Webhook**
   - Go to your Meta App Dashboard -> WhatsApp -> Configuration.
   - Click **Edit** on the Webhook section.
   - Callback URL: `https://<your-ngrok-url>/webhook`
   - Verify Token: The same value you set for `WHATSAPP_VERIFY_TOKEN` in `.env`.
   - Subscribe to the `messages` field.

## Project Structure
- `src/server.ts`: Express server and webhook ingestion point.
- `src/whatsapp/whatsapp.service.ts`: Handles outbound messages to Meta.
- `src/conversation/manager.ts`: Manages the LangChain agent sessions.
- `src/agent/`: LangChain agent definition and tool registration.

## Scalability Improvements
For a detailed guide on taking this application to a production-ready enterprise level (including Redis, Message Queues, and Idempotency), please see [ARCHITECTURE.md](ARCHITECTURE.md).
