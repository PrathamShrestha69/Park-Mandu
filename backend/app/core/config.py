from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Park Mandu API"
    environment: Literal["development", "test", "staging", "production"] = "development"
    api_prefix: str = "/api/v1"
    timezone: str = "Asia/Kathmandu"

    database_url: str = "postgresql+psycopg://parkmandu:parkmandu_dev_password@localhost:5433/parkmandu"
    redis_url: str = "redis://localhost:6380/0"
    celery_broker_url: str = "redis://localhost:6380/1"
    celery_result_backend: str = "redis://localhost:6380/2"

    secret_key: str
    field_encryption_key: str
    ingest_api_key: str
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14
    otp_ttl_seconds: int = 300
    password_reset_ttl_seconds: int = 1800
    login_max_failures: int = 5
    login_lockout_seconds: int = 900

    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str | None = None
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]

    upload_dir: str = "./uploads"
    max_upload_mb: int = 10

    simulate_detections: bool = True
    expose_dev_codes: bool = False
    expo_push_enabled: bool = False

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("cookie_domain", mode="before")
    @classmethod
    def _empty_domain(cls, value: object) -> object:
        return value or None

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


# Default position for cameras that register without coordinates (Ratna Park, Kathmandu).
KATHMANDU_CENTER = (27.7056, 85.3206)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
