from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import Base, engine
from app.routers import ai, auth, channels, kpi, leads, messages, orgs, tasks, whatsapp

settings = get_settings()

app = FastAPI(title="IranExpedia Multi-Channel CRM API", version="1.1.0")
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
    auth.router,
    orgs.router,
    leads.router,
    tasks.router,
    channels.router,
    whatsapp.router,
    messages.router,
    ai.router,
    kpi.router,
]


def _mount_routers() -> None:
    prefix = "/api"
    for router in ROUTERS:
        app.include_router(router, prefix=prefix)


_mount_routers()

# Ensure tables exist for local/sqlite and TestClient (no lifespan)
Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health():
    return {"ok": True, "env": settings.app_env}
