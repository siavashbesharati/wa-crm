# syntax=docker/dockerfile:1.7
# Bale WebSocket connector - same shape as the Divar sidecar but on a
# different port and using the bale-sdk which needs a C toolchain at
# install time.
FROM python:3.12-slim AS builder
WORKDIR /app

# bale-sdk may pull in compiled extensions. Build the wheel set with the
# toolchain present.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential gcc libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt


FROM python:3.12-slim AS runtime
WORKDIR /app

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

COPY --from=builder /wheels /wheels
COPY requirements.txt .
RUN pip install --no-index --find-links=/wheels -r requirements.txt \
    && rm -rf /wheels

COPY --chown=app:app *.py ./

RUN mkdir -p /app/state \
    && chown -R app:app /app/state

USER app

EXPOSE 8092

ENV CRM_API_BASE=http://api:8000/api \
    BALE_CONNECTOR_PORT=8092

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=5 \
    CMD python -c "import urllib.request,sys; \
sys.exit(0) if urllib.request.urlopen('http://127.0.0.1:8092/health', timeout=3).status == 200 else sys.exit(1)"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "main.py"]
