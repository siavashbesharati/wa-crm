from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routers import (
    admin,
    ai,
    auth,
    channels,
    extension,
    kpi,
    leads,
    messages,
    orgs,
    payments,
    seats,
    support,
    tasks,
    whatsapp,
)

settings = get_settings()

app = FastAPI(title="IranExpedia Multi-Channel CRM API", version="1.2.0")
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
    whatsapp.router,
    messages.router,
    ai.router,
    kpi.router,
    extension.router,
    payments.router,
    support.router,
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
    if "payments" in tables:
        cols = {c["name"] for c in insp.get_columns("payments")}
        if "raw_callback" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE payments ADD COLUMN raw_callback TEXT DEFAULT ''"))


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
    return {"ok": True, "env": settings.app_env}
