"""Main synchronization coordinator linking Panopto, SQLite state, and Cortex."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional
from filelock import FileLock, Timeout

from .auth import AuthCircuitBreakerError, AuthError, AuthSessionManager
from .config import Config
from .cortex import CortexClient, CortexPermanentError, CortexTransientError
from .panopto import PanoptoClient
from .spool import RetrySpool
from .state import StateDatabase

logger = logging.getLogger("custom_panopto.sync")


@dataclass
class SyncSummary:
    courses_scanned: int = 0
    sessions_discovered: int = 0
    pending_transcripts: int = 0
    ingested_new: int = 0
    unchanged: int = 0
    spool_retries_succeeded: int = 0
    errors: int = 0
    duration_seconds: float = 0.0


class SyncCoordinator:
    """Executes single scheduled synchronization run with exclusive file locking."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self.config.ensure_directories()
        self.state_db = StateDatabase(self.config.state_db)
        self.spool = RetrySpool(self.config.spool_dir)

    async def run(
        self,
        cortex_client: Optional[CortexClient] = None,
        panopto_client: Optional[PanoptoClient] = None,
        force_recheck: bool = False,
    ) -> SyncSummary:
        """Run a single end-to-end sync cycle."""
        start_time = time.monotonic()
        summary = SyncSummary()

        # Check circuit breaker before doing anything
        if self.config.is_auth_locked():
            logger.error("Sync aborted: Auth circuit breaker is active (%s)", self.config.circuit_breaker_file)
            summary.errors += 1
            return summary

        # 1. Acquire exclusive lock to prevent overlapping runs
        lock = FileLock(str(self.config.lock_file), timeout=0)
        try:
            lock.acquire()
        except Timeout:
            logger.info("Another sync process is currently running. Exiting cleanly.")
            return summary

        try:
            # 2. Determine Course Mappings (Cortex manifest or MONITORED_FOLDERS fallback)
            from .cortex import CourseMapping
            course_mappings: list[CourseMapping] = []

            has_cortex = bool(cortex_client is not None or (self.config.cortex_base_url and self.config.cortex_connector_token))
            if has_cortex:
                if cortex_client is None:
                    cortex_client = CortexClient(
                        base_url=self.config.cortex_base_url,
                        connector_token=self.config.cortex_connector_token,
                    )

                # Retry existing payloads in the spool
                spool_succ, spool_perm, spool_trans = await self.spool.retry_all(cortex_client, self.state_db)
                summary.spool_retries_succeeded += spool_succ
                if spool_perm > 0 or spool_trans > 0:
                    summary.errors += (spool_perm + spool_trans)

                logger.info("Fetching course manifest from Cortex...")
                try:
                    manifest = await cortex_client.get_manifest()
                    course_mappings = manifest.courses
                except Exception as e:
                    logger.warning("Could not fetch manifest from Cortex: %s", e)

            # If Cortex returned no courses or is not yet configured, use MONITORED_FOLDERS
            if not course_mappings:
                local_entries = self.config.get_monitored_mappings()
                if local_entries:
                    course_mappings = [CourseMapping(course_id=cid, panopto_folder_id=fid) for cid, fid in local_entries]
                    logger.info("Using %d configured local monitored folder(s)", len(course_mappings))

            summary.courses_scanned = len(course_mappings)
            if not course_mappings:
                logger.info("No courses to monitor (Cortex manifest empty and MONITORED_FOLDERS not set). Exiting.")
                return summary


            # 5. Acquire Panopto authenticated cookies
            if panopto_client is None:
                auth_mgr = AuthSessionManager(self.config, self.state_db)
                try:
                    cookies = await auth_mgr.get_authenticated_cookies()
                except (AuthError, AuthCircuitBreakerError) as ae:
                    logger.error("Authentication failure: %s", ae)
                    summary.errors += 1
                    return summary

                panopto_client = PanoptoClient(
                    base_url=self.config.panopto_base_url,
                    cookies=cookies,
                )

            # 6. Synchronize each mapped course
            for course in course_mappings:
                logger.info("Scanning course=%s folder=%s", course.course_id, course.panopto_folder_id)
                try:
                    sessions = await panopto_client.list_folder_sessions(course.panopto_folder_id)
                except Exception as ex:
                    logger.error("Error listing sessions for folder %s: %s", course.panopto_folder_id, ex)
                    summary.errors += 1
                    continue

                for session in sessions:
                    summary.sessions_discovered += 1
                    self.state_db.record_discovered(
                        provider_session_id=session.session_id,
                        course_id=course.course_id,
                        provider_folder_id=course.panopto_folder_id,
                        title=session.title,
                        recorded_at=session.recorded_at,
                        duration_seconds=session.duration_seconds,
                    )

                    # Check if already ingested (unless forced recheck)
                    if not force_recheck and self.state_db.is_already_ingested(session.session_id):
                        summary.unchanged += 1
                        continue

                    # If already buffered in retry spool awaiting Cortex, skip re-downloading
                    if not force_recheck and self.spool.has_session(session.session_id):
                        logger.debug("Session %s is already buffered in retry spool. Skipping.", session.session_id)
                        summary.unchanged += 1
                        continue

                    # Fetch transcript
                    transcript = await panopto_client.get_transcript(session.session_id)
                    if transcript is None:
                        logger.info("Session %s (%s) has no ready transcript. Marking pending.", session.session_id, session.title)
                        self.state_db.mark_pending(session.session_id, "TRANSCRIPT_NOT_READY")
                        summary.pending_transcripts += 1
                        continue

                    # If already ingested with same content hash, mark unchanged
                    if self.state_db.is_already_ingested(session.session_id, transcript.content_hash):
                        logger.debug("Session %s transcript hash matches existing state. Skipping.", session.session_id)
                        summary.unchanged += 1
                        continue

                    # Compute lowercase SHA-256 of exact UTF-8 content bytes (Cortex contract)
                    import hashlib
                    from datetime import datetime, timezone
                    exact_hash = hashlib.sha256(transcript.content.encode("utf-8")).hexdigest().lower()
                    recorded_at = session.recorded_at or datetime.now(timezone.utc).isoformat()
                    duration_secs = max(1, min(86400, session.duration_seconds or 3600))
                    safe_url = session.viewer_url or f"https://ncsu.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id={session.session_id}"

                    # Build ingest payload
                    payload = {
                        "provider": "panopto",
                        "courseId": course.course_id,
                        "providerFolderId": course.panopto_folder_id,
                        "providerSessionId": session.session_id,
                        "title": session.title[:500],
                        "recordedAt": recorded_at,
                        "durationSeconds": duration_secs,
                        "providerUrl": safe_url,
                        "transcript": {
                            "format": transcript.format,
                            "language": "en",
                            "contentHash": exact_hash,
                            "content": transcript.content,
                        },
                    }

                    # Push to Cortex if configured, otherwise record locally
                    if cortex_client is not None:
                        try:
                            res = await cortex_client.ingest_lecture(payload)
                            status_res = res.get("status", "ok")
                            logger.info("Successfully ingested session %s into Cortex (result: %s)", session.session_id, status_res)
                            self.state_db.mark_ingested(session.session_id, exact_hash)
                            if status_res in ("created", "updated"):
                                summary.ingested_new += 1
                            else:
                                summary.unchanged += 1
                        except CortexTransientError as te:
                            logger.warning("Transient failure pushing session %s to Cortex: %s. Spooling...", session.session_id, te)
                            self.spool.write_payload(session.session_id, exact_hash, payload)
                            self.state_db.mark_failed(session.session_id, "CORTEX_UNAVAILABLE")
                            summary.errors += 1
                        except CortexPermanentError as pe:
                            logger.error("Cortex permanently rejected session %s: %s", session.session_id, pe)
                            self.state_db.mark_failed(session.session_id, "CORTEX_REJECTED")
                            summary.errors += 1
                        except Exception as ex:
                            logger.error("Unexpected error ingesting session %s: %s. Spooling...", session.session_id, ex)
                            self.spool.write_payload(session.session_id, exact_hash, payload)
                            self.state_db.mark_failed(session.session_id, "UNKNOWN_INGEST_ERROR")
                            summary.errors += 1
                    else:
                        logger.info("Session %s (%s) transcript acquired locally (Cortex offline)", session.session_id, session.title)
                        self.state_db.mark_ingested(session.session_id, exact_hash)
                        summary.ingested_new += 1



        finally:
            try:
                lock.release()
            except Exception:
                pass

        summary.duration_seconds = round(time.monotonic() - start_time, 2)
        logger.info(
            "Sync run completed in %.2fs: scanned=%d discovered=%d ingested=%d pending=%d unchanged=%d errors=%d",
            summary.duration_seconds,
            summary.courses_scanned,
            summary.sessions_discovered,
            summary.ingested_new,
            summary.pending_transcripts,
            summary.unchanged,
            summary.errors,
        )
        return summary
