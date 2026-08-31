# syntax=docker/dockerfile:1.7
# ---- deps stage: install all deps (including devDeps) ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# `npm ci` is reproducible but requires package-lock.json. If you don't
# ship a lockfile (yet), fall back to `npm install`.
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi


# ---- dev stage: includes tsx for hot reload ----
FROM deps AS dev
CMD ["node", "node_modules/tsx/dist/cli.mjs", "watch", "src/index.ts"]


# ---- runtime stage: install only prod deps, run as non-root ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Tini for proper signal handling (Ctrl+C / docker stop)
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home /app --shell /bin/bash app

ENV NODE_ENV=production \
    NPM_CONFIG_LOGLEVEL=warn

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
    && test -f node_modules/tsx/dist/cli.mjs

COPY --chown=app:app src ./src
COPY --chown=app:app tsconfig.json ./tsconfig.json

# Persistent state: Baileys auth directory
RUN mkdir -p /app/baileys_auth \
    && chown -R app:app /app

USER app

EXPOSE 8090

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "require('http').get('http://127.0.0.1:8090/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# Use node + tsx cli.mjs — npx needs a writable npm cache; .bin/tsx is a shell script tini cannot exec reliably
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/index.ts"]
