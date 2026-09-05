"""Unit tests for Cortex HTTP client and manifest contracts."""

import pytest
import respx
import httpx

from custom_panopto.cortex import (
    CortexClient,
    CortexPermanentError,
    CortexTransientError,
)


@pytest.mark.asyncio
async def test_get_manifest_simplified_format():
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.get("/api/connectors/panopto/manifest").respond(
            status_code=200,
            json={
                "courses": [
                    {
                        "courseId": "cortex-ece563-uuid",
                        "panoptoFolderId": "folder-ece563",
                        "syncSince": "2026-08-01T00:00:00Z",
                    },
                    {
                        "courseId": "cortex-ece564-uuid",
                        "panoptoFolderId": "folder-ece564",
                    },
                ]
            },
        )

        client = CortexClient("http://cortex.test", "my-secret-token")
        manifest = await client.get_manifest()

        assert len(manifest.courses) == 2
        assert manifest.courses[0].course_id == "cortex-ece563-uuid"
        assert manifest.courses[0].panopto_folder_id == "folder-ece563"
        assert manifest.courses[0].sync_since == "2026-08-01T00:00:00Z"
        assert manifest.courses[1].course_id == "cortex-ece564-uuid"
        assert manifest.courses[1].panopto_folder_id == "folder-ece564"


@pytest.mark.asyncio
async def test_get_manifest_legacy_folders_format():
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.get("/api/connectors/panopto/manifest").respond(
            status_code=200,
            json={
                "courses": [
                    {
                        "courseId": "legacy-course-uuid",
                        "folders": [{"providerFolderId": "legacy-folder-id"}],
                    }
                ]
            },
        )

        client = CortexClient("http://cortex.test", "my-secret-token")
        manifest = await client.get_manifest()

        assert len(manifest.courses) == 1
        assert manifest.courses[0].course_id == "legacy-course-uuid"
        assert manifest.courses[0].panopto_folder_id == "legacy-folder-id"


@pytest.mark.asyncio
async def test_ingest_lecture_success():
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        route = respx_mock.post("/api/connectors/panopto/ingest").respond(
            status_code=200,
            json={"status": "created"},
        )

        client = CortexClient("http://cortex.test", "test-token")
        payload = {"provider": "panopto", "title": "Test Lecture"}
        res = await client.ingest_lecture(payload)

        assert res.get("status") == "created"
        assert route.called
        assert route.calls.last.request.headers["Authorization"] == "Bearer test-token"


@pytest.mark.asyncio
async def test_ingest_lecture_permanent_error():
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.post("/api/connectors/panopto/ingest").respond(
            status_code=401,
            text="Invalid Bearer Token",
        )

        client = CortexClient("http://cortex.test", "bad-token")
        with pytest.raises(CortexPermanentError):
            await client.ingest_lecture({"provider": "panopto"})


@pytest.mark.asyncio
async def test_ingest_lecture_transient_error_exhausted():
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.post("/api/connectors/panopto/ingest").respond(
            status_code=503,
            text="Service Unavailable",
        )

        client = CortexClient("http://cortex.test", "token", max_retries=1)
        with pytest.raises(CortexTransientError):
            await client.ingest_lecture({"provider": "panopto"})
