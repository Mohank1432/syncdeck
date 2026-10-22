"""App configuration loaded from environment / .env file."""
from __future__ import annotations

import os
from pathlib import Path
from typing import List
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration and settings."""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # rclone RC
    rc_url: str = "http://127.0.0.1:5572"

    # Network
    bind: str = "0.0.0.0"
    port: int = 8768

    # Storage
    db_path: str = "./syncdeck.db"

    # Security
    allowed_roots: str = "/mnt"  # comma-separated paths; validated server-side for every local operation

    # Internal
    secret_words: tuple = ("token", "password", "secret", "key", "client_secret", "pass")

    @property
    def allowed_root_list(self) -> List[str]:
        """Return allowed roots as a trimmed list of path strings."""
        return [p.strip() for p in self.allowed_roots.split(",") if p.strip()]


settings = Settings()
