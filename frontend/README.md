# ToolTap frontend

React + Vite dashboard for assistants, knowledge base, and WhatsApp setup.

## Local development

```bash
cd frontend
npm install
npm run dev
```

Ensure the backend runs on port 3000 (`cd ../backend && npm run dev`). API calls use the Vite proxy — do **not** set `VITE_API_BASE_URL` locally unless you are testing against a remote API.

## Production (Vercel)

Set `VITE_API_BASE_URL` to your backend URL (committed default in `.env.production`). See [../DEPLOY.md](../DEPLOY.md).
