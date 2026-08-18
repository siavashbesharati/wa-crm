# Scale plan — 1,000 businesses, 3,000 channels

Isolation today, storage at 1,000 tenants, and what actually breaks first.
**PostgreSQL can hold the messages. Live WhatsApp sessions cannot sit in one process.**

This is the repo copy of the Cursor canvas
[`scale-1000-businesses.canvas.tsx`](./scale-1000-businesses.canvas.tsx)
(live canvas still opens beside chat from Cursor’s canvases folder).

**Model:** 1,000 businesses × 3 channels (WhatsApp + Divar + Bale).
Traffic: ~20 CRM messages per business per day (SMB chat).
Retention: 30-day hot store (starter default), optional 12-month archive.

| 1,000 | 3,000 | ~20k | WhatsApp RAM |
| --- | --- | --- | --- |
| Businesses (orgs) | Live channel sessions | Messages / day (platform) | Real bottleneck |

## Packages for Bale

Yes — install Python deps, no new Node packages. From repo root:

```bash
pip install -r platform/api/requirements.txt
pip install -r platform/bale-connector/requirements.txt
```

That pulls `bale-sdk` (protobuf + websockets). `npm run start:all` already tries the connector install.

## Tenant isolation — how it works now

Bidar is one shared database. Isolation is by **organization id** on every row, not separate databases. Public APIs always filter `org_id` from the login token. Encrypted channel credentials are stored per `ChannelAccount`, which belongs to one org.

| Asset | Stored where | Isolation key | Visible to other businesses? |
| --- | --- | --- | --- |
| Channel session (WA / Divar / Bale) | Encrypted row: `wa_auth_states` / `divar_auth_states` / `bale_auth_states` | `account_id` → `org_id` | No — token never sent to the browser |
| Contacts / leads | `leads` + `lead_account_links` | `org_id` | No, if every query keeps `org_id` |
| Conversations + messages | `messages` (`account_id` + `lead_id`) | `org_id` + `account_id` | No |
| Outbound / AI jobs | `outbound_jobs` + workers | `org_id` + `account_id` | No |
| Connector process | One sidecar holds all orgs’ live sockets | Platform service key | Process can see every session — must stay server-side |
| Database file (local) | Single SQLite `wa_crm.db` | App filter only | Ops/backup access is global — move to Postgres + RLS later |

**Business A cannot use Business B’s Bale token.** Pairing APIs require the org JWT. Internal connector APIs use a server key and never expose tokens to the UI. A broken Bale channel cannot take down WhatsApp or Divar for other orgs at the application layer — but one overloaded connector process still can, which is the scale risk below.

## Capacity at 1,000 businesses

Message volume is modest for a relational database. Persistent messenger sockets are not.

| Store | Approx volume | Disk / RAM | Fits current local stack? |
| --- | --- | --- | --- |
| Organizations + users | 1,000 orgs, ~3–5k users | under 50 MB | Yes |
| Channel accounts + encrypted auth | 3,000 accounts | 50–200 MB | Yes — already encrypted at rest |
| Contacts / leads | ~250k (250 per business) | 1–3 GB | Postgres yes · SQLite no |
| Messages, 30-day hot | ~600k rows (~20 msg/biz/day) | 2–4 GB with indexes | Postgres yes · SQLite no |
| Messages, 12-month archive | ~7.3M rows | 15–25 GB | Postgres + optional monthly partitions |
| Live sockets (the hard part) | 1,000 WA + 1,000 Bale + 1,000 Divar poll | WA 40–80 GB RAM · Bale ~8 GB · Divar under 1 GB | **Not in one VM / one process** |

### Where RAM goes at 3,000 channels

Conservative per-session footprints for Baileys (Node), Bale WebSocket (Python asyncio), Divar HTTP poll. **Not measured on this repo — planning envelope.**

Live connector RAM at 1,000 of each channel: **~49–89 GB — WhatsApp dominates.**

- WhatsApp: 40–80 GB
- Bale: ~8 GB
- Divar: ~1 GB
- API / Postgres: ~4 GB

### Daily message ingest — database is easy

| Load | Messages / day (1,000 businesses) |
| --- | ---: |
| Low (8 / biz) | 8,000 |
| Model (20 / biz) | 20,000 |
| Busy (80 / biz) | 80,000 |

Even the busy case (~1 msg/s average, ~10–20 msg/s peak) is well inside PostgreSQL + Redis. **The database is not the cliff.**

## What can handle messages and events

**Hot path (keep)**

- PostgreSQL for contacts, conversations, messages, jobs. Already in the production README via `DATABASE_URL`.
- Redis for outbound/AI queues (`queue.py` already prefers Redis, falls back to files). Add Redis Streams or keep the jobs table for claim/complete.
- SSE hub for the panel inbox — shard by `org_id` when subscriber count grows.

**Overkill at this size**

- Kafka is not required at 20k–80k messages/day. Postgres + Redis covers ingest, AI workers, and operator sends.
- Per-tenant databases for 1,000 SMBs add ops cost without fixing the WhatsApp RAM problem.
- SQLite (current local default) is for demos only — one writer, one file, no tenant crash isolation.

## Current stack vs 1,000-tenant stack

| Layer | Today (local) | At 1,000 businesses | Why |
| --- | --- | --- | --- |
| Database | SQLite `wa_crm.db` | Managed Postgres (16+ GB RAM, 4 vCPU, 200 GB SSD) | Concurrent tenants, backups, indexes on `org_id` |
| Jobs / events | Redis if up, else JSONL files + in-memory SSE | Redis (queues, rate limits, pub/sub) + Postgres jobs table | API and workers must not share a file |
| WhatsApp connector | One Node process, all sessions in RAM | Sharded: ~10–20 workers, 50–100 sessions each | Baileys is the RAM cliff (40–80 GB if unsharded) |
| Bale connector | One asyncio process, dict of sessions | Sharded: 3–5 workers, ~200–300 WS each | Lighter than WA; still cap sockets per process |
| Divar connector | One poller, all accounts every few seconds | Sharded pollers + backoff; respect Divar rate limits | 1,000 accounts × 6s poll ≈ 167 HTTP req/s |
| API / web | One uvicorn + Next.js | 2–3 API replicas behind a load balancer | JWT + `org_id` stays; sticky sessions not required |

**Do not run 3,000 live channels in `start-all` on one PC.** Local `start-all` is a sales/dev topology. Production needs Postgres, Redis, and horizontally sharded connectors. Isolation of data is already org-scoped; isolation of failure requires splitting connector workers so one dead Bale socket does not recycle a thousand WhatsApp sessions.

## Recommended machine envelope

| Role | Count | Size | Notes |
| --- | --- | --- | --- |
| Postgres | 1 primary (+ replica later) | 4 vCPU / 16 GB / 200 GB SSD | Holds 12 months of chat easily |
| Redis | 1 | 2 vCPU / 4 GB | Queues + short-lived events |
| API + workers | 2–3 | 2 vCPU / 4 GB each | Stateless besides DB |
| Web | 1–2 | 2 vCPU / 2 GB | Next.js |
| WA connectors | 10–20 shards | 4 vCPU / 8–16 GB each | Dominant cost — plan ~8 GB RAM per 100 WA sessions |
| Bale connectors | 3–5 shards | 2 vCPU / 4–8 GB each | ~200–300 WebSockets per process |
| Divar connectors | 2–3 shards | 2 vCPU / 2 GB each | HTTP poll, cheap |

Rough monthly cloud cost band if self-hosted on typical VPS: **WhatsApp fleet dominates.** Database is a small fraction. Exact EUR/IRT depends on provider.

## What to change before 1,000, not before 20

1. Switch `DATABASE_URL` to Postgres as soon as you leave single-demo SQLite.
2. Keep Redis always on for queues — stop using the JSONL file fallback in production.
3. Shard connectors by `account_id` hash (each worker lists only its slice of `/internal/*/sessions`). That is the real 3,000-channel design.
4. Add unique `(org_id, account_id, wa_message_id)` and retain `org_id` on every query — isolation stays an application rule plus indexes, then optional Postgres RLS.
5. Enforce message retention (already on plans) so the hot table stays hundreds of thousands of rows, not unbounded.
