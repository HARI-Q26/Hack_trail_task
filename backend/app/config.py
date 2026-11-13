"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Any, List

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Typed application settings."""

    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), str(BACKEND_DIR / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    NODE_ENV: str = "production"
    APP_NAME: str = "Quirri College Voice Agent"
    APP_ENV: str = "development"
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 8000

    # College API
    COLLEGE_API_BASE_URL: str = "https://ht.knowvally.com"
    COLLEGE_PARTICIPANT_KEY: str = ""
    COLLEGE_API_CLIENT_ID: str = ""
    COLLEGE_API_CLIENT_SECRET: str = ""
    COLLEGE_API_TIMEOUT_SECONDS: float = 10.0
    COLLEGE_TIMEZONE: str = "Asia/Kolkata"

    # Groq / OpenAI-compatible Chat Completions
    GROQ_API_KEY: str = ""
    GROK_API_KEY: str = ""
    GROK_BASE_URL: str = "https://api.groq.com/openai/v1"
    GROQ_MODEL: str = "openai/gpt-oss-120b"
    GROK_MODEL: str = "openai/gpt-oss-120b"
    GROQ_FALLBACK_MODEL: str = "openai/gpt-oss-20b"
    GROQ_STT_MODEL: str = "whisper-large-v3-turbo"
    GROQ_STT_FALLBACK_MODEL: str = "whisper-large-v3"
    GROK_TIMEOUT_SECONDS: float = 25.0

    # Security / Session
    SESSION_SECRET: str = ""
    SESSION_SECRET_KEY: str = "dev-insecure-change-me-in-production"
    SESSION_COOKIE_NAME: str = "quirri_session"
    SESSION_EXPIRE_MINUTES: int = 480
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    def model_post_init(self, __context: Any) -> None:
        if self.SESSION_SECRET and (not self.SESSION_SECRET_KEY or self.SESSION_SECRET_KEY == "dev-insecure-change-me-in-production"):
            self.SESSION_SECRET_KEY = self.SESSION_SECRET
        if self.GROQ_MODEL:
            self.GROK_MODEL = self.GROQ_MODEL

    # Database & Knowledge
    DATABASE_URL: str = "sqlite:///./data/quirri_college.db"
    KNOWLEDGE_DOCS_DIR: str = "./data/documents"

    # CORS
    CORS_ORIGINS: str = "http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    @property
    def knowledge_path(self) -> Path:
        p = Path(self.KNOWLEDGE_DOCS_DIR)
        if not p.is_absolute():
            root_candidate = REPO_ROOT / p
            if root_candidate.exists() or not p.exists():
                return root_candidate
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()
