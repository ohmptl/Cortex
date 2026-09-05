"""Durable retry spool and dead-letter queue for Cortex ingestion."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .cortex import CortexClient
    from .state import StateDatabase

logger = logging.getLogger("custom_panopto.spool")


class RetrySpool:
    """Manages locally buffered ingestion payloads awaiting Cortex delivery."""

    def __init__(self, spool_dir: Path) -> None:
        self.spool_dir = Path(spool_dir)
        self.dead_letter_dir = self.spool_dir / ".dead-letter"
        self.spool_dir.mkdir(parents=True, exist_ok=True)
        self.dead_letter_dir.mkdir(parents=True, exist_ok=True)

    def write_payload(self, session_id: str, content_hash: str, payload: dict[str, Any]) -> Path:
        """Save an ingestion payload to the spool directory."""
        # Sanitize filename
        safe_hash = content_hash[:16]
        filename = f"{session_id}_{safe_hash}.json"
        target = self.spool_dir / filename
        
        # Write atomically via temp file
        temp_path = self.spool_dir / f".tmp_{filename}"
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(target)
        logger.warning("Spooling payload for session=%s to %s", session_id, target.name)
        return target

    def count(self) -> int:
        """Count active items in the retry spool."""
        return len([f for f in self.spool_dir.glob("*.json") if f.is_file()])

    def has_session(self, session_id: str) -> bool:
        """Check if a session is already buffered in the retry spool."""
        return any(f.name.startswith(f"{session_id}_") for f in self.spool_dir.glob("*.json") if f.is_file())

    async def retry_all(self, cortex_client: CortexClient, state_db: StateDatabase) -> tuple[int, int, int]:
        """Retry all spooled payloads against Cortex.
        
        Returns:
            (success_count, permanent_failure_count, transient_failure_count)
        """
        items = sorted([f for f in self.spool_dir.glob("*.json") if f.is_file()])
        if not items:
            return 0, 0, 0

        logger.info("Retrying %d spooled payloads against Cortex...", len(items))
        success_count = 0
        permanent_failures = 0
        transient_failures = 0

        for item in items:
            try:
                payload = json.loads(item.read_text(encoding="utf-8"))
            except Exception as e:
                logger.error("Corrupted spool file %s: %s. Moving to dead-letter.", item.name, e)
                item.replace(self.dead_letter_dir / item.name)
                permanent_failures += 1
                continue

            session_id = payload.get("providerSessionId", "")
            transcript_hash = payload.get("transcript", {}).get("contentHash", "")

            from .cortex import CortexPermanentError, CortexTransientError

            try:
                result = await cortex_client.ingest_lecture(payload)
                logger.info("Successfully delivered spooled session=%s status=%s", session_id, result.get("status"))
                if session_id and transcript_hash:
                    state_db.mark_ingested(session_id, transcript_hash)
                item.unlink(missing_ok=True)
                success_count += 1
            except CortexPermanentError as pe:
                logger.error("Permanent rejection for spooled session=%s (%s). Quarantining to dead-letter.", session_id, pe)
                item.replace(self.dead_letter_dir / item.name)
                if session_id:
                    state_db.mark_failed(session_id, "CORTEX_REJECTED")
                permanent_failures += 1
            except CortexTransientError as te:
                logger.warning("Transient error delivering spooled session=%s: %s. Retaining in spool.", session_id, te)
                transient_failures += 1
            except Exception as ex:
                logger.warning("Unexpected error delivering spooled session=%s: %s. Retaining in spool.", session_id, ex)
                transient_failures += 1

        return success_count, permanent_failures, transient_failures
