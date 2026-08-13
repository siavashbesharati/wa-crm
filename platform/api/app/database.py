from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

if settings.is_sqlite:
    engine = create_engine(
        settings.database_url,
        future=True,
        connect_args={"check_same_thread": False, "timeout": 30},
        # QueuePool + SQLite caused lock/corruption when processes were killed.
        poolclass=NullPool,
    )
else:
    engine = create_engine(
        settings.database_url,
        future=True,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
    )
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@event.listens_for(engine, "connect")
def _sqlite_fk(dbapi_conn, _):
    if settings.is_sqlite:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=30000")
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
        except Exception:
            pass
        cursor.close()
