# System Requirements — AI Auto-Reply for WhatsApp Web (Iranexpedia Platform)

This document specifies the **minimum**, **recommended**, and **scale-out** system
requirements for running the **Iranexpedia** platform — a multi-service CRM/AI
auto-reply stack that connects to **WhatsApp** (via Baileys), **Divar**, and
**Bale**, backed by a **FastAPI** API, a **Next.js 15** admin panel, a
**Python worker** for background jobs, **PostgreSQL 16**, and **Redis 7**.

> **TL;DR**
> The platform is **not a single web app**. It is **six long-lived services**
> that hold persistent network sockets, encrypted auth state on disk, and
> real-time message pipelines. Sizing is dominated by **WhatsApp session RAM**
> (Baileys) — the database is the *easy* part.
>
> | Tier | Concurrent WA sessions | CPU | RAM | Disk (SSD) | Suitable for |
> |---|---|---|---|---|---|
> | **Minimum (toy / 1 business)** | 1–3 | 2 vCPU | 4 GB | 40 GB | Demo / single-operator |
> | **Recommended (SMB / 10–50 businesses)** | 10–50 | 4 vCPU | 8 GB | 80 GB | Pilot / small production |
> | **Production starter (100 businesses)** | 50–150 | 8 vCPU | 16 GB | 200 GB | Real production |
> | **Sharded scale-out (1,000 businesses / 3,000 channels)** | 1,000+ | 40–80 vCPU fleet | 80–160 GB fleet | 500 GB+ | Multi-tenant platform |

---

## Table of contents

1. [Application architecture (what's actually running)](#1-application-architecture-whats-actually-running)
2. [Minimum hardware requirements](#2-minimum-hardware-requirements)
3. [Recommended (small production)](#3-recommended-small-production)
4. [Persistent vs ephemeral storage](#4-persistent-vs-ephemeral-storage)
5. [Background workers per user / per business](#5-background-workers-per-user--per-business)
6. [Docker requirements](#6-docker-requirements)
7. [Dedicated / VPS server requirements](#7-dedicated--vps-server-requirements)
8. [Network and outbound requirements](#8-network-and-outbound-requirements)
9. [Scaling strategy as users grow](#9-scaling-strategy-as-users-grow)
10. [Easy scale-up checklist](#10-easy-scale-up-checklist)
11. [Cost bands (mid-2026)](#11-cost-bands-mid-2026)
12. [What will NOT work](#12-what-will-not-work)

---

## 1. Application architecture (what's actually running)

The platform consists of **six cooperating services** that all must run
simultaneously and talk to each other on a private network:

| # | Service | Stack | Port | Role | Stateful? |
|---|---|---|---|---|---|
| 1 | **API** | FastAPI (Python 3.12) + uvicorn | `8000` | Auth, CRM, billing, AI orchestration, REST/SSE | Stateless (DB-backed) |
| 2 | **Web** | Next.js 15 (Node 20) | `3000` | Admin panel (business + super-admin) | Stateless (build-time env) |
| 3 | **Worker** | Python 3.12 (`app.workers.runner`) | — | Background jobs: campaigns, AI replies, lead enrichment | Stateless (DB + Redis) |
| 4 | **WA Connector** | Node 20 + Baileys | `8090` | Holds the **WhatsApp WebSocket** sessions, ingests/sends messages | **Stateful** (encrypted auth on disk + per-session RAM) |
| 5 | **Divar Connector** | Python 3.12 + httpx | `8091` | Polls Divar for new chats, posts auto-replies | Light stateful (HTTP cookies) |
| 6 | **Bale Connector** | Python 3.12 + bale-sdk (asyncio WS) | `8092` | Holds the **Bale WebSocket** sessions | **Stateful** (encrypted auth on disk) |
| + | **PostgreSQL 16** | DB | `5432` | Primary store | **Stateful** (must persist) |
| + | **Redis 7** | Cache / queue / pub-sub | `6379` | Job queue, SSE pub/sub, rate limits | **Stateful** (AOF on) |

> ⚠️ **The WA and Bale connectors are the hard part.** They hold **persistent
> outbound WebSocket connections** to WhatsApp / Bale servers, keep
> **encryption state on disk**, and must stay online 24/7. **A serverless /
> ephemeral host will not work** for these.

---

## 2. Minimum hardware requirements

Use this profile for **a single business, one operator, demo / development**:

### 2.1 Minimum VM / bare metal

| Resource | Minimum | Why |
|---|---|---|
| **CPU** | **2 vCPU** (x86_64 or arm64) | API (uvicorn `--workers 2`) + Next.js + Baileys + Python workers |
| **RAM** | **4 GB** | OS ~600 MB, Postgres ~400 MB, Redis ~100 MB, API ~400 MB, Web ~300 MB, WA connector ~1.5 GB (1–3 sessions), Divar + Bale ~200 MB, worker ~300 MB |
| **Persistent storage (SSD/NVMe)** | **40 GB** | OS 8 GB, Docker images 5 GB, Postgres data 5 GB, WA auth state 1 GB per active account, app logs 5 GB |
| **Ephemeral / tmpfs** | **1 GB** | Next.js `.next` build cache, uvicorn worker tmp |
| **Swap** | **4 GB** (recommended) | Buffer for Baileys RAM spikes when sockets reconnect |
| **Network** | **100 Mbps** symmetric, **unmetered or ≥3 TB/mo** | WA / Bale / Divar / OpenAI / sms.ir all need steady outbound |
| **OS** | Ubuntu 22.04/24.04 LTS, Debian 12, or Rocky 9 | Docker Engine 24+ supported |
| **Docker** | Engine **24.0+** + Compose v2 | Bundled `docker-compose.yml` and `docker-compose.dev.yml` |

### 2.2 Per-container footprint (minimum profile)

| Container | CPU share | RAM cap | Persistent volume |
|---|---|---|---|
| `db` (postgres:16-alpine) | 0.5 vCPU | 512 MB | `pgdata` (5 GB) |
| `redis` (redis:7-alpine, AOF) | 0.25 vCPU | 128 MB | `redisdata` (1 GB) |
| `api` (uvicorn `--workers 2`) | 0.5 vCPU | 512 MB | `api_secrets` (50 MB) |
| `worker` (`app.workers.runner`) | 0.25 vCPU | 384 MB | shares `api_secrets` |
| `wa-connector` (Baileys, 1–3 sessions) | 0.5 vCPU | 1.5 GB | `wa_auth` (1 GB) |
| `divar-connector` | 0.1 vCPU | 128 MB | — |
| `bale-connector` | 0.1 vCPU | 128 MB | shares `api_secrets` |
| `web` (Next.js production) | 0.25 vCPU | 256 MB | — |

### 2.3 What you get at "minimum"

- 1–3 paired WhatsApp numbers (Baileys auth on disk).
- ~10–20 concurrent CRM users on the web panel.
- ~5k messages/day sustained; ~50/min peak.
- Single Postgres, no read replica.
- No high-availability: any container restart is fine, but a **host crash**
  loses nothing because all state is in **named Docker volumes**.

> **Hard rule:** do not run the minimum profile with SQLite. Use Postgres
> (already wired in `docker-compose.yml` with `DATABASE_URL=postgresql+psycopg://…`).

---

## 3. Recommended (small production)

Use this profile for **10–50 businesses, 50–500 end customers, real production
with backups**:

| Resource | Recommended | Notes |
|---|---|---|
| **CPU** | **4 vCPU / 8 threads** (x86_64 or arm64) | Reserve 2 cores for Baileys (single-threaded event loop + libsignal crypto) |
| **RAM** | **8 GB** | Comfortable headroom for 10–50 WA sessions |
| **Persistent SSD** | **80 GB** (NVMe preferred) | 30 GB for Postgres + indexes, 20 GB for WA/Bale auth, 10 GB logs, 20 GB headroom |
| **Ephemeral** | **2 GB tmpfs** at `/tmp` | Uvicorn worker tmp + Next.js cache |
| **Swap** | **4 GB** | Same reason as minimum |
| **Network** | **200 Mbps+ symmetric**, **unmetered** | Outbound-heavy (every WA frame is ~1–4 KB, so 1000 msg/min ≈ 3 MB/min) |
| **Backup storage** | **Separate volume or S3** ≥ 100 GB | Daily Postgres dump + `wa_auth` snapshot (BEFORE any host change) |

### 3.1 Per-container footprint (recommended)

| Container | CPU | RAM | Notes |
|---|---|---|---|
| `db` (postgres:16) | 1 vCPU | 1 GB | Tune `shared_buffers=256MB`, `work_mem=16MB` |
| `redis` (redis:7) | 0.25 vCPU | 256 MB | `maxmemory 200mb`, `maxmemory-policy allkeys-lru` |
| `api` (uvicorn `--workers 4`) | 1 vCPU | 1 GB | Stateless — scale horizontally by adding replicas |
| `worker` | 0.5 vCPU | 512 MB | Add 1–2 more replicas for AI reply throughput |
| `wa-connector` | 1.5 vCPU | 4 GB | ~50 sessions; ~80 MB RAM per active session |
| `divar-connector` | 0.25 vCPU | 256 MB | HTTP polling, cheap |
| `bale-connector` | 0.25 vCPU | 256 MB | ~20–30 WS sessions |
| `web` | 0.5 vCPU | 512 MB | Next.js production; CDN-fronted in front |

### 3.2 What you get at "recommended"

- 10–50 paired WhatsApp numbers.
- ~5k–20k messages/day; ~100/min peak.
- Daily Postgres backups (managed snapshot or `pg_dump` cron).
- A single host can be rebooted; sessions reconnect automatically (Baileys
  retries with backoff).

---

## 4. Persistent vs ephemeral storage

This is one of the **most important** sections. Mis-classifying these will
cause silent data loss (lost WhatsApp pairings, lost Bale tokens, lost CRM
data).

### 4.1 Persistent storage (must survive `docker compose down` and host reboots)

Map every one of these to a **named Docker volume** (already done in
`docker-compose.yml`) or a host path on a separate disk/volume:

| Volume | Service | Size to provision | What's inside | What happens if lost |
|---|---|---|---|---|
| `pgdata` | postgres | **30 GB → 200 GB** (grows) | All CRM data: orgs, users, leads, messages, jobs, billing | **Total data loss.** Re-pair all channels, all customers gone. **Back up daily.** |
| `redisdata` | redis (AOF) | **1 GB → 5 GB** | Job queue, SSE pub/sub, rate-limit counters | Loses in-flight jobs and live panel updates (recovers automatically) |
| `wa_auth` | wa-connector | **100 MB per active account × N** | Baileys multi-file auth state (creds.json, app-state sync keys, signal identity) | **All paired WhatsApp numbers un-paired.** End users must re-scan QR. **Back up before any host move.** |
| `bale_auth` (or shared `api_secrets`) | bale-connector | **50 MB per active account × N** | Bale WebSocket auth tokens + protobuf keys | Same as WA: all Bale numbers un-paired. |
| `api_secrets` | api + worker | **50 MB** | Auto-generated JWT signing keys, Fernet key for `ChannelAccount` encryption at rest | **All encrypted channel credentials unreadable.** Users must re-pair every channel. **Back up religiously.** |
| `divar_auth` (cookies / tokens) | divar-connector | **10 MB per account × N** | Divar HTTP session cookies | Re-login required; lower-impact than WA/Bale. |

> 🔴 **Back up `pgdata`, `wa_auth`, `bale_auth`, and `api_secrets` together.**
> They are cryptographically linked — restoring a Postgres dump without
> `api_secrets` makes all channel credentials unreadable, and restoring
> `api_secrets` without `pgdata` makes them orphaned.

### 4.2 Ephemeral storage (safe to lose on restart)

| Path | Service | Size | Notes |
|---|---|---|---|
| `/app/.next` | web | 200–500 MB | Next.js build output, can be regenerated |
| `/tmp` | api, worker | 200 MB | uvicorn worker tmp, multipart uploads |
| `/app/__pycache__` | api, worker | 50 MB | Regenerated on first run |
| `/var/log/...` | all | 5–20 GB | Mount a `log` driver to your aggregator, not a volume |
| Docker image layers | host | 5–10 GB | Pulled on `docker compose pull` |

> **Never** persist Docker image layers or Next.js build output. They are
> reproducible and only waste disk.

### 4.3 Storage IOPS

Postgres + Baileys auth reads are **write-heavy and latency-sensitive**:

| Workload | Required IOPS | Notes |
|---|---|---|
| Minimum profile | 1,500 IOPS | Any SSD is fine |
| Recommended profile | 5,000 IOPS | NVMe strongly preferred |
| 100+ businesses | 10,000+ IOPS | Managed Postgres (RDS, Neon, Crunchy) or local NVMe RAID |

---

## 5. Background workers per user / per business

The `worker` service runs `app.workers.runner`, a single Python process that
loops over background jobs. **It is the bottleneck for AI replies, outbound
campaigns, and lead enrichment.**

### 5.1 What the worker does

- Polls `outbound_jobs` + AI reply queue (Redis Streams or DB-backed).
- Calls OpenAI / Gemini for AI replies (network-bound, **2–10 s per call**).
- Calls Pinecone for RAG retrieval (**50–200 ms per query**).
- Sends outbound messages through the connector sidecars.
- Runs nightly retention / cleanup.

### 5.2 Sizing rule of thumb

| End customers / business | Concurrent AI replies expected | Worker CPU | Worker RAM | Worker replicas |
|---|---|---|---|---|
| 1–50 (very small SMB) | 1–2 | 0.25 vCPU | 384 MB | **1** |
| 50–500 (small SMB) | 2–5 | 0.5 vCPU | 512 MB | **1–2** |
| 500–5,000 (medium) | 5–20 | 1 vCPU | 1 GB | **2–3** |
| 5,000–50,000 (large) | 20–100 | 2 vCPU | 2 GB | **3–8** |

> **Rule of thumb:** allocate **1 worker replica per ~100 active end customers
> per minute of expected AI-reply load**. Each replica can sustain ~20–40
> OpenAI calls/min before OpenAI rate limits (RPM) become the real ceiling.

### 5.3 Per-business parallel limits

Each business (org) has its own **per-org concurrency** to prevent one
noisy customer from starving the rest. Default settings (override in `.env`):

```
AI_REPLY_MAX_CONCURRENT_PER_ORG=3
OUTBOUND_MAX_CONCURRENT_PER_ORG=5
WORKER_POLL_INTERVAL_MS=500
```

### 5.4 How to add more workers

The worker is **stateless** (reads from Redis/Postgres only). To scale:

```bash
docker compose up -d --scale worker=4
```

Each replica competes on the Redis queue — no leader election required.

---

## 6. Docker requirements

### 6.1 Host requirements

| Requirement | Minimum | Recommended |
|---|---|---|
| **Docker Engine** | 24.0+ | 26.0+ (BuildKit) |
| **Docker Compose** | v2.20+ (plugin) | v2.27+ |
| **Linux kernel** | 4.15+ (Ubuntu 20.04) | 5.15+ (Ubuntu 22.04) |
| **cgroups v2** | optional | enabled (required for memory limits) |
| **Storage driver** | overlay2 | overlay2 |
| **Disk for `/var/lib/docker`** | 30 GB | 100 GB (NVMe) |
| **Userland proxy disabled** | optional | yes (`{ "userland-proxy": false }`) |

### 6.2 Resource limits in `docker-compose.yml`

Apply **explicit memory + CPU limits** so a single container cannot OOM-kill
the host. The repo's current `docker-compose.yml` does not set these — add
them in `docker-compose.dev.yml` or as a `deploy.resources` block per
service.

Example pattern:

```yaml
services:
  wa-connector:
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 4G
        reservations:
          cpus: "0.5"
          memory: 1G
```

| Service | Suggested CPU limit | Suggested RAM limit |
|---|---|---|
| `db` | 2.0 | 1G → 8G (tune) |
| `redis` | 0.5 | 256M → 1G |
| `api` | 2.0 | 1G → 2G |
| `worker` | 1.0 | 512M → 1G |
| `wa-connector` | 2.0 | 2G → 8G (per shard) |
| `divar-connector` | 0.5 | 256M |
| `bale-connector` | 0.5 | 256M → 512M |
| `web` | 1.0 | 512M → 1G |

### 6.3 Build cache and image size

The Dockerfile uses a **multi-stage build** (builder + runtime) — already
shipped. The runtime image is based on `python:3.12-slim` plus `tini` and
`libpq5` (~180 MB final). The WA connector is `node:20-alpine` (~150 MB).
The web is `node:20-alpine` + `next start` (~200 MB).

Enable BuildKit for parallel, cached builds:

```bash
DOCKER_BUILDKIT=1 docker compose build
```

### 6.4 Restart policy

The compose file already uses `restart: unless-stopped`. For production,
consider `restart: always` plus an external watchdog (e.g. systemd unit that
runs `docker compose ps` every 60 s).

### 6.5 Health checks

Already configured for `db` (`pg_isready`) and `redis` (`redis-cli ping`).
The API has a `HEALTHCHECK` in its Dockerfile that calls
`/api/health`. **Add health checks for `wa-connector`, `divar-connector`,
and `bale-connector`** in production (they expose `/health` on their
internal ports).

---

## 7. Dedicated / VPS server requirements

### 7.1 What to look for in a provider

| Criterion | Why |
|---|---|
| **KVM / dedicated cores** (not oversubscribed) | Baileys single-threaded event loop is latency-sensitive |
| **NVMe SSD** (not spinning disk) | Postgres + Baileys auth reads |
| **Persistent disk** (not ephemeral) | Named volumes must survive reboots |
| **Unmetered or ≥5 TB bandwidth** | Outbound-heavy (every WA/Bale frame leaves the box) |
| **Outbound to Iranian IPs allowed** | Divar, sms.ir, Zibal |
| **IPv4 included** (and ideally IPv6) | WhatsApp edge nodes sometimes prefer IPv6 |
| **Hourly billing** (so you can resize) | Scale-up is the whole point of this doc |
| **Snapshots / backups** | One-click image before any upgrade |

### 7.2 Provider tiers (mid-2026 reference)

| Provider | Tier | vCPU | RAM | SSD | Bandwidth | ~$/mo |
|---|---|---|---|---|---|---|
| Hetzner Cloud | CAX21 (ARM) | 4 | 8 GB | 80 GB | 20 TB | ~€6.50 |
| Hetzner Cloud | CCX23 (x86) | 4 | 16 GB | 160 GB | 20 TB | ~€17 |
| Netcup | VPS 1000 (ARM) | 8 | 8 GB | 160 GB | 32 TB | ~€11 |
| OVH | Starter | 2 | 4 GB | 40 GB | unmetered | ~€6 |
| DigitalOcean | Basic 4 GB | 2 | 4 GB | 80 GB | 4 TB | $24 |
| Vultr | Cloud Compute | 4 | 8 GB | 100 GB | 5 TB | $32 |
| Oracle Cloud Always Free | ARM VM | 4 | 24 GB | 200 GB | 10 TB | **$0** (best free) |
| Scaleway Stardust | ARM | 4 | 8 GB | 80 GB | 25 TB | ~€3.79 |

### 7.3 OS / kernel tuning

Add to `/etc/sysctl.conf`:

```ini
# Network — high outbound, many short-lived WS
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# File descriptors — Baileys opens many sockets
fs.file-max = 2097152
fs.nr_open = 1048576

# Shared memory for Postgres
kernel.shmmax = 4294967296
kernel.shmall = 4294967296
```

Add to `/etc/security/limits.conf`:

```
*    soft    nofile  1048576
*    hard    nofile  1048576
*    soft    nproc   65536
*    hard    nproc   65536
```

### 7.4 Firewall

Open only what is needed:

| Port | Service | Source |
|---|---|---|
| `22` | SSH | your IP / VPN |
| `80`, `443` | Nginx / Caddy reverse proxy | public |
| `3000` | Next.js (optional, behind proxy) | localhost only |
| `8000` | FastAPI (optional, behind proxy) | localhost only |
| `8090–8092` | Connectors health | internal docker network only |

**Never expose `5432` (Postgres) or `6379` (Redis) to the public internet.**

### 7.5 Time and locale

- Set timezone: `timedatectl set-timezone Asia/Tehran` (matches `TZ` in `.env`).
- Enable NTP: `timedatectl set-ntp true`. WhatsApp rejects auth handshakes
  with skewed clocks.

---

## 8. Network and outbound requirements

Outbound (must work):

| Destination | Ports | Why |
|---|---|---|
| `web.whatsapp.com`, `*.whatsapp.net`, `*.whatsapp.com` | 443 (TCP) | Baileys WebSocket |
| WhatsApp edge (`e1–e7.whatsapp.net`, etc.) | 443, 5222 | Push notifications, media CDN |
| `*.bale.ai`, Bale API | 443 (TCP) | Bale WebSocket + REST |
| `*.divar.ir`, `divar.ir` | 443 (TCP) | Divar web chat |
| `api.openai.com` / `generativelanguage.googleapis.com` | 443 | AI replies |
| `*.pinecone.io` | 443 | RAG vector search |
| `api.sms.ir` | 443 | SMS OTP |
| `api.zibal.ir` | 443 | Payments |
| `pypi.org`, `registry.npmjs.org`, GitHub | 443 | Docker image builds |

Inbound (must work):

| Port | Service |
|---|---|
| `80` / `443` | Public web (Next.js panel + API), fronted by Nginx / Caddy / Cloudflare |

DNS: working outbound DNS (systemd-resolved or `1.1.1.1`) is mandatory;
WhatsApp handshake fails silently if DNS is broken.

---

## 9. Scaling strategy as users grow

The platform is **horizontally scalable** in 4 independent axes. Each axis
can be grown independently as load increases.

### 9.1 The 4 scaling axes

| Axis | What to scale | Trigger | How |
|---|---|---|---|
| **A. WhatsApp sessions** | `wa-connector` shards | > 50 active sessions per shard | Shard by `account_id % N`; each shard 4 vCPU / 8 GB / 50–100 sessions |
| **B. Bale sessions** | `bale-connector` shards | > 200 active WS per shard | Same pattern; lighter (~200 WS per 2 vCPU / 2 GB) |
| **C. API throughput** | `api` replicas | > 100 req/s sustained or p95 > 500 ms | `docker compose up -d --scale api=N` behind a load balancer; stateless |
| **D. Background jobs** | `worker` replicas | Job latency p95 > 30 s or queue depth > 1000 | `docker compose up -d --scale worker=N`; compete on Redis queue |

> The **WA connector is the dominant cost**. Every 100 active WhatsApp
> numbers costs roughly **8 GB of RAM + 2 vCPU** in the sharded fleet.
> Plan your budget around this number, not the database.

### 9.2 Growth plan by customer count

| Stage | Customers (end users) | Businesses | WA sessions | Total vCPU | Total RAM | Postgres size | Notes |
|---|---|---|---|---|---|---|---|
| **Demo** | < 100 | 1 | 1–3 | 2 | 4 GB | 5 GB | Single VM, all services, SQLite OK |
| **Pilot** | 100–1k | 1–5 | 5–15 | 4 | 8 GB | 20 GB | Single VM, switch to Postgres |
| **Small production** | 1k–10k | 5–20 | 20–60 | 8 | 16 GB | 50 GB | Add daily backups + monitoring |
| **Medium** | 10k–50k | 20–100 | 60–300 | 16–24 | 32–64 GB | 150 GB | Shard WA connector (2–3 shards) |
| **Large** | 50k–200k | 100–500 | 300–1.5k | 40–60 | 80–120 GB | 500 GB | 6–10 WA shards; managed Postgres with read replica |
| **Platform** | 200k+ | 500–1k+ | 1.5k–3k | 80–120 | 160–240 GB | 1 TB+ | 10–20 WA shards; multi-region; consider Kafka |

### 9.3 When to shard each layer

| Signal | Action |
|---|---|
| `wa-connector` RSS > 6 GB on 8 GB host | Add a second shard; assign new accounts by `account_id % 2` |
| API p95 latency > 1 s under normal load | Add an `api` replica behind a load balancer |
| Job queue depth in Redis > 500 for > 5 min | Add a `worker` replica |
| Postgres CPU > 70% sustained | Move to managed Postgres (RDS, Neon, Crunchy); or add read replica |
| Postgres disk > 70% full | Partition `messages` by month; archive old data |
| `web` SSR latency > 2 s | Add a `web` replica; front with CDN for static assets |

### 9.4 Connector sharding (the critical pattern)

The `wa-connector` / `bale-connector` cannot run thousands of WebSockets in
one process. Split the work:

```yaml
# docker-compose.yml (excerpt)
wa-connector-1:
  build: ./platform/wa-connector
  environment:
    SHARD_ID: 0
    SHARD_TOTAL: 3
  deploy:
    resources:
      limits: { cpus: "2.0", memory: 8G }
wa-connector-2:
  ...
  environment: { SHARD_ID: 1, SHARD_TOTAL: 3 }
wa-connector-3:
  ...
  environment: { SHARD_ID: 2, SHARD_TOTAL: 3 }
```

Each shard claims only `account_id % SHARD_TOTAL == SHARD_ID`. This is the
same pattern that already exists in the codebase for the API + worker; it
extends naturally to the connectors.

### 9.5 Multi-host / multi-region

When you outgrow a single host:

1. **Database first.** Move to a managed Postgres (RDS, Neon, Crunchy,
   Supabase). Set `DATABASE_URL` to the managed endpoint.
2. **Redis second.** Move to a managed Redis (Upstash, ElastiCache,
   Redis Cloud). Set `REDIS_URL` to the managed endpoint.
3. **Connectors next.** Each `wa-connector` / `bale-connector` becomes its
   own small VM, pinned to a shard. Add more VMs to grow.
4. **API + web last.** These are stateless; any number of replicas behind
   Nginx / Caddy / Cloudflare / an ALB.

---

## 10. Easy scale-up checklist

A pragmatic runbook for going from "minimum" to "production" without
rebuilding the stack:

1. ✅ **Start on the minimum profile (2 vCPU / 4 GB / 40 GB SSD)** with the
   bundled `docker-compose.yml`. Verify end-to-end (pair one WhatsApp
   number, send a test message).
2. ✅ **Switch to Postgres** (already wired in compose). The SQLite fallback
   is for demos only and breaks under concurrent worker writes.
3. ✅ **Keep Redis always on** for queues and SSE pub-sub. Stop using the
   JSONL file fallback in production.
4. ✅ **Snapshot the host** (or the volumes) before any change. The
   `wa_auth` and `api_secrets` volumes are the most critical — losing
   them forces every customer to re-pair.
5. ✅ **Add backups.** `pg_dump` nightly + a daily tarball of `wa_auth`
   and `api_secrets` to S3 (or Backblaze B2). Test restore quarterly.
6. ✅ **Set resource limits** in `docker-compose.dev.yml` so a single
   runaway container cannot OOM-kill the host.
7. ✅ **Front with a reverse proxy** (Caddy or Nginx) and put the panel
   behind Cloudflare for free TLS + WAF.
8. ✅ **Add basic monitoring**: `docker stats` in a Grafana dashboard, or
   a managed service (UptimeRobot for HTTP, Better Stack for logs).
9. ✅ **When `wa-connector` RSS > 6 GB**: shard. Add a second
   `wa-connector` service with `SHARD_ID=1, SHARD_TOTAL=2`. Update the
   assignment logic to split accounts.
10. ✅ **When API p95 > 1 s**: add an `api` replica behind the proxy.
    Stateless — no data migration.
11. ✅ **When job queue depth > 500**: `docker compose up -d --scale
    worker=N`. Each replica is independent.
12. ✅ **When Postgres is the bottleneck**: move to managed Postgres. Point
    `DATABASE_URL` at it. No code changes.
13. ✅ **When a single host can't fit the WA fleet**: split the
    `wa-connector` shards across multiple small VMs. Each one is a
    self-contained Docker Compose stack talking to the same Postgres +
    Redis.

> **Most of these steps are `docker compose` commands or `.env` changes —
> no code rewrites, no schema migrations, no downtime beyond a single
> container restart.**

---

## 11. Cost bands (mid-2026)

| Profile | Realistic monthly | Persistent? | Production-ready? |
|---|---|---|---|
| **Oracle Cloud Always Free** (ARM, 4 vCPU / 24 GB) | **$0** | ✅ | ✅ for ≤ ~50 WA sessions |
| Hetzner CAX21 (ARM, 4 / 8 / 80) | ~€6.50 | ✅ | ✅ Recommended starter |
| Hetzner CCX23 (x86, 4 / 16 / 160) | ~€17 | ✅ | ✅ Comfortable |
| Netcup ARM 8 / 8 / 160 | ~€11 | ✅ | ✅ |
| Render Starter (web) + Render Postgres + Render Redis | ~$21 | ✅ | ✅ Easiest "managed" |
| Railway Pro hobby | $5 + usage | ✅ | ✅ |
| AWS / GCP free 12 mo, then standard | $10–50 | ✅ | ✅ Enterprise |
| Sharded 3-host fleet at 1,000 businesses | ~€80–150 | ✅ | ✅ |

---

## 12. What will NOT work

| Host type | Why it fails |
|---|---|
| **Vercel / Netlify for the API or connectors** | Serverless, no persistent process, no outbound WebSocket, no persistent disk for Baileys auth |
| **Render / Railway / Fly.io free tier** | Sleeps after 15 min, ephemeral disk — Baileys auth wiped on every restart, customers re-pair every wake |
| **Hugging Face Spaces (Docker)** | Free Docker but no WebSocket guarantee and ephemeral disk |
| **AWS Lambda / GCP Cloud Run for the connectors** | Cold starts drop WS connections; no persistent disk |
| **SQLite in production** | Single writer, no tenant crash isolation, no concurrent worker |
| **A host with < 1 GB RAM** | Baileys + Postgres + Redis + uvicorn will OOM under any real load |
| **A host with HDD instead of SSD** | Postgres commits + Baileys auth reads will be IO-bound |
| **A NAT-only host with no inbound 80/443** | Public web panel + API need a public address (use Cloudflare tunnel if no public IP) |

---

## Appendix A — Quick-start sizing decision tree

```
How many active WhatsApp numbers will you pair?
│
├── 1–3     → Minimum profile    (2 vCPU / 4 GB / 40 GB)
├── 5–50    → Recommended        (4 vCPU / 8 GB / 80 GB)
├── 50–150  → Production starter (8 vCPU / 16 GB / 200 GB) + managed Postgres
├── 150–500 → Sharded WA fleet   (16 vCPU / 32 GB / 300 GB, 3–5 wa shards)
└── 500+    → Multi-host fleet   (40+ vCPU / 80+ GB / 500 GB+, managed everything)
```

## Appendix B — Files in this repo relevant to sizing

- `docker-compose.yml` — service topology and named volumes
- `docker-compose.dev.yml` — dev override (live-reload)
- `platform/api/Dockerfile` — multi-stage Python build, `uvicorn --workers 2` default
- `platform/api/requirements.txt` — Python deps (FastAPI, SQLAlchemy, psycopg, redis, pinecone, bale-sdk)
- `platform/wa-connector/Dockerfile` + `package.json` — Baileys (Node 20)
- `platform/web/Dockerfile` + `package.json` — Next.js 15
- `.env.example` — every tunable (Postgres URL, Redis URL, OpenAI/Pinecone keys, sms.ir, Zibal)
- `deploy.md` — long-form deployment guide (this file is the short spec)
- `platform/docs/scale-1000-businesses.md` — scale-out design at 1,000 tenants
- `platform/promet.md` — Divar connector internal hook design (no infra impact)

---

**Last updated:** 2026 — sizing envelope is conservative. If you find
real numbers in production that differ materially (especially per-WA-session
RAM), update this file and `platform/docs/scale-1000-businesses.md` together.






