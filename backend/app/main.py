"""FastAPI application entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.config import get_settings
from app.database.session import SessionLocal, init_db
from app.knowledge.pdf_service import ingest_directory


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    settings = get_settings()
    settings.knowledge_path.mkdir(parents=True, exist_ok=True)
    with SessionLocal() as db:
        ingest_directory(db, settings.knowledge_path)
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.APP_NAME,
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_origin_regex=r"https://[a-zA-Z0-9-]+\.trycloudflare\.com",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    return app


app = create_app()

