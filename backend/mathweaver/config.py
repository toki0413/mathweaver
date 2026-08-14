"""Configuration management for MathWeaver.

Reads from environment variables and/or a .env file.
Provides a single ``get_config()`` entry point used by the API
and the Orchestrator to wire up the real LLM client.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

LOG = __name__


def _load_dotenv() -> None:
    """Load a .env file from several candidate locations."""
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parent.parent.parent / ".env",
        Path.home() / ".mathweaver" / ".env",
    ]
    for env_path in candidates:
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val
            break


# Load once at import time
_load_dotenv()


@dataclass(frozen=True)
class LLMConfig:
    """LLM connection settings."""

    provider: str  # "mock" | "openai_compatible"
    api_key: str
    base_url: str
    model: str
    temperature: float


@dataclass(frozen=True)
class AppConfig:
    """Top-level application configuration."""

    llm: LLMConfig
    db_path: str
    cors_origins: list[str]
    host: str
    port: int
    log_level: str


def _default_llm() -> LLMConfig:
    api_key = os.environ.get("MATHWEAVER_LLM_API_KEY", "")
    provider = os.environ.get("MATHWEAVER_LLM_PROVIDER", "mock")
    if api_key:
        provider = os.environ.get("MATHWEAVER_LLM_PROVIDER", "openai_compatible")
    return LLMConfig(
        provider=provider,
        api_key=api_key,
        # Neutral OpenAI-compatible defaults so users can bring any provider
        # (OpenAI, DeepSeek, GLM, Qwen, Ollama, ...) by overriding
        # MATHWEAVER_LLM_BASE_URL / MATHWEAVER_LLM_MODEL / MATHWEAVER_LLM_API_KEY.
        base_url=os.environ.get(
            "MATHWEAVER_LLM_BASE_URL",
            "https://api.openai.com/v1",
        ),
        model=os.environ.get("MATHWEAVER_LLM_MODEL", "gpt-4o-mini"),
        temperature=float(os.environ.get("MATHWEAVER_LLM_TEMPERATURE", "0.7")),
    )


def _default_app() -> AppConfig:
    cors_raw = os.environ.get("MATHWEAVER_CORS_ORIGINS", "*")
    cors_origins = [
        o.strip() for o in cors_raw.split(",") if o.strip()
    ]
    return AppConfig(
        llm=_default_llm(),
        db_path=os.environ.get("MATHWEAVER_DB_PATH", "mathweaver.db"),
        cors_origins=cors_origins,
        host=os.environ.get("MATHWEAVER_HOST", "0.0.0.0"),
        port=int(os.environ.get("MATHWEAVER_PORT", "8000")),
        log_level=os.environ.get("MATHWEAVER_LOG_LEVEL", "INFO"),
    )


_cached: AppConfig | None = None


def get_config() -> AppConfig:
    """Return the singleton config (loaded once)."""
    global _cached
    if _cached is None:
        _cached = _default_app()
    return _cached


def create_llm_client(config: LLMConfig | None = None):
    """Create an LLM client based on configuration.

    Returns ``MockLLMClient`` when provider is ``"mock"`` or no API key
    is configured, and ``OpenAICompatibleClient`` otherwise.
    """
    from .llm.client import MockLLMClient, OpenAICompatibleClient

    cfg = config or get_config().llm
    if cfg.provider == "mock" or not cfg.api_key:
        return MockLLMClient()
    return OpenAICompatibleClient(
        api_key=cfg.api_key,
        base_url=cfg.base_url,
        model=cfg.model,
    )
