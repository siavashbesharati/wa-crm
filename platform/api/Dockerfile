# syntax=docker/dockerfile:1.7
# ---- builder stage: compile wheels for any compiled deps ----
FROM python:3.12-slim AS builder
WORKDIR /app

# System packages needed only at build time for cryptography / psycopg wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential gcc libffi-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


# ---- runtime stage: minimal image, non-root user ----
FROM python:3.12-slim AS runtime

# Tini gives us proper signal handling so uvicorn shuts down cleanly on
# docker stop / Ctrl+C / pod termination. Without it, asyncio's
# "Task exception was never retrieved" warning shows up on stop.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home /app --shell /bin/bash app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install pre-built wheels from the builder stage
COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

# Copy the application source. Migrations live in scripts/ + alembic/.
COPY --chown=app:app app ./app
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app alembic.ini ./alembic.ini

# Persistent state: .local (auto-generated secrets) and data/ (SQLite fallback)
RUN mkdir -p /app/.local /app/data \
    && chown -R app:app /app/.local /app/data

USER app

EXPOSE 8000

# Defaults — override in docker-compose.yml
ENV APP_ENV=production \
    DATABASE_URL=postgresql+psycopg://crm:crm@db:5432/crm \
    REDIS_URL=redis://redis:6379/0

# Run migrations then start the API. A wrapper script is used so the
# container's PID 1 is tini (signal handler) and the migration step is part
# of the same lifecycle.
COPY --chown=app:app scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3).status == 200 else sys.exit(1)"

