
# Docker / Docker Compose

Run the whole platform — Postgres, Redis, API, worker, three connector sidecars, and the Next.js web — with one command.

---

## TL;DR

```bash
# from the repo root
cp .env.example .env            # edit if you want (defaults work for local dev)
docker compose up -d --build    # builds all images, starts all services
# wait ~30 s for the API to run migrations and the worker to come up
# open:
#   http://localhost:3000      Next.js admin panel
#   http://localhost:8000/api/health   API healthcheck
#   http://localhost:8090/health       WA connector (only in dev override)
#   http://localhost:8091/health       Divar connector (only in dev override)
#   http://localhost:8092/health       Bale connector (only in dev override)
```

`docker compose down` stops everything. **`docker compose down -v` deletes the named volumes** (Postgres data, Redis data, Baileys auth, .local secrets) — never run that in production.

---

## What gets built

| Service | Image | Port(s) | Source | Notes |
|---|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 (internal) | pulled | persistent volume `pgdata` |
| `redis` | `redis:7-alpine` | 6379 (internal) | pulled | append-only persistence, volume `redisdata` |
| `api` | `platform/api/Dockerfile` | 8000 | local | multistage: builder → runtime; non-root; tini; healthcheck |
| `worker` | reuses `api` image | — | local | runs `python -m app.workers.runner` |
| `wa-connector` | `platform/wa-connector/Dockerfile` | 8090 (exposed in dev) | local | multistage: deps → dev / runtime; non-root; tini; healthcheck |
| `divar-connector` | `platform/divar-connector/Dockerfile` | 8091 (exposed in dev) | local | non-root; tini; healthcheck |
| `bale-connector` | `platform/bale-connector/Dockerfile` | 8092 (exposed in dev) | local | non-root; tini; healthcheck |
| `web` | `platform/web/Dockerfile` | 3000 | local | multistage: deps → builder (standalone) → runtime; non-root; tini; healthcheck |

All services share a dedicated bridge network `iranexpedia-net` so the connectors can reach the API by name (`http://api:8000/api`).

---

## Files added / changed

```
repo root
├── docker-compose.yml              # the production-like stack
├── docker-compose.override.yml     # dev-only overrides (hot reload, debug ports)
├── .env.example                    # documented env vars
└── DOCKER.md                       # this file

platform/api/
├── Dockerfile                      # rewritten (was a 7-line stub)
├── .dockerignore                   # new
└── scripts/docker-entrypoint.sh    # new - waits for DB + runs migrations

platform/wa-connector/
├── Dockerfile                      # new
└── .dockerignore                   # new

platform/divar-connector/
├── Dockerfile                      # new
└── .dockerignore                   # new

platform/bale-connector/
├── Dockerfile                      # new
└── .dockerignore                   # new

platform/web/
├── Dockerfile                      # new
├── .dockerignore                   # new
└── next.config.ts                  # adds `output: "standalone"` when env var is set
```

---

## Day-to-day commands

```bash
# start / stop
docker compose up -d --build
docker compose down
docker compose restart api

# follow logs (all services, colored)
docker compose logs -f

# follow just the API
docker compose logs -f api

# open a shell in the API container
docker compose exec api bash

# re-run a single migration (e.g. after adding a column)
docker compose exec api python scripts/migrate_baileys.py

# inspect the Postgres data
docker compose exec db psql -U crm -d crm

# see the running containers + their health
docker compose ps
```

---

## Dev mode (hot reload, debug ports)

By default `docker compose up` runs the **production-like** images. To switch to dev mode (source mounted, reload on save, connector health ports exposed to localhost), pass both compose files explicitly:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.yml up
```

Or set `COMPOSE_FILE=docker-compose.yml:docker-compose.override.yml` in your shell and just run `docker compose up`.

Dev differences:

| | prod (default) | dev (override) |
|---|---|---|
| API command | `uvicorn ... --workers 2` | `uvicorn ... --reload` |
| API source | baked into image | mounted from `./platform/api` |
| WA connector | `tsx src/index.ts` (production stage) | `tsx watch src/index.ts` (dev stage) |
| Divar / Bale | python main.py | python main.py + source mounted |
| Web | `node server.js` (standalone) | `npx next dev` (HMR) |
| Connector health ports | exposed on docker network only | also mapped to `localhost:8090/8091/8092` |

---

## Production build & deploy

For a real deployment, you typically want to push the images to a registry (Docker Hub, GHCR, ECR) and pull them on the host. The compose file is portable - only `image:` and `build:` need adjustment.

### Option A: build locally, push to Docker Hub

```bash
# from the repo root
docker compose build
docker tag iranexpedia-api:latest    youruser/iranexpedia-api:1.2.0
docker tag iranexpedia-web:latest    youruser/iranexpedia-web:1.2.0
docker tag iranexpedia-wa-connector:latest  youruser/iranexpedia-wa-connector:1.2.0
docker tag iranexpedia-divar-connector:latest youruser/iranexpedia-divar-connector:1.2.0
docker tag iranexpedia-bale-connector:latest youruser/iranexpedia-bale-connector:1.2.0
docker push youruser/iranexpedia-api:1.2.0
docker push youruser/iranexpedia-web:1.2.0
# ... etc.
```

Then on the production host, change each `image:` in `docker-compose.yml` from `iranexpedia-*:latest` to `youruser/iranexpedia-*:1.2.0` and run `docker compose pull && docker compose up -d`.

### Option B: build on the server

```bash
# on the production host (after `git clone`)
cp .env.example .env  # edit secrets
docker compose up -d --build
```

This is fine for a single host, but the build step needs to happen on the same architecture as the host (ARM vs x86_64). The base images (`python:3.12-slim`, `node:20-bookworm-slim`, `postgres:16-alpine`) are multi-arch, so this works on both.

### Required env vars for production

Set these in your `.env` (or pass via your orchestrator's secret store) **before** `docker compose up`:

| Var | Why |
|---|---|
| `POSTGRES_PASSWORD` | DB root password |
| `APP_ENV=production` | turns off debug responses |
| `CORS_ORIGINS=https://your-web.example.com` | the only origin allowed to call the API |
| `PUBLIC_BASE_URL=https://api.example.com` | used in payment callback URLs |
| `WEB_BASE_URL=https://your-web.example.com` | used in email/notification links |
| `NEXT_PUBLIC_API_URL=https://api.example.com/api` | baked into the JS bundle at build time |
| `SUPER_ADMIN_PHONE=+98...` | gate to `/super/login` |
| `SMS_IR_API_KEY=...` | real SMS provider key (rotate the test one in source) |
| `OPENAI_API_KEY=...` or `GEMINI_API_KEY=...` | required for AI features |
| `PINECONE_API_KEY=...` | required for RAG knowledge base |
| `PAYMENT_PROVIDER=zibal` + `ZIBAL_MERCHANT_ID=...` | for real payments |

The `wa_creds_fernet_key` and connector shared keys are **auto-generated on first boot** and stored in the `api_secrets` named volume. **Back up that volume** (it's a Docker volume, not a file you can just `cp`) - losing it forces every paired WhatsApp number to be re-scanned.

To back it up:

```bash
docker run --rm -v iranexpedia_api_secrets:/data -v $(pwd):/backup alpine \
    tar czf /backup/api_secrets_$(date +%F).tar.gz /data
```

---

## Persistent state (what to back up)

| Volume | Contents | Loss impact |
|---|---|---|
| `iranexpedia_pgdata` | All CRM data: orgs, users, leads, messages, settings | Total data loss |
| `iranexpedia_redisdata` | SSE pub/sub state, job queue (if Redis queue is enabled) | Lost in-flight jobs (no data loss) |
| `iranexpedia_api_secrets` | JWT secret, Fernet key, connector shared keys | All users logged out, **all WhatsApp sessions must re-scan QR** |
| `iranexpedia_wa_auth` | Baileys auth state (creds.json, app-state sync keys) | **All WhatsApp sessions must re-scan QR** |

Back up `pgdata` nightly (e.g. `docker exec iranexpedia-db pg_dump -U crm crm | gzip > backup.sql.gz`) and `api_secrets` + `wa_auth` whenever they change.

---

## Troubleshooting

### "The API keeps restarting with 'Connection refused' on Postgres"

The API container started before Postgres was ready. The healthcheck on the `db` service should prevent this, but if you see it:

```bash
docker compose logs db            # check Postgres is starting
docker compose restart api        # retry once DB is up
```

### "The WA connector logs `ECONNREFUSED 127.0.0.1:8000` on startup"

Same race condition with the API. The WA connector's `depends_on: api: service_started` only checks that the API container started, not that the app inside is responding. The connector retries every 2 s, so it will recover automatically. If it doesn't, run:

```bash
docker compose restart wa-connector
```

### "I changed `NEXT_PUBLIC_API_URL` in .env but the web still calls the old URL"

That env var is read at **build time** and baked into the JS bundle. Rebuild the web image:

```bash
docker compose build web
docker compose up -d web
```

### "I changed the connector port and now the API can't find it"

The API talks to the connectors on `127.0.0.1:8090/8091/8092` (in the dev / non-Docker flow) or directly via the docker network (`wa-connector:8090` etc.) - **not** the same `127.0.0.1`. The compose file already handles this for the in-network case. If you run the API outside compose and want to talk to in-compose connectors, expose the connector ports and point the API at `host.docker.internal:8090`.

### "I want to use the SQLite fallback instead of Postgres"

The default `DATABASE_URL` in the image is `postgresql+psycopg://crm:crm@db:5432/crm`. To use SQLite, override it:

```bash
# in .env or compose override
DATABASE_URL=sqlite+pysqlite:////app/data/wa_crm.db
```

Then the API will write the SQLite file to the `api_secrets` volume (mounted at `/app/.local` + `/app/data`). Useful for tiny single-host setups but **not recommended** because the worker writes concurrently.

### "The web image is huge (300+ MB)"

The Next.js standalone build should produce an image under 200 MB. If you see 300+ MB, the `.next/static` or `public` folder wasn't copied. Check the `COPY --from=builder` lines in `platform/web/Dockerfile`.

### "Docker build fails on `pip install` - can't reach pypi.org"

Your network blocks PyPI directly. Options:
- Configure Docker to use a mirror (e.g. Aliyun, Tsinghua, or an internal Nexus) via `~/.pip/pip.conf` baked into the image
- Use the `--network=host` build flag: `docker build --network=host -t iranexpedia-api .`

### "Free disk space warning"

Docker images and volumes accumulate. Clean up:

```bash
docker system df                    # see what's using space
docker image prune -a               # remove unused images
docker volume prune                 # remove unused volumes (CAREFUL - only those not in use)
```

---

## Note: there is also a partial `platform/docker-compose.yml`

A pre-existing minimal compose file lives at `platform/docker-compose.yml` that only stands up `db + redis + api + workers` (no connectors, no web). It is left in place intentionally for quick API-only development. The root `docker-compose.yml` is the canonical full-stack setup and should be used for any deployment that needs the connectors or the Next.js panel.
