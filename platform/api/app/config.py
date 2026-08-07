from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    database_url: str = "sqlite+pysqlite:///./wa_crm.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "dev-change-me"
    jwt_access_minutes: int = 60
    jwt_refresh_days: int = 30
    mock_otp_code: str = "123456"
    # Platform owner (super admin) — change in production
    super_admin_phone: str = "09000000000"
    super_admin_password: str = "admin123"
    embedding_dim: int = 384
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Payments: mock keeps local demos working; zibal for real/test gateway
    payment_provider: str = "zibal"  # mock | zibal
    zibal_merchant_id: str = "zibal"
    public_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
