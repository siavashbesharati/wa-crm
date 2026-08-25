# syntax=docker/dockerfile:1.7
# Divar HTTP connector — same minimal shape as the API but for the sidecar
FROM python:3.12-slim
WORKDIR /app

# System packages: tini (signal handling) is the only runtime dep we need.
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home /app --shell /bin/bash app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    PYTHONIOENCODING=utf-8 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app *.py ./

# Persistent state: encrypted Divar cookies live in the API's auth tables;
# this container only holds an in-memory cache.
RUN mkdir -p /app/state \
    && chown -R app:app /app/state

USER app

EXPOSE 8091

# Defaults — override in docker-compose.yml
ENV CRM_API_BASE=http://api:8000/api \
    DIVAR_CONNECTOR_PORT=8091

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8091/health', timeout=3).status == 200 else sys.exit(1)"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "main.py"]
