from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_DB = _API_DIR / "wa_crm.db"
_JWT_SECRET_FILE = _API_DIR / ".local" / "jwt_secret"
_WA_CONNECTOR_KEY_FILE = _API_DIR / ".local" / "wa_connector_key"
_DIVAR_CONNECTOR_KEY_FILE = _API_DIR / ".local" / "divar_connector_key"
_BALE_CONNECTOR_KEY_FILE = _API_DIR / ".local" / "bale_connector_key"
_INSTAGRAM_CONNECTOR_KEY_FILE = _API_DIR / ".local" / "instagram_connector_key"
_WA_CREDS_KEY_FILE = _API_DIR / ".local" / "wa_creds_fernet_key"


def _default_database_url() -> str:
    """Stable SQLite path — same DB regardless of process working directory."""
    return f"sqlite+pysqlite:///{_DEFAULT_DB.resolve().as_posix()}"


def _load_or_create_secret_file(path: Path, fallback: str, *, min_len: int = 8) -> str:
    """Persist a secret on disk so values survive API restarts."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.is_file():
            secret = path.read_text(encoding="utf-8").strip()
            if len(secret) >= min_len:
                return secret
        path.write_text(fallback, encoding="utf-8")
        return fallback
    except OSError:
        return fallback


def _load_or_create_jwt_secret() -> str:
    """Persist JWT secret on disk so tokens survive API restarts."""
    return _load_or_create_secret_file(_JWT_SECRET_FILE, "dev-change-me")


def _load_or_create_wa_connector_key() -> str:
    return _load_or_create_secret_file(
        _WA_CONNECTOR_KEY_FILE, "dev-wa-connector-key-change-me", min_len=16
    )


def _load_or_create_divar_connector_key() -> str:
    return _load_or_create_secret_file(
        _DIVAR_CONNECTOR_KEY_FILE, "dev-divar-connector-key-change-me", min_len=16
    )


def _load_or_create_bale_connector_key() -> str:
    return _load_or_create_secret_file(
        _BALE_CONNECTOR_KEY_FILE, "dev-bale-connector-key-change-me", min_len=16
    )


def _load_or_create_instagram_connector_key() -> str:
    return _load_or_create_secret_file(
        _INSTAGRAM_CONNECTOR_KEY_FILE,
        "dev-instagram-connector-key-change-me",
        min_len=16,
    )


def _load_or_create_wa_creds_key() -> str:
    """Fernet key (url-safe base64, 32 bytes). Generated once and persisted."""
    try:
        from cryptography.fernet import Fernet

        if _WA_CREDS_KEY_FILE.is_file():
            secret = _WA_CREDS_KEY_FILE.read_text(encoding="utf-8").strip()
            if len(secret) >= 32:
                return secret
        key = Fernet.generate_key().decode("ascii")
        _WA_CREDS_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
        _WA_CREDS_KEY_FILE.write_text(key, encoding="utf-8")
        return key
    except OSError:
        from cryptography.fernet import Fernet

        return Fernet.generate_key().decode("ascii")


class Settings(BaseSettings):
    """App settings — values come only from this file (no .env / OS env override)."""

    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "development"
    database_url: str = _default_database_url()
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = _load_or_create_jwt_secret()
    jwt_access_minutes: int = 60 * 24 * 7  # web CRM — 7 days
    jwt_refresh_days: int = 90
    # Shared secret for platform/wa-connector → /internal/wa/*
    wa_connector_key: str = _load_or_create_wa_connector_key()
    # Shared secret for platform/divar-connector → /internal/divar/*
    divar_connector_key: str = _load_or_create_divar_connector_key()
    # Shared secret for platform/bale-connector → /internal/bale/*
    bale_connector_key: str = _load_or_create_bale_connector_key()
    # Shared secret for platform/instagram-connector → /internal/instagram/*
    instagram_connector_key: str = _load_or_create_instagram_connector_key()
    # Fernet key for encrypting channel auth state at rest
    wa_creds_fernet_key: str = _load_or_create_wa_creds_key()
    # Platform owner phone (must match OTP login for /super)
    super_admin_phone: str = "09120674032"
    embedding_dim: int = 384
    # Pinecone serverless + hosted multilingual-e5 (RAG knowledge base)
    pinecone_api_key: str = ""
    pinecone_index: str = "iranexpedia-kb"
    pinecone_cloud: str = "aws"
    pinecone_region: str = "us-east-1"
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
