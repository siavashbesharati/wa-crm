# syntax=docker/dockerfile:1.7
# ---- deps: full install (incl. dev deps) for the build ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi


# ---- builder: produce the standalone .next output ----
FROM deps AS builder
WORKDIR /app

# NEXT_OUTPUT_STANDALONE=1 is read by next.config.ts and makes `next build`
# emit a slim .next/standalone folder we can copy into the runtime image.
ENV NEXT_OUTPUT_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1

COPY --chown=app:app . .
RUN npm run build


# ---- runtime: minimal image that runs `node server.js` from standalone ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home /app --shell /bin/bash app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Copy the standalone server (deps + server.js) and the static + public
# folders that the standalone build does not bundle automatically.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

USER app

EXPOSE 3000

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
