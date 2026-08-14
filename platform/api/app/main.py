from __future__ import annotations

from app.services.stdio_utf8 import configure_stdio

configure_stdio()

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routers import (
    admin,
    ai,
    auth,
    channels,
    divar_connector,
    divar_pair,
    extension,
    kpi,
    leads,
    messages,
    orgs,
    payments,
    seats,
    support,
    tasks,
    wa_connector,
    wa_pair,
    whatsapp,
)
from app.services.sse_hub import sse_hub

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        sse_hub.bind_loop()
    except RuntimeError:
        pass
    yield


app = FastAPI(
    title="IranExpedia Multi-Channel CRM API",
    version="1.2.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list or ["http://localhost:3000"],
    allow_origin_regex=(
        r"https://web\.whatsapp\.com|"
        r"https://([a-z0-9-]+\.)?divar\.ir|"
        r"chrome-extension://.*|"
        r"http://(localhost|127\.0\.0\.1)(:\d+)?"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTERS = [
    admin.router,
    auth.router,
    orgs.router,
    seats.router,
    leads.router,
    tasks.router,
    channels.router,
    wa_pair.router,
    divar_pair.router,
    whatsapp.router,
    messages.router,
    ai.router,
    kpi.router,
    extension.router,
    payments.router,
    support.router,
    wa_connector.router,
    divar_connector.router,
]


def _mount_routers() -> None:
    prefix = "/api"
    for router in ROUTERS:
        app.include_router(router, prefix=prefix)


def _ensure_sqlite_columns() -> None:
    """Add new columns to existing SQLite DBs (create_all won't alter)."""
    if not settings.is_sqlite:
        return
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    tables = insp.get_table_names()
    if "organizations" in tables:
        cols = {c["name"] for c in insp.get_columns("organizations")}
        if "plan_expires_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE organizations ADD COLUMN plan_expires_at DATETIME"))
    if "ai_policies" in tables:
        cols = {c["name"] for c in insp.get_columns("ai_policies")}
        with engine.begin() as conn:
            if "agent_role" not in cols:
                conn.execute(text("ALTER TABLE ai_policies ADD COLUMN agent_role VARCHAR(200) DEFAULT ''"))
            if "system_prompt" not in cols:
                conn.execute(text("ALTER TABLE ai_policies ADD COLUMN system_prompt TEXT DEFAULT ''"))
            if "fallback_message" not in cols:
                conn.execute(text("ALTER TABLE ai_policies ADD COLUMN fallback_message TEXT DEFAULT ''"))
            if "group_auto_send_enabled" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE ai_policies ADD COLUMN group_auto_send_enabled BOOLEAN DEFAULT 0"
                    )
                )
            if "group_reply_mode" not in cols:
                conn.execute(
                    text("ALTER TABLE ai_policies ADD COLUMN group_reply_mode VARCHAR(32) DEFAULT 'off'")
                )
            if "group_keywords" not in cols:
                conn.execute(text("ALTER TABLE ai_policies ADD COLUMN group_keywords JSON"))
    if "payments" in tables:
        cols = {c["name"] for c in insp.get_columns("payments")}
        if "raw_callback" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE payments ADD COLUMN raw_callback TEXT DEFAULT ''"))
    if "leads" in tables:
        cols = {c["name"] for c in insp.get_columns("leads")}
        if "board_order" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE leads ADD COLUMN board_order INTEGER DEFAULT 0"))
    if "tasks" in tables:
        cols = {c["name"] for c in insp.get_columns("tasks")}
        if "board_order" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN board_order INTEGER DEFAULT 0"))
        if "source" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN source VARCHAR(20) DEFAULT 'manual'"))
        if "source_message_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE tasks ADD COLUMN source_message_id VARCHAR(120) DEFAULT ''"))
    if "channel_accounts" in tables:
        cols = {c["name"] for c in insp.get_columns("channel_accounts")}
        with engine.begin() as conn:
            if "connector_type" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE channel_accounts ADD COLUMN connector_type VARCHAR(40) DEFAULT 'extension'"
                    )
                )
            if "pairing_state" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE channel_accounts ADD COLUMN pairing_state VARCHAR(40) DEFAULT 'disconnected'"
                    )
                )
            if "wa_jid" not in cols:
                conn.execute(text("ALTER TABLE channel_accounts ADD COLUMN wa_jid VARCHAR(120) DEFAULT ''"))
            if "qr_payload" not in cols:
                conn.execute(text("ALTER TABLE channel_accounts ADD COLUMN qr_payload TEXT DEFAULT ''"))
    if "outbound_jobs" in tables:
        cols = {c["name"] for c in insp.get_columns("outbound_jobs")}
        if "target_jid" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE outbound_jobs ADD COLUMN target_jid VARCHAR(200) DEFAULT ''")
                )
    if "messages" in tables:
        cols = {c["name"] for c in insp.get_columns("messages")}
        with engine.begin() as conn:
            if "media_type" not in cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN media_type VARCHAR(40) DEFAULT ''"))
            if "media_url" not in cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN media_url TEXT DEFAULT ''"))


_mount_routers()

# Ensure tables exist for local/sqlite and TestClient (no lifespan)
Base.metadata.create_all(bind=engine)
_ensure_sqlite_columns()

try:
    from app.plans import ensure_default_plans

    ensure_default_plans()
except Exception:
    pass


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "env": settings.app_env,
        "sse_subscribers": sse_hub.subscriber_count(),
    }
