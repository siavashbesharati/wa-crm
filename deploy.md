# Deployment Guide

How to publish this app online — both quick-and-free and production-grade paths.

---

## TL;DR (read this first)

This project is **not a single web app** — it's a system of **five long-lived services** that must run together and talk to each other:

| # | Service | Stack | Default port | What it does |
|---|---|---|---|---|
| 1 | **API** | FastAPI + SQLite/Postgres | `8000` | Auth, CRM, billing, AI orchestration |
| 2 | **Web** | Next.js 15 | `3000` | Admin panel (business + super-admin) |
| 3 | **Worker** | Python (`app.workers.runner`) | — | Background jobs (campaigns, lead enrich, AI reply) |
| 4 | **WA Connector** | Node + Baileys | `8090` | Owns the WhatsApp WebSocket session |
| 5 | **Divar Connector** | Python (httpx) | `8091` | Polls Divar for new chats |
| 6 | **Bale Connector** | Python (asyncio + bale-sdk) | `8092` | Owns the Bale WebSocket session |

> ⚠️ The **Baileys (WA) and Bale connectors are the hard part.** They maintain **persistent outbound WebSocket connections** to WhatsApp / Bale servers, hold encryption state on disk, and must stay online 24/7 for messages to flow. **Most free PaaS tiers will not work** for these.

### The free-hosting landscape in one sentence

- **Vercel / Netlify** → free for the **web** only. Not for the API/connectors.
- **Render / Railway / Fly.io / Koyeb** → free web-service tiers, but **free Postgres + free Redis + 3–5 long-lived services quickly exceed the limits**, and ephemeral filesystems will break Baileys/Bale on restart.
- **Oracle Cloud Always Free** → genuinely free forever **ARM VM** that can host everything — closest to "real" free.
- **Hugging Face Spaces (Docker)** → free Docker container, but no outbound WebSocket guarantee and ephemeral disk — fragile for this app.
- **The honest answer:** for a multi-service system that holds session state, the **truly free path is Oracle Cloud Always Free** (or any small free VM from a provider that gives you a real Linux box with persistent disk).

---

## 1. What this app needs from a host

### 1.1 Hard requirements (non-negotiable)

| Requirement | Why |
|---|---|
| **Always-on Linux box** (or 2–3 boxes) | The API, worker, and all 3 connectors must run continuously |
| **Persistent disk** for each connector | Baileys and Bale keep their auth state in local files (`auth_info_baileys/`, etc.) — restart loses the session and forces re-pairing |
| **Outbound HTTPS + WebSocket** to WhatsApp, Bale, Divar, OpenAI/Gemini, Pinecone, sms.ir | Standard API calls |
| **Inbound HTTPS** for the API and web panel | Public traffic |
| **≥ 1 GB RAM** | Baileys holds the WhatsApp socket in memory and grows with each session (~50–150 MB per active account) |
| **Cron / queue** for the worker | A single long-running Python process is fine — no separate cron needed |

### 1.2 Nice-to-have

| Requirement | Why |
|---|---|
| **Postgres ≥ 13** instead of SQLite | The default DB is SQLite. It works for ~10 orgs but breaks under concurrent writes from the worker. **Switch to managed Postgres on any non-toy deployment.** |
| **Redis ≥ 6** | Used for SSE pub/sub and the job queue. Falls back to JSONL files if absent, which is fine for low traffic but fragile under load. |
| **TURN/STUN-friendly network** | Some Iranian CDNs and WhatsApp edge nodes occasionally need outbound to non-standard ports |
| **Outbound to Iranian IPs** (for sms.ir, Zibal, Divar) | If your server is in EU/US, these may be slow or blocked from your VPS — plan accordingly |

### 1.3 What will NOT work on free tiers

- ❌ **Vercel / Netlify for the API** — serverless, no persistent process, no WebSocket.
- ❌ **Heroku Eco ($5/mo) or free dyno** — the free dyno sleeps every 30 min, breaking connectors.
- ❌ **Render free web service** — spins down after 15 min of inactivity, ephemeral disk.
- ❌ **GitHub Actions / GitHub Codespaces** — not designed for 24/7 services.
- ❌ **Cloudflare Workers** — no Node, no long-lived sockets.
- ❌ **Most "free Docker" hosts** (except the ones listed below) — they're either time-limited (24–72 h) or cold-start based.

---

## 2. Free hosting options — comparison

| Provider | Free tier (2026) | Persistent disk | Outbound WS | Multi-service | **Card?** | Verdict for this app |
|---|---|---|---|---|---|
| **Oracle Cloud Always Free** | 4× ARM Ampere A1 (1 core / 1 GB each, 24 GB RAM total) or 1× AMD (1/8 OCPU, 1 GB) | ✅ Block storage (200 GB) | ✅ | ✅ | **Card?** | ⭐ **Best true-free option** — real VM, always on |
| **Google Cloud Free** | 1× e2-micro (US only) for 12 months; some Always Free products | ✅ | ✅ | ✅ | **Card?** | 12-month limit unless you upgrade |
| **AWS Free** | t2.micro for 12 months | ✅ | ✅ | ✅ | **Card?** | 12-month limit, then ~$10/mo |
| **Hetzner Cloud** | No free tier, but €3.79/mo ARM (cheapest reliable) | ✅ | ✅ | ✅ | **Card?** | Not free, but cheapest "real" host |
| **Render** | Free web service + free Postgres (90 days) + free Redis | ⚠️ Ephemeral on free web | ✅ | ⚠️ Web only on free | **Card?** | Only the web can be hosted free; API/connectors need a paid plan |
| **Railway** | $5 free credit/month (no idle free tier) | ✅ (if you pay) | ✅ | ✅ | **Card?** | Effectively $5/mo, no true free |
| **Fly.io** | Free allowance (3 shared VMs, 3 GB storage, 160 GB/mo transfer) | ✅ Volume mounts | ✅ | ✅ | **Card?** | **Good free path** for a 2–3 service split |
| **Koyeb** | 1 free nano service (512 MB, 0.1 vCPU) | ⚠️ Ephemeral | ✅ | ⚠️ | **Card?** | One service only on free — not enough |
| **Vercel** | Generous free for Next.js | ✅ (serverless) | n/a | n/a | **No card** | ✅ Web only |
| **Hugging Face Spaces (Docker)** | 1× CPU space, 16 GB disk, sleeps after 48 h idle | ⚠️ Ephemeral on free | ⚠️ | ⚠️ | **No card** | Fragile for connectors; can work for the API only |
| **Northflank** | Free tier for small services | ✅ | ✅ | ✅ | **Card?** | Worth checking if you outgrow Fly/Render |
| **Sevalla / Adaptable** | Varies | ✅ | ✅ | ✅ | **Card?** | Paid |

### My recommendation, by budget AND by card availability

**If you have a credit card (most flexible):**

- **$0/mo, real production** → **Oracle Cloud Always Free** ARM VM (1 VM hosts the whole system). 24 GB RAM free total — way more than you need.
- **$0/mo, demo / friends-only** → **Vercel** (web) + **Render free** (API + worker; will sleep after 15 min inactivity, so not real 24/7). Skip Baileys in this mode.
- **~$5–7/mo, real production** → **Hetzner** ARM box (4 vCPU, 4 GB) — fastest path to "just works" without the Oracle Cloud sign-up hoops.
- **$5/mo, containerized** → **Railway** or **Fly.io** (Fly has a real free allowance for hobby projects).

**If you do NOT have a credit card (you have two real choices):**

- **$0/mo, web only** → **Vercel** for the Next.js admin panel. Free, no card, instant. But you still need somewhere for the API and connectors.
- **$0/mo, full demo on a single laptop** → **Vercel** (web) + your laptop running the API, worker, and all 3 connectors. Not 24/7, but works for showing the product to a small group. See section 7.
- **$0/mo, full-stack on a free Docker host** → **Hugging Face Spaces (Docker)** can run the API + worker in one container, but **the connectors will lose their Baileys/Bale auth state on every restart** (the disk is ephemeral), so you will need to re-scan the QR after each restart. Acceptable for demos, not for production.

The honest bottom line: there is **no fully card-free path that gives you 24/7 production hosting of this app**. The cheapest reliable card-free option is to host on a free VM provider that does not require a card (rare in 2026 — most have moved to card-on-file abuse prevention) or to pay for a cheap Hetzner / OVH box using a debit card, prepaid Visa, or virtual card service like **Privacy.com** (US) or ** Revolut** (EU/UK). Many Iranian users also pay hosting via **cryptocurrency-accepting providers** like **1984.is** (Iceland, $3.50/mo) or **BuyVM / FranTech** (US, ~$2/mo, accepts crypto).

See section 2.1 below for a step-by-step card-free recipe.


### 2.1 No credit card? Realistic paths for this app

If you do not have a credit card, the realistic free-hosting landscape in 2026 is much smaller than it looks. Here is what actually works for this app, ordered by how production-ready the result is.

#### Path A — Vercel (web) + Hugging Face Space Docker (API + worker) + your laptop for connectors

- **Web:** Vercel free, no card required, deploys the Next.js panel in ~60 s.
- **API + worker:** Hugging Face Spaces (Docker) free, no card required, 16 GB disk, 2 vCPU. Runs both processes in one container.
- **Connectors:** Run on your own laptop with `node scripts/start-all.mjs`. Point them at the deployed API by setting `WA_CONNECTOR_URL`, `DIVAR_CONNECTOR_URL`, `BALE_CONNECTOR_URL` env vars to point at your local sidecars. Use a free tunnel like **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8090`) or **ngrok free** to expose the sidecar health endpoint.
- **Result:** A working demo you can show to 5–10 people. Not 24/7 — the API sleeps on HF Spaces after 48 h of inactivity, and the connectors are tied to your laptop being on.
- **Cost:** $0.
- **Card needed?** No.

#### Path B — Vercel (web) + your laptop hosts everything (single-machine demo)

- The simplest path. Run `node scripts/start-all.mjs` on your laptop. Forward port 3000 (web) and 8000 (API) with `cloudflared tunnel` (free, no card) or `ngrok free`.
- Vercel is optional — you can just give people your tunnel URL.
- **Result:** Works for 1–3 users testing the product. No persistent storage, so when you close your laptop the data goes away unless you back it up.
- **Cost:** $0.
- **Card needed?** No.

#### Path C — Cheap overseas VPS via crypto or prepaid card

If you can get a prepaid Visa/Mastercard (or a virtual card from **Privacy.com** with no SSN, or a **Revolut** disposable virtual card), you can pay for these without a "real" credit card:

| Provider | Cheapest plan | Accepts | Notes |
|---|---|---|---|
| **BuyVM / FranTech** (US) | $2/mo 1 vCPU / 512 MB | Crypto (BTC, LTC, XMR) | Block-storage plan available; good for a small API + connectors |
| **1984.is** (Iceland) | $3.50/mo 1 vCPU / 1 GB | Crypto + card | Privacy-friendly, free-speech hosting; great for the connectors |
| **Hetzner Cloud** | €3.79/mo ARM | Card, SEPA, PayPal | Cheapest "real" host, EU data centers |
| **OVH / Kimsufi** | €3.50/mo | Card, PayPal, SEPA | French, sometimes has stock of cheap KS-1 boxes |
| **Netcup** (Germany) | €3.69/mo | Card, SEPA | Reliable, German support |
| **Vultr** | $2.50/mo (when in stock) | Card, PayPal, crypto (BTC, ETH, LTC, BCH) | Many global locations |
| **DigitalOcean** | $4/mo | Card, PayPal | Reliable, easy docs |

If you can get **any** card, even a prepaid one with $5 on it, Hetzner at €3.79/mo is by far the best value and is the recommended path in section 3.

#### Path D — Get a free virtual card

These services give you a virtual Visa/Mastercard number you can use for hosting signups:

- **Privacy.com** (US only) — free virtual card, no SSN, funded by bank transfer. Works for most US-based hosts.
- **Revolut** (EU/UK) — free virtual card, top up via bank transfer. Works for EU/UK-based hosts.
- **Wise** (multi-country) — free virtual card, top up via local bank. Works for many hosts.
- **Capital One** (US) — free "Eno" virtual card number for online purchases.
- **Some Iranian banks** (Mellat, Melli, Saman, Pasargad) issue Visa/Mastercard debit cards with international acceptance that work on Hetzner, Vultr, etc. You may need to enable international online transactions on the card first.

Once you have any of these, the path opens up: $0–7/mo, 24/7 production hosting, no compromises. **The 30 minutes spent getting a virtual card is by far the highest-ROI 30 minutes in this whole project.**

---

#### What about Iranian-hosted providers?

For users whose customers are mostly in Iran, an Iranian VPS is worth considering. Options like **Pars.host**, **IranHost**, **AfaghHost**, **ParsCloud**, etc. offer plans from ~50,000 toman/month (≈1 USD). They accept Iranian bank cards and Shetab. Pros: low latency inside Iran, no sanctions risk for domestic traffic, payment in IRR. Cons: limited outbound to non-Iranian services (some block Google, OpenAI, etc. at the network level), smaller instances, support is in Persian only. For an Iran-first deployment, this is often the most practical path; for a global deployment, use Hetzner/Vultr instead.


---

## 3. The recommended path: Vercel (web) + a free VM (everything else)

This split minimises cost and works around each host's weaknesses:
- Vercel is unbeatable for Next.js — global CDN, free, instant.
- A real VM (Oracle Cloud or Hetzner) hosts the API, worker, and 3 connectors, with persistent disk and unlimited outbound WebSockets.

### 3.1 What goes where

```
┌──────────────────────┐        ┌─────────────────────────────────────┐
│  Vercel (free)       │ HTTPS  │  VM (Oracle Cloud / Hetzner / Fly)  │
│  Next.js 15          │ ─────► │  ┌───────────┐  ┌──────────────┐    │
│  /login, /super,     │        │  │  API      │  │  WA conn     │    │
│  /channels, /leads,  │        │  │  :8000    │  │  :8090       │    │
│  /campaigns, /groups │        │  └───────────┘  └──────────────┘    │
└──────────────────────┘        │  ┌───────────┐  ┌──────────────┐    │
                               │  │ Worker    │  │  Bale conn   │    │
                               │  │ (no port) │  │  :8092       │    │
                               │  └───────────┘  └──────────────┘    │

### 3.2 Step-by-step

#### A. Prepare the VM (Oracle Cloud Always Free, Ubuntu 24.04 ARM)

```bash
# After creating the VM and SSH-ing in
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3.12 python3.12-venv python3-pip nodejs npm nginx certbot python3-certbot-nginx redis-server postgresql

# Optional: create a non-root user for the app
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG sudo deploy
```

#### B. Set up the database and Redis

```bash
# Postgres
sudo -u postgres createuser -s appuser
sudo -u postgres createdb -O appuser wa_crm
sudo -u postgres psql -c "ALTER USER appuser WITH PASSWORD 'STRONG_PASSWORD';"

# Redis (already running; enable persistence)
sudo sed -i 's/^appendonly no/appendonly yes/' /etc/redis/redis.conf
sudo systemctl restart redis
```

#### C. Clone and configure the API

```bash
sudo mkdir -p /opt/iranexpedia && sudo chown deploy:deploy /opt/iranexpedia
cd /opt/iranexpedia
git clone <your-repo-url> .
cd platform/api
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Edit `platform/api/app/config.py` to point at the real DB and Redis:

```python
database_url: str = "postgresql+psycopg://appuser:STRONG_PASSWORD@127.0.0.1:5432/wa_crm"
redis_url:    str = "redis://127.0.0.1:6379/0"
app_env:      str = "production"
cors_origins: str = "https://your-web.vercel.app"   # ← your Vercel domain
public_base_url: str = "https://api.your-domain.com" # ← your API domain
web_base_url:    str = "https://your-web.vercel.app"
sms_ir_dev_fallback: bool = False
```

Run the migrations:

```bash
python scripts/migrate_multichannel.py
python scripts/migrate_baileys.py
python scripts/migrate_divar.py
python scripts/migrate_bale.py
```

#### D. Run the API and worker as systemd services

Create `/etc/systemd/system/iranexpedia-api.service`:

```ini
[Unit]
Description=Iranexpedia API
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/iranexpedia/platform/api
Environment=PYTHONUTF8=1
Environment=PYTHONIOENCODING=utf-8
ExecStart=/opt/iranexpedia/platform/api/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/iranexpedia-worker.service`:

```ini
[Unit]
Description=Iranexpedia Worker
After=network.target iranexpedia-api.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/iranexpedia/platform/api
Environment=PYTHONUTF8=1
Environment=PYTHONIOENCODING=utf-8
ExecStart=/opt/iranexpedia/platform/api/.venv/bin/python -m app.workers.runner
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now iranexpedia-api iranexpedia-worker
sudo systemctl status iranexpedia-api iranexpedia-worker
```

#### E. Run the three connectors

Each connector is a small daemon. Use the same systemd pattern — one unit per connector.

`/etc/systemd/system/wa-connector.service` (Node):

```ini
[Unit]
Description=WA Connector (Baileys)
After=network.target iranexpedia-api.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/iranexpedia/platform/wa-connector
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
# Don't let systemd kill the WS socket on reload
KillSignal=SIGTERM
```

`/etc/systemd/system/divar-connector.service` (Python):

```ini
[Unit]
Description=Divar Connector
After=network.target iranexpedia-api.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/iranexpedia/platform/divar-connector
ExecStart=/opt/iranexpedia/platform/api/.venv/bin/python main.py
Restart=always
RestartSec=5
```

`/etc/systemd/system/bale-connector.service` (Python asyncio):

```ini
[Unit]
Description=Bale Connector
After=network.target iranexpedia-api.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/iranexpedia/platform/bale-connector
ExecStart=/opt/iranexpedia/platform/api/.venv/bin/python main.py
Restart=always
RestartSec=5
```


```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wa-connector divar-connector bale-connector
sudo systemctl status wa-connector divar-connector bale-connector
```

#### F. Expose the API with Nginx + Let's Encrypt

```bash
# /etc/nginx/sites-available/api
server {
    listen 80;
    server_name api.your-domain.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # SSE
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}

# /etc/nginx/sites-available/connectors
server {
    listen 80;
    server_name wa.your-domain.com;  # etc. — one per connector if you want external health checks

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.your-domain.com
```

> **Important:** the connectors are called by the API on `127.0.0.1:8090/8091/8092` — you do **not** need to expose them to the public internet. Only the API port needs to be public. Keep connectors on localhost.

#### G. Deploy the web to Vercel

```bash
cd platform/web
npm install -g vercel
vercel login
vercel link
vercel env add NEXT_PUBLIC_API_URL      # paste https://api.your-domain.com/api
vercel env add NEXT_PUBLIC_CONNECTOR_KEY # paste the value from platform/api/.local/wa_connector_key
# ...add any other envs your app needs
vercel --prod
```

The Next.js app will build and deploy to `https://your-app.vercel.app`. It will call the API at the URL you set in `NEXT_PUBLIC_API_URL`.

---

                               │  ┌───────────┐                      │
                               │  │  Divar    │                      │
                               │  │  :8091    │                      │
                               │  └───────────┘                      │
                               │  ┌───────────┐  ┌──────────────┐    │
                               │  │ Postgres  │  │  Redis       │    │
                               │  └───────────┘  └──────────────┘    │
                               └─────────────────────────────────────┘
```

---


## 4. Required config changes for production

These edits are in `platform/api/app/config.py` (and a couple of `*.service` env vars). The defaults are for **local development** — change them before exposing the API to the public.

| Setting | Local default | Production value | Why |
|---|---|---|---|
| `app_env` | `"development"` | `"production"` | Hides debug details in error responses |
| `database_url` | SQLite file | `postgresql+psycopg://…` | SQLite cannot handle concurrent writes from worker + API |
| `redis_url` | `redis://localhost:6379/0` | same or managed Redis URL | Enables proper SSE pub/sub and queue sharing |
| `cors_origins` | `localhost:3000,127.6.4.1:3000` | `https://your-web.vercel.app` | Blocks browser requests from other origins |
| `public_base_url` | `http://localhost:8000` | `https://api.your-domain.com` | Used in payment callback URLs, share links |
| `web_base_url` | `http://localhost:3000` | `https://your-web.vercel.app` | Used in email/notification links |
| `sms_ir_dev_fallback` | `True` | `False` | If sms.ir is down, **do not** log OTPs to the API console in prod |
| `super_admin_phone` | `09120674032` | Your real number | Used to gate `/super/login` |
| `jwt_secret` | auto-generated to `.local/jwt_secret` | **Regenerate and persist** (e.g. `openssl rand -hex 64`) | If you forget this, all users are logged out on restart |
| `wa_connector_key` | auto-generated | **Regenerate** | Shared secret between API and WA connector — set it on both sides |
| `bale_connector_key` | auto-generated | **Regenerate** | Same as above for Bale |
| `divar_connector_key` | auto-generated | **Regenerate** | Same as above for Divar |
| `wa_creds_fernet_key` | auto-generated | **Back it up!** | This encrypts the Baileys auth state at rest. Lose it = lose all paired sessions. |
| `payment_provider` | `zibal` | `zibal` (or `mock` for tests) | If `zibal`, also set `zibal_merchant_id` |
| `openai_api_key` / `gemini_api_key` | empty | Real keys | Required for AI reply and embeddings |
| `pinecone_api_key` | empty | Real key (serverless) | Required for RAG knowledge base; first-time setup needs `pinecone_index` created |

> **The Fernet key (`wa_creds_fernet_key`) is the single most important secret to back up.** Without it, you cannot decrypt the Baileys auth blobs, and every paired WhatsApp number has to be re-scanned.

---

## 5. Deployment checklist

Before you go live, run through this:

### Pre-deploy
- [ ] Generate real secrets: `openssl rand -hex 64` for each of `jwt_secret`, `wa_connector_key`, `bale_connector_key`, `divar_connector_key`
- [ ] Generate a Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
- [ ] Set `app_env = "production"` in `config.py`
- [ ] Switch `database_url` to Postgres
- [ ] Set `sms_ir_dev_fallback = False`
- [ ] Update `cors_origins` to your real web domain (no wildcards)
- [ ] Set `super_admin_phone` to your real number
- [ ] Add a real `openai_api_key` or `gemini_api_key`
- [ ] Add a real `pinecone_api_key` and create the index
- [ ] Add a real `sms_ir_api_key` (rotate the one in source — it is a public test key right now)

### After first boot
- [ ] Visit `https://api.your-domain.com/api/health` → should return `{"ok": true, "env": "production"}`
- [ ] Log into the super-admin panel and create a real organization
- [ ] Back up `/opt/iranexpedia/platform/api/.local/` (the 5 secret files) somewhere safe (encrypted, off-server)
- [ ] Back up the Postgres database (`pg_dump`)
- [ ] Test a full WhatsApp round-trip: pair a test number, send yourself a message, confirm it lands in the CRM
- [ ] Test a Bale round-trip the same way
- [ ] Confirm `journalctl -u iranexpedia-api` shows no errors
- [ ] Set up log rotation (`/etc/logrotate.d/iranexpedia`)
- [ ] Configure your DNS A records and HTTPS cert auto-renewal (`certbot renew --dry-run`)

### Ongoing
- [ ] Watch disk usage — Baileys logs and Postgres WAL can fill a small disk
- [ ] Watch RAM — each active WhatsApp account uses ~80–150 MB
- [ ] Watch the worker's queue depth (it is the same JSONL fallback files)
- [ ] Rotate `jwt_secret` yearly (this logs everyone out — schedule it)

---

## 6. Free-tier-specific notes

### Oracle Cloud Always Free (recommended for $0)

- Sign up requires a credit card for verification but **never charges** for always-free resources.
- The free ARM Ampere A1 shape is **4 OCPU + 24 GB RAM total**, but you can only allocate **1 OCPU / 1 GB per VM**. Create 2–3 small VMs (egress + API on one, connectors on another) or just one VM with 1 GB and scale later.
- Always Free capacity sometimes takes weeks to provision (the "capacity issue" error). If that happens, retry periodically or use a different region.
- Block storage (200 GB free) is persistent across reboots.
- Outbound to Iranian IPs may be slow or blocked from Oracle's data centers — front the API with a CDN or use a small VPS in Iran for the connector sidecars if your users are mostly inside Iran.

### Render free tier (only for the API + worker, with caveats)

- Web services on the free plan **spin down after 15 minutes of inactivity** and have an **ephemeral disk** (the file system is wiped on every deploy and restart). This breaks Baileys/Bale.
- Workaround: run the connectors on a different host and call them over HTTPS from the API. Or skip the free tier and use the $7/mo "Starter" plan.
- Free Postgres on Render is 90 days only. After that, the DB is destroyed.

### Fly.io free allowance (best for fully containerized)

- Three shared VMs, 3 GB total persistent volume storage, 160 GB/month outbound transfer. Plenty for a hobby deployment.
- Deploy with `fly launch` + `fly postgres create` + `fly redis create`. The CLI handles TLS certificates for you.
- Persistent volumes must be attached to a single region — pick the closest to your users.

### Vercel (web only — recommended regardless of where the API lives)

- Always free for personal/non-commercial use. Generous limits.
- The Next.js app is already set up to build and deploy with `vercel --prod`.
- Make sure to set `NEXT_PUBLIC_API_URL` to your **API** URL (not the web URL). The env var is the single most common deploy mistake.

### Hugging Face Spaces (Docker)

- Free CPU Space is 16 GB disk, sleeps after 48 h of inactivity. Container restarts lose any in-memory state and (depending on the Space type) may lose disk.
- Can host the **API** as a Docker Space, but the **connectors** will lose their auth on every restart. Not recommended for production.
- Useful as a free demo: pair a number, click around, expect the QR to be required again on the next day.

---

## 7. What if you only want to demo it, not run it 24/7?

For a quick demo on a free host where the limitations are acceptable:

1. Deploy the **Next.js web to Vercel** (free, instant).
2. Deploy the **API + worker to Render free web service** (will sleep after 15 min — accept that).
3. Run the **connectors on your own laptop** with `node scripts/start-all.mjs`. Point them at the deployed API.
4. Show it off for a few minutes at a time, then close the laptop.

This works because the API is stateless and Vercel/Render handle the public surface. The connectors can be ephemeral as long as you don't need 24/7 message reception.

When you're ready to go real, follow the VM path above.

---

## 8. Files you'll need to create before deploying

| File | Where | Purpose |
|---|---|---|
| `Dockerfile` (API) | `platform/api/` | already exists — verify it copies `app/`, `scripts/`, `alembic/` and `requirements.txt` |
| `Dockerfile` (web) | `platform/web/` | Vercel uses Next.js's built-in builder, no Dockerfile needed |
| `Dockerfile` (wa-connector) | `platform/wa-connector/` | **not present — create** before any containerized deploy |
| `Dockerfile` (bale/divar connectors) | `platform/{bale,divar}-connector/` | **not present — create** |
| `docker-compose.yml` | repo root | orchestrate API + worker + 3 connectors + Postgres + Redis on one VM |
| `vercel.json` | `platform/web/` | already provided by Next.js defaults; verify rewrites if you use a sub-path |
| `.env.production` | each service | real secrets; **never commit** |

I can create the missing Dockerfiles and a `docker-compose.yml` if you want — they're about 80 lines total.

---

## 9. Cost summary (realistic, mid-2026)

| Setup | Monthly cost | Persistent? | Suitable for production? |
|---|---|---|---|
| **Oracle Cloud Always Free** | **$0** | ✅ | ✅ Yes — best free option |
| Vercel (web) + Render free (API) + local connectors | **$0** | ⚠️ Sleeps on free | ⚠️ Demo only |
| Fly.io free allowance | **$0** (within allowance) | ✅ | ✅ For small workloads |
| Hetzner ARM box (4 vCPU, 4 GB) | **~€3.79** | ✅ | ✅ Best $/performance |
| Hetzner ARM box (2 vCPU, 8 GB) | **~€6.50** | ✅ | ✅ Comfortable |
| Render Starter + Render Postgres + Render Redis | **~$21/mo** | ✅ | ✅ Easiest "managed everything" path |
| Railway Pro hobby | **$5/mo** | ✅ | ✅ Easiest container deploy |
| AWS / GCP free for 12 months, then standard | **$10–50/mo after year 1** | ✅ | ✅ Enterprise-ready |

---

## 10. Open questions to answer before you deploy

1. **Where are your users?** If mostly in Iran, you may want a VPS in Iran or a CDN that has an Iranian PoP (IranCDN, ArvanCloud, etc.). Otherwise, EU/US VPS + Cloudflare is the standard path.
2. **How many concurrent WhatsApp accounts per org?** Each one is ~80–150 MB RAM and a persistent socket. Plan the VM size accordingly.
3. **Are you OK with non-Iranian SMS provider (sms.ir)?** It is an Iranian service. If you switch to Twilio etc., update `platform/api/app/services/sms.py` and remove the `sms_ir_*` config.
4. **Is the Zibal payment provider correct for you?** If your market is outside Iran, switch `payment_provider = "mock"` (no real payments) or implement Stripe/etc.
5. **Do you need multi-region?** If yes, plan for managed Postgres (Neon, Supabase, Render) and a Redis Cloud instance from day one — much easier than migrating later.

---

**Last updated:** 2026 — the free-tier landscape moves fast. If a link above 404s or a tier changed, the **Oracle Cloud Always Free** and **Vercel** offers have been stable for 3+ years and are the safest bets.
