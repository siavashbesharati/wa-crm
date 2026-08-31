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
CMD ["./node_modules/.bin/tsx", "watch", "src/index.ts"]


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

# Install only production dependencies
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# Copy the source. tsx is needed at runtime because the project ships
# .ts files directly (no build step), so we re-install tsx for runtime
# and pin it to the same version declared in devDependencies.
COPY package.json ./
RUN npm install --no-save tsx@^4.19.3

COPY --chown=app:app src ./src
COPY --chown=app:app tsconfig.json ./tsconfig.json

# Persistent state: Baileys auth directory
RUN mkdir -p /app/baileys_auth \
    && chown -R app:app /app

USER app

EXPOSE 8090

# Healthcheck hits the local health endpoint
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "require('http').get('http://127.0.0.1:8090/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
# Run tsx directly — npx needs a writable npm cache under /app/.npm
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
