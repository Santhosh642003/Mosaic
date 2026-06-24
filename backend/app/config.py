"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── App ──────────────────────────────────────────────────────────────
    app_name: str = "Mosaic"
    debug: bool = False
    frontend_url: str = "http://localhost:5173"

    # ── Database ─────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://mosaic:mosaic@localhost:5432/mosaic"

    # ── Redis ─────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"

    # ── Auth ──────────────────────────────────────────────────────────────
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7  # 7 days

    # ── GitHub OAuth ──────────────────────────────────────────────────────
    github_client_id: str = ""
    github_client_secret: str = ""
    github_redirect_uri: str = "http://localhost:8000/api/auth/github/callback"

    # ── Groq LLM ─────────────────────────────────────────────────────────
    groq_api_key: str = ""
    decomp_model: str = "llama-3.3-70b-versatile"
    coding_model: str = "llama-3.3-70b-versatile"
    merge_model: str = "llama-3.3-70b-versatile"

    # ── Room settings ─────────────────────────────────────────────────────
    room_code_length: int = 6
    room_ttl_hours: int = 48
    max_teammates: int = 6


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
