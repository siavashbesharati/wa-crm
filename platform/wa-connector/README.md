# WhatsApp Baileys Connector

Node sidecar that owns WhatsApp Web sessions via [Baileys](https://github.com/WhiskeySockets/Baileys) and talks to the FastAPI CRM over `/api/internal/wa/*`.

## Requirements

- Node.js 20+
- Running API (`platform/api` on port 8000)
- Shared connector key in `platform/api/.local/wa_connector_key` (auto-created)

## Dev

```bash
cd platform/wa-connector
npm install
npm run dev
```

Health: `http://127.0.0.1:8090/health`

## Flow

1. Create a Baileys account in the panel (`POST /channels/accounts/baileys` or Channels UI)
2. Click **Connect** → `pairing_state=qr_pending`
3. This service starts a session, posts QR to the API, panel shows it
4. Scan with WhatsApp → inbound messages → `/internal/wa/.../ingest`
5. Outbound jobs claimed every ~2s → `sendMessage`

## Optional voice STT

```bash
set WA_STT_URL=https://api.groq.com/openai/v1
set WA_STT_API_KEY=...
set WA_STT_MODEL=whisper-large-v3
```

## Groups

- `GET http://127.0.0.1:8090/groups/{accountId}`
- `GET http://127.0.0.1:8090/groups/{accountId}/{groupJid}`
