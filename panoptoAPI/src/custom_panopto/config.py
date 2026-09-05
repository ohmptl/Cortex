"""Configuration management for Custom Panopto API."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field


def _resolve_default_path(linux_path: str, local_fallback: str) -> Path:
    """Choose system directory if writable/root or running on Linux, otherwise fallback to local."""
    target = Path(linux_path)
    try:
        # Check if parent or directory is writable
        parent = target.parent
        if parent.exists() and os.access(parent, os.W_OK):
            return target
        if target.exists() and os.access(target, os.W_OK):
            return target
    except Exception:
        pass
    
    # Fallback for dev / Windows / non-root environment
    fallback = Path.cwd() / "data" / local_fallback
    return fallback


class Config(BaseModel):
    # NC State Shibboleth Credentials
    ncsu_username: str = Field(default_factory=lambda: os.getenv("NCSU_USERNAME", ""))
    ncsu_password: str = Field(default_factory=lambda: os.getenv("NCSU_PASSWORD", ""))

    # Panopto Base URL
    panopto_base_url: str = Field(
        default_factory=lambda: os.getenv("PANOPTO_BASE_URL", "https://ncsu.hosted.panopto.com").rstrip("/")
    )

    # Cortex API configuration
    cortex_base_url: str = Field(
        default_factory=lambda: os.getenv("CORTEX_BASE_URL", "").rstrip("/")
    )
    cortex_connector_token: str = Field(
        default_factory=lambda: os.getenv("CORTEX_CONNECTOR_TOKEN", "")
    )

    # Browser automation settings
    browser_mode: str = Field(default_factory=lambda: os.getenv("BROWSER_MODE", "headless"))
    browser_profile_dir: Path = Field(
        default_factory=lambda: Path(
            os.getenv("BROWSER_PROFILE_DIR", "") or _resolve_default_path("/var/lib/custom-panopto/browser", "browser")
        )
    )

    # Local operational storage & state
    state_db: Path = Field(
        default_factory=lambda: Path(
            os.getenv("STATE_DB", "") or _resolve_default_path("/var/lib/custom-panopto/state.db", "state.db")
        )
    )
    spool_dir: Path = Field(
        default_factory=lambda: Path(
            os.getenv("SPOOL_DIR", "") or _resolve_default_path("/var/lib/custom-panopto/spool", "spool")
        )
    )
    lock_file: Path = Field(
        default_factory=lambda: Path(
            os.getenv("LOCK_FILE", "") or _resolve_default_path("/var/lib/custom-panopto/sync.lock", "sync.lock")
        )
    )
    circuit_breaker_file: Path = Field(
        default_factory=lambda: Path(
            os.getenv("CIRCUIT_BREAKER_FILE", "") or _resolve_default_path("/var/lib/custom-panopto/.auth_locked", ".auth_locked")
        )
    )

    # Direct folder monitoring (fallback / offline when Cortex manifest not configured)
    monitored_folders: str = Field(
        default_factory=lambda: os.getenv("MONITORED_FOLDERS", "")
    )

    # Sync & Timeout parameters
    initial_sync_lookback_days: int = Field(
        default_factory=lambda: int(os.getenv("INITIAL_SYNC_LOOKBACK_DAYS", "120"))
    )

    duo_timeout_seconds: int = Field(
        default_factory=lambda: int(os.getenv("DUO_TIMEOUT_SECONDS", "25"))
    )
    max_auth_attempts: int = Field(
        default_factory=lambda: int(os.getenv("MAX_AUTH_ATTEMPTS", "3"))
    )
    log_level: str = Field(
        default_factory=lambda: os.getenv("LOG_LEVEL", "INFO")
    )

    def ensure_directories(self) -> None:
        """Ensure runtime directories exist with appropriate permissions."""
        self.browser_profile_dir.mkdir(parents=True, exist_ok=True)
        self.state_db.parent.mkdir(parents=True, exist_ok=True)
        self.spool_dir.mkdir(parents=True, exist_ok=True)
        (self.spool_dir / ".dead-letter").mkdir(parents=True, exist_ok=True)
        self.lock_file.parent.mkdir(parents=True, exist_ok=True)
        self.circuit_breaker_file.parent.mkdir(parents=True, exist_ok=True)

    def get_monitored_mappings(self) -> list[tuple[str, str]]:
        """Parse MONITORED_FOLDERS into a list of (course_id/name, folder_id) tuples."""
        if not self.monitored_folders:
            return []
        items = []
        for entry in self.monitored_folders.split(","):
            entry = entry.strip()
            if not entry:
                continue
            if "=" in entry:
                cid, fid = entry.split("=", 1)
                items.append((cid.strip(), fid.strip()))
            elif ":" in entry:
                cid, fid = entry.split(":", 1)
                items.append((cid.strip(), fid.strip()))
            else:
                items.append((entry, entry))
        return items

    def is_auth_locked(self) -> bool:

        """Check if emergency circuit breaker is active."""
        return self.circuit_breaker_file.exists()

    def set_auth_locked(self, reason: str = "3 consecutive failed authentication attempts") -> None:
        """Engage the emergency circuit breaker to prevent NC State account lockout."""
        self.circuit_breaker_file.parent.mkdir(parents=True, exist_ok=True)
        self.circuit_breaker_file.write_text(reason, encoding="utf-8")

    def clear_auth_locked(self) -> None:
        """Clear the circuit breaker after credentials or issues have been resolved."""
        if self.circuit_breaker_file.exists():
            self.circuit_breaker_file.unlink()

    def safe_dict(self) -> dict[str, str]:
        """Return safe configuration representation without secrets."""
        return {
            "panopto_base_url": self.panopto_base_url,
            "cortex_base_url": self.cortex_base_url or "(not set)",
            "cortex_connector_token": "***" if self.cortex_connector_token else "(not set)",
            "ncsu_username": self.ncsu_username or "(not set)",
            "ncsu_password": "***" if self.ncsu_password else "(not set)",
            "browser_mode": self.browser_mode,
            "browser_profile_dir": str(self.browser_profile_dir),
            "state_db": str(self.state_db),
            "spool_dir": str(self.spool_dir),
            "lock_file": str(self.lock_file),
            "circuit_breaker_file": str(self.circuit_breaker_file),
            "circuit_breaker_active": str(self.is_auth_locked()),
            "initial_sync_lookback_days": str(self.initial_sync_lookback_days),
            "duo_timeout_seconds": str(self.duo_timeout_seconds),
            "max_auth_attempts": str(self.max_auth_attempts),
            "log_level": self.log_level,
        }


def load_env_file(path: Optional[Path] = None) -> None:
    """Optionally load key=value environment file if exists."""
    candidates = [
        path,
        Path("/etc/custom-panopto/env"),
        Path.cwd() / ".env",
    ]
    for candidate in candidates:
        if candidate and candidate.exists():
            try:
                for line in candidate.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
                break
            except Exception:
                pass


def get_config(env_file: Optional[Path] = None) -> Config:
    """Load and return Config instance."""
    load_env_file(env_file)
    cfg = Config()
    return cfg
