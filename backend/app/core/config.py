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

    # Nearest-officer dispatch: only on-duty officers who reported a position this recently are eligible.
    dispatch_radius_m: int = 1000
    officer_location_ttl_seconds: int = 600
    # After a "no officer within the radius" notice for a camera, more notices for it are muted this long.
    no_officer_notice_mute_seconds: int = 900
    # A parking facility reads "partially available" once no more than this share of it is free.
    parking_partial_threshold: float = 0.5
    # A camera's parked-vehicle count must hold for this many consecutive reports before availability changes.
    occupancy_confirmations: int = 3

    # ---- Traffic-aware illegal-parking alerts (Parking Availability Bridge)
    # A traffic measurement older than this is "unknown" and parking alerts on that camera are held back.
    traffic_status_max_age_seconds: int = 120
    # Traffic levels that count as a jam: the only condition that holds a parking alert back.
    traffic_jam_levels: Annotated[list[str], NoDecode] = ["congested"]
    # A parked vehicle the bridge has not mentioned for this long is no longer observed (bridge stopped).
    parking_status_stale_seconds: int = 60

    # ---- Paid parking: eSewa and Khalti (secrets stay on the server, never in the apps)
    payments_enabled: bool = True
    # How long a space is held for a driver while they pay.
    booking_hold_minutes: int = 15
    booking_max_hours: int = 12
    # After this long a booked driver is assumed to be inside, where an AI camera already counts the car.
    booking_arrival_window_minutes: int = 20
    # Public base URL of this API that payment providers redirect the driver back to, e.g.
    # https://api.parkmandu.gov.np/api/v1. Empty: taken from the request (fine for local development).
    payment_callback_base_url: str | None = None
    # Where drivers may be sent after paying: web origins and mobile app URL schemes.
    payment_return_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000"]
    payment_return_schemes: Annotated[list[str], NoDecode] = ["parkmandu", "exp", "exps"]
    web_app_url: str = "http://localhost:3000"

    esewa_environment: Literal["sandbox", "production"] = "sandbox"
    esewa_product_code: str | None = None
    esewa_secret_key: str | None = None
    esewa_form_url: str | None = None  # override; defaults depend on esewa_environment
    esewa_status_url: str | None = None

    khalti_environment: Literal["sandbox", "production"] = "sandbox"
    khalti_secret_key: str | None = None
    khalti_base_url: str | None = None  # override; defaults depend on khalti_environment

    payment_http_timeout_seconds: float = 15.0

    # ---- In-app navigation: road routing (OSRM-compatible service)
    routing_base_url: str = "https://router.project-osrm.org"
    routing_profile: str = "driving"
    routing_timeout_seconds: float = 8.0

    @field_validator("cors_origins", "traffic_jam_levels", "payment_return_origins", "payment_return_schemes", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("payment_callback_base_url", "esewa_product_code", "esewa_secret_key", "khalti_secret_key", mode="before")
    @classmethod
    def _empty_is_none(cls, value: object) -> object:
        return value or None

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

    @property
    def esewa_enabled(self) -> bool:
        return self.payments_enabled and bool(self.esewa_product_code and self.esewa_secret_key)

    @property
    def khalti_enabled(self) -> bool:
        return self.payments_enabled and bool(self.khalti_secret_key)


# Default position for cameras that register without coordinates (Ratna Park, Kathmandu).
KATHMANDU_CENTER = (27.7056, 85.3206)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
