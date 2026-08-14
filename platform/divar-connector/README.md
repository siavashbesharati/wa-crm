# Divar connector (server-side)

Python sidecar that talks to Divar Chat HTTP APIs (see `divarref/DIVAR_CHAT_API.md`)
and the CRM internal API — same role as `wa-connector` for WhatsApp.

## Run

```bash
# from repo root (after API has written platform/api/.local/divar_connector_key)
npm run divar:dev

# or via start-all
npm run start:all -- --skip-ext
```

Health: http://127.0.0.1:8091/health

## Flow

1. Panel → Channels → «اتصال دیوار جدید (OTP)» → phone + SMS code
2. Cookies stored encrypted in `divar_auth_states`
3. This process polls conversations / messages, ingests into CRM, claims outbound jobs, sends via `POST /chat/api/send-message`

Realtime WebSocket is **not** in the verified API doc yet; inbound uses polling (+ optional `unread-conversation-ids`).
