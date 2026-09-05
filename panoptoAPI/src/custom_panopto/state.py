"""Local operational SQLite state and content hashing."""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


def normalize_transcript(content: str) -> str:
    """Normalize caption/transcript content for consistent, deterministic hashing.
    
    - Strips UTF-8 Byte Order Mark (BOM)
    - Normalizes CRLF and CR line endings to LF (\n)
    - Strips trailing whitespace per line
    - Strips trailing empty lines
    """
    if not content:
        return ""
    # Strip BOM
    if content.startswith("\ufeff"):
        content = content[1:]
    
    # Normalize line endings
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    
    # Normalize lines
    lines = [line.rstrip() for line in content.split("\n")]
    
    # Strip trailing empty lines
    while lines and not lines[-1]:
        lines.pop()
        
    return "\n".join(lines)


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hex digest of normalized transcript content."""
    normalized = normalize_transcript(content)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class StateDatabase:
    """Operational SQLite database for tracking sync status and avoiding duplicate downloads."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        # Enable Write-Ahead Logging for better durability and concurrency
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        return conn

    def _init_db(self) -> None:
        """Create database tables and indices if not already present."""
        with self._get_connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    provider_session_id TEXT PRIMARY KEY,
                    course_id TEXT NOT NULL,
                    provider_folder_id TEXT NOT NULL,
                    title TEXT,
                    recorded_at TEXT,
                    duration_seconds INTEGER,
                    status TEXT NOT NULL, -- DISCOVERED, PENDING_TRANSCRIPT, INGESTED, FAILED_TEMPORARY
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    last_attempt_at TEXT,
                    last_success_at TEXT,
                    transcript_hash TEXT,
                    error_count INTEGER DEFAULT 0,
                    last_error_code TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_sessions_course 
                    ON sessions(course_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_status 
                    ON sessions(status);

                CREATE TABLE IF NOT EXISTS auth_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    consecutive_failures INTEGER DEFAULT 0,
                    last_failure_at TEXT,
                    last_error TEXT
                );

                INSERT OR IGNORE INTO auth_state (id, consecutive_failures) 
                VALUES (1, 0);
            """)

    def get_session(self, provider_session_id: str) -> Optional[dict[str, Any]]:
        """Retrieve recorded session state by provider session ID."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE provider_session_id = ?",
                (provider_session_id,),
            ).fetchone()
            return dict(row) if row else None

    def is_already_ingested(self, provider_session_id: str, transcript_hash: Optional[str] = None) -> bool:
        """Check whether session has already been successfully ingested with the same hash."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT status, transcript_hash FROM sessions WHERE provider_session_id = ?",
                (provider_session_id,),
            ).fetchone()
            if not row or row["status"] != "INGESTED":
                return False
            if transcript_hash is not None and row["transcript_hash"] != transcript_hash:
                return False
            return True

    def record_discovered(
        self,
        provider_session_id: str,
        course_id: str,
        provider_folder_id: str,
        title: str,
        recorded_at: Optional[str] = None,
        duration_seconds: Optional[int] = None,
    ) -> None:
        """Record or update discovery of a session."""
        now = utc_now_iso()
        with self._get_connection() as conn:
            conn.execute("""
                INSERT INTO sessions (
                    provider_session_id, course_id, provider_folder_id,
                    title, recorded_at, duration_seconds, status,
                    first_seen_at, last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'DISCOVERED', ?, ?)
                ON CONFLICT(provider_session_id) DO UPDATE SET
                    course_id = excluded.course_id,
                    provider_folder_id = excluded.provider_folder_id,
                    title = excluded.title,
                    recorded_at = COALESCE(excluded.recorded_at, sessions.recorded_at),
                    duration_seconds = COALESCE(excluded.duration_seconds, sessions.duration_seconds),
                    last_seen_at = excluded.last_seen_at
            """, (
                provider_session_id,
                course_id,
                provider_folder_id,
                title,
                recorded_at,
                duration_seconds,
                now,
                now,
            ))

    def mark_pending(self, provider_session_id: str, reason: str = "TRANSCRIPT_NOT_READY") -> None:
        """Mark session as pending transcript availability."""
        now = utc_now_iso()
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE sessions
                SET status = 'PENDING_TRANSCRIPT',
                    last_attempt_at = ?,
                    last_error_code = ?
                WHERE provider_session_id = ?
            """, (now, reason, provider_session_id))

    def mark_ingested(self, provider_session_id: str, transcript_hash: str) -> None:
        """Mark session as successfully ingested into Cortex."""
        now = utc_now_iso()
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE sessions
                SET status = 'INGESTED',
                    transcript_hash = ?,
                    last_success_at = ?,
                    last_attempt_at = ?,
                    error_count = 0,
                    last_error_code = NULL
                WHERE provider_session_id = ?
            """, (transcript_hash, now, now, provider_session_id))

    def mark_failed(self, provider_session_id: str, error_code: str) -> None:
        """Record a temporary or permanent failure for a session."""
        now = utc_now_iso()
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE sessions
                SET status = 'FAILED_TEMPORARY',
                    last_attempt_at = ?,
                    error_count = error_count + 1,
                    last_error_code = ?
                WHERE provider_session_id = ?
            """, (now, error_code, provider_session_id))

    def get_auth_failures(self) -> int:
        """Get the consecutive authentication failure count."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT consecutive_failures FROM auth_state WHERE id = 1").fetchone()
            return int(row["consecutive_failures"]) if row else 0

    def record_auth_failure(self, error_msg: str) -> int:
        """Increment auth failure count and return the new total."""
        now = utc_now_iso()
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE auth_state
                SET consecutive_failures = consecutive_failures + 1,
                    last_failure_at = ?,
                    last_error = ?
                WHERE id = 1
            """, (now, error_msg))
            row = conn.execute("SELECT consecutive_failures FROM auth_state WHERE id = 1").fetchone()
            return int(row["consecutive_failures"]) if row else 1

    def reset_auth_failures(self) -> None:
        """Reset auth failure count upon successful authentication."""
        with self._get_connection() as conn:
            conn.execute("""
                UPDATE auth_state
                SET consecutive_failures = 0,
                    last_error = NULL
                WHERE id = 1
            """)

    def count_by_status(self) -> dict[str, int]:
        """Return counts of sessions grouped by status."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT status, COUNT(*) as cnt FROM sessions GROUP BY status"
            ).fetchall()
            return {row["status"]: row["cnt"] for row in rows}
