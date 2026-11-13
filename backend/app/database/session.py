"""SQLAlchemy engine and session management."""

import logging
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings
from app.database.models import Base

logger = logging.getLogger(__name__)


def _build_engine():
    settings = get_settings()
    db_url = settings.DATABASE_URL
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    if db_url.startswith("postgresql://"):
        try:
            eng = create_engine(db_url, pool_pre_ping=True, future=True)
            with eng.connect() as conn:
                pass
            logger.info("Connected to PostgreSQL database.")
            return eng
        except Exception as exc:
            logger.warning("Could not connect to PostgreSQL (%s). Falling back to SQLite for local execution.", exc)
            db_url = "sqlite:///./data/quirri_college.db"

    connect_args = {}
    if db_url.startswith("sqlite:///"):
        raw_path = db_url.replace("sqlite:///", "", 1)
        if raw_path != ":memory:":
            Path(raw_path).parent.mkdir(parents=True, exist_ok=True)
        connect_args = {"check_same_thread": False}
    return create_engine(db_url, connect_args=connect_args, future=True)


engine = _build_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)


def init_db() -> None:
    """Create database tables if they do not exist."""
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

