"""Cortex HTTP integration client and data contracts."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Optional
import httpx

logger = logging.getLogger("custom_panopto.cortex")


class CortexError(Exception):
    """Base exception for Cortex API errors."""


class CortexTransientError(CortexError):
    """Temporary failure (e.g. network timeout, 429, 502, 503, 504). Safe to retry."""


class CortexPermanentError(CortexError):
    """Permanent client rejection (e.g. 400 Bad Request, 401 Unauthorized, 422)."""


class CortexEndpointUnavailableError(CortexError):
    """Raised when Cortex connector endpoint is not yet deployed (e.g. 307 redirect to /login or 404)."""



@dataclass
class CourseMapping:
    course_id: str
    panopto_folder_id: str
    sync_since: Optional[str] = None


@dataclass
class CortexManifest:
    courses: list[CourseMapping] = field(default_factory=list)


class CortexClient:
    """HTTP client communicating with Cortex for manifest discovery and transcript ingestion."""

    def __init__(
        self,
        base_url: str,
        connector_token: str,
        timeout_seconds: float = 30.0,
        max_retries: int = 3,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.connector_token = connector_token
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "CustomPanoptoSync/0.1.0",
        }
        if self.connector_token:
            headers["Authorization"] = f"Bearer {self.connector_token}"
        return headers

    async def _request(self, method: str, path: str, json_data: Optional[dict[str, Any]] = None) -> httpx.Response:
        """Execute HTTP request with bounded exponential backoff for transient errors."""
        url = f"{self.base_url}{path}"
        headers = self._headers()
        
        attempt = 0
        backoff = 1.0

        while True:
            attempt += 1
            try:
                async with httpx.AsyncClient(
                    transport=self._transport,
                    timeout=self.timeout_seconds,
                    verify=True,
                ) as client:
                    response = await client.request(
                        method=method,
                        url=url,
                        headers=headers,
                        json=json_data,
                    )

                if response.status_code in (200, 201, 204):
                    return response

                if response.status_code in (301, 302, 307, 308):
                    raise CortexEndpointUnavailableError(
                        f"Cortex connector endpoint is not available yet (HTTP {response.status_code})"
                    )

                if response.status_code in (429, 500, 502, 503, 504):

                    msg = f"Cortex server error HTTP {response.status_code}: {response.text[:200]}"
                    if attempt < self.max_retries:
                        logger.warning("%s (attempt %d/%d). Retrying in %.1fs...", msg, attempt, self.max_retries, backoff)
                        await asyncio.sleep(backoff)
                        backoff *= 2.0
                        continue
                    raise CortexTransientError(msg)

                # Permanent 4xx client errors
                raise CortexPermanentError(
                    f"Cortex rejected request with HTTP {response.status_code}: {response.text[:200]}"
                )

            except (httpx.ConnectError, httpx.ReadTimeout, httpx.WriteTimeout, httpx.NetworkError) as ex:
                if attempt < self.max_retries:
                    logger.warning("Network error reaching Cortex (%s). Retrying in %.1fs...", ex, backoff)
                    await asyncio.sleep(backoff)
                    backoff *= 2.0
                    continue
                raise CortexTransientError(f"Unable to connect to Cortex at {self.base_url}: {ex}") from ex

    async def get_manifest(self) -> CortexManifest:
        """Fetch the list of courses and their mapped Panopto folder IDs from Cortex."""
        response = await self._request("GET", "/api/connectors/panopto/manifest")
        data = response.json()
        
        mappings: list[CourseMapping] = []
        raw_courses = data.get("courses", [])

        for c in raw_courses:
            course_id = c.get("courseId") or c.get("id", "")
            sync_since = c.get("syncSince")

            # Support 1:1 simplified format: panoptoFolderId
            folder_id = c.get("panoptoFolderId") or c.get("folderId")
            
            # Support legacy format: folders: [ { providerFolderId: "..." } ]
            if not folder_id and "folders" in c and isinstance(c["folders"], list) and len(c["folders"]) > 0:
                folder_id = c["folders"][0].get("providerFolderId") or c["folders"][0].get("id")

            if course_id and folder_id:
                mappings.append(CourseMapping(
                    course_id=str(course_id),
                    panopto_folder_id=str(folder_id),
                    sync_since=str(sync_since) if sync_since else None,
                ))

        return CortexManifest(courses=mappings)

    async def ingest_lecture(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Send a completed lecture transcript payload to Cortex."""
        response = await self._request("POST", "/api/connectors/panopto/ingest", json_data=payload)
        try:
            return response.json()
        except Exception:
            return {"status": "ok"}
