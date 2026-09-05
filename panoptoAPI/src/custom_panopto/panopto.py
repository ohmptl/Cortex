"""Panopto API web client for session discovery and caption retrieval."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional
import httpx

from .state import compute_content_hash, normalize_transcript

logger = logging.getLogger("custom_panopto.panopto")


def parse_panopto_date(raw: Any) -> Optional[str]:
    """Parse Panopto /Date(milliseconds)/ format into ISO 8601 with UTC offset."""
    if not raw:
        return None
    from datetime import datetime, timezone
    if isinstance(raw, str) and raw.startswith("/Date(") and raw.endswith(")/"):
        try:
            inner = raw[6:-2]
            for sep in ("+", "-"):
                if sep in inner:
                    inner = inner.split(sep)[0]
            ms = int(inner)
            return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()
        except Exception:
            pass
    if isinstance(raw, str):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return dt.isoformat()
        except Exception:
            pass
    return None


@dataclass
class PanoptoSessionItem:
    session_id: str
    folder_id: str
    title: str
    recorded_at: Optional[str] = None
    duration_seconds: Optional[int] = None
    viewer_url: Optional[str] = None
    last_modified: Optional[str] = None


@dataclass
class TranscriptResult:
    format: str  # "srt" or "webvtt"
    content: str
    content_hash: str
    language: str = "en"


class PanoptoClient:
    """Client for querying Panopto folder sessions and downloading timed transcripts using authenticated cookies."""

    def __init__(
        self,
        base_url: str,
        cookies: dict[str, str],
        timeout_seconds: float = 30.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.cookies = cookies
        self.timeout_seconds = timeout_seconds
        self._transport = transport

    def _headers(self, accept: str = "application/json") -> dict[str, str]:
        return {
            "Accept": accept,
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
        }

    async def list_folder_sessions(self, folder_id: str, page: int = 0) -> list[PanoptoSessionItem]:
        """Fetch sessions belonging to a specific Panopto folder."""
        service_url = f"{self.base_url}/Panopto/Services/Data.svc/GetSessions"
        payload = {
            "queryParameters": {
                "folderID": folder_id,
                "page": page,
                "sortColumn": 1,
            }
        }

        async with httpx.AsyncClient(
            transport=self._transport,
            cookies=self.cookies,
            timeout=self.timeout_seconds,
            verify=True,
        ) as client:
            try:
                response = await client.post(
                    service_url,
                    json=payload,
                    headers=self._headers("application/json"),
                )
                if response.status_code == 200:
                    data = response.json()
                    results = data.get("d", {}).get("Results", [])
                    sessions: list[PanoptoSessionItem] = []
                    for item in results:
                        s_id = item.get("DeliveryID") or item.get("PublicID")
                        if not s_id:
                            continue
                        name = item.get("SessionName") or "Untitled Lecture"
                        raw_dur = item.get("Duration")
                        duration = max(1, min(86400, int(round(float(raw_dur))))) if raw_dur is not None else 3600
                        raw_start = item.get("StartTime") or item.get("Date")
                        recorded_at = parse_panopto_date(raw_start)
                        viewer_url = f"{self.base_url}/Panopto/Pages/Viewer.aspx?id={s_id}"

                        sessions.append(PanoptoSessionItem(
                            session_id=s_id,
                            folder_id=folder_id,
                            title=name,
                            recorded_at=recorded_at,
                            duration_seconds=duration,
                            viewer_url=viewer_url,
                        ))
                    return sessions
            except Exception as e:
                logger.debug("GetSessions failed: %s. Falling back to REST API.", e)


            # 2. Fallback: REST API
            rest_url = f"{self.base_url}/Panopto/api/v1/folders/{folder_id}/sessions"
            params = {"pageNumber": page, "sortField": "CreatedDate", "sortOrder": "Desc"}
            response = await client.get(rest_url, params=params, headers=self._headers())

            if response.status_code in (401, 403):
                raise PermissionError(f"Panopto session expired or access denied (HTTP {response.status_code})")

            if response.status_code != 200:
                logger.warning("Panopto returned HTTP %d for folder %s", response.status_code, folder_id)
                return []

            data = response.json()
            results = data.get("Results", [])
            sessions = []
            for item in results:
                s_id = item.get("Id")
                if not s_id:
                    continue
                sessions.append(PanoptoSessionItem(
                    session_id=s_id,
                    folder_id=folder_id,
                    title=item.get("Name") or "Untitled Lecture",
                    recorded_at=item.get("StartTime"),
                    duration_seconds=int(item.get("Duration", 0)) if item.get("Duration") is not None else None,
                    viewer_url=item.get("Urls", {}).get("ViewerUrl") if isinstance(item.get("Urls"), dict) else None,
                ))
            return sessions

    async def get_transcript(self, session_id: str) -> Optional[TranscriptResult]:
        """Attempt to retrieve captions/transcript for a session.
        
        Tries:
        1. Live SRT generator endpoint (/Panopto/Pages/Transcription/GenerateSRT.ashx?id={id}&language=English_USA)
        2. Official REST captions endpoint (/Panopto/api/v1/sessions/{id}/captions)
        
        Returns None if transcript is not yet available or empty.
        """
        async with httpx.AsyncClient(
            transport=self._transport,
            cookies=self.cookies,
            timeout=self.timeout_seconds,
            verify=True,
        ) as client:
            # 1. Primary: SRT generator endpoint
            srt_url = f"{self.base_url}/Panopto/Pages/Transcription/GenerateSRT.ashx"
            try:
                res = await client.get(
                    srt_url,
                    params={"id": session_id, "language": "English_USA"},
                    headers=self._headers("application/x-subrip, text/plain"),
                )
                if res.status_code == 200 and res.text.strip():
                    text = res.text.strip()
                    if not text.startswith("<!DOCTYPE") and not text.startswith("<html"):
                        normalized = normalize_transcript(text)
                        if normalized:
                            return TranscriptResult(
                                format="srt",
                                content=normalized,
                                content_hash=compute_content_hash(normalized),
                            )
            except Exception as e:
                logger.debug("SRT generator failed for %s: %s", session_id, e)

            # 2. Fallback: official REST captions endpoint
            captions_url = f"{self.base_url}/Panopto/api/v1/sessions/{session_id}/captions"
            try:
                res = await client.get(
                    captions_url,
                    headers=self._headers("text/vtt, application/x-subrip, text/plain"),
                )
                if res.status_code == 200 and res.text.strip():
                    text = res.text.strip()
                    content_type = res.headers.get("content-type", "").lower()
                    fmt = "webvtt" if "vtt" in content_type or text.startswith("WEBVTT") else "srt"
                    normalized = normalize_transcript(text)
                    if normalized:
                        return TranscriptResult(
                            format=fmt,
                            content=normalized,
                            content_hash=compute_content_hash(normalized),
                        )
            except Exception as e:
                logger.debug("REST captions endpoint failed for %s: %s", session_id, e)

        return None

