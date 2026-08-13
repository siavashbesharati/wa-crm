from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict


class Settings(BaseSettings):
    """App settings — values come only from this file (no .env / OS env override)."""

    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "development"
    database_url: str = "sqlite+pysqlite:///./wa_crm.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "dev-change-me"
    jwt_access_minutes: int = 60
    jwt_access_minutes_seat: int = 60 * 24 * 7  # extension seat JWT — 7 days
    jwt_refresh_days: int = 30
    # Platform owner phone (must match OTP login for /super)
    super_admin_phone: str = "09120674032"
    embedding_dim: int = 384
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    # Gemini defaults (platform key/model preferably set in super-admin UI)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"
    cors_origins: str = "http://localhost:3000,http://127.6.4.1:3000"
    # Payments: mock | zibal
    payment_provider: str = "zibal"
    zibal_merchant_id: str = "zibal"
    public_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"
    # sms.ir verify OTP
    sms_ir_api_key: str = "pkHIVpf02aAHthp4eP3DYGdWtw5bc6tL4C9EcvXbjisVPo8g"
    sms_ir_template_id: int = 846743
    sms_ir_otp_param: str = "OTP"
    # Optional HTTPS proxy for sms.ir (e.g. http://127.6.4.1:10809) when VPN blocks Iranian APIs
    sms_ir_https_proxy: str = ""
    # If True and sms.ir is unreachable, log OTP to API console (local only)
    sms_ir_dev_fallback: bool = True

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # Ignore OS env and .env — only class defaults / explicit init
        return (init_settings,)

    @field_validator("sms_ir_template_id", mode="before")
    @classmethod
    def _empty_template_id(cls, v):
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return 846743
        return v

    @field_validator("sms_ir_otp_param", mode="before")
    @classmethod
    def _empty_otp_param(cls, v):
        if v is None or (isinstance(v, str) and not str(v).strip()):
            return "OTP"
        return str(v).strip()

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
