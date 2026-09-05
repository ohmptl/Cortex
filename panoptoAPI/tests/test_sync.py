"""Integration tests for the SyncCoordinator with mock Cortex and Panopto clients."""

import pytest
import respx

from custom_panopto.config import Config
from custom_panopto.cortex import CortexClient
from custom_panopto.panopto import PanoptoClient
from custom_panopto.sync import SyncCoordinator


@pytest.mark.asyncio
async def test_sync_coordinator_full_cycle(test_config: Config):
    # Setup mock Cortex endpoints
    with respx.mock(base_url="http://cortex.test") as cortex_mock:
        cortex_mock.get("/api/connectors/panopto/manifest").respond(
            status_code=200,
            json={
                "courses": [
                    {
                        "courseId": "cortex-course-ece563",
                        "panoptoFolderId": "folder-ece563",
                    }
                ]
            },
        )
        ingest_route = cortex_mock.post("/api/connectors/panopto/ingest").respond(
            status_code=200,
            json={"status": "created"},
        )

        # Setup mock Panopto endpoints
        with respx.mock(base_url="https://ncsu.hosted.panopto.com") as panopto_mock:
            panopto_mock.get("/Panopto/api/v1/folders/folder-ece563/sessions").respond(
                status_code=200,
                json={
                    "Results": [
                        {
                            "Id": "sess-ready",
                            "Name": "ECE563 Lecture 1",
                            "StartTime": "2026-09-01T14:30:00Z",
                            "Duration": 3600,
                        },
                        {
                            "Id": "sess-pending",
                            "Name": "ECE563 Lecture 2",
                            "StartTime": "2026-09-03T14:30:00Z",
                            "Duration": 3600,
                        },
                    ]
                },
            )

            # sess-ready has captions
            panopto_mock.get("/Panopto/api/v1/sessions/sess-ready/captions").respond(
                status_code=200,
                headers={"Content-Type": "text/vtt"},
                text="WEBVTT\n\n1\n00:00:01,000 --> 00:00:05,000\nHello world",
            )

            # sess-pending has no captions
            panopto_mock.get("/Panopto/api/v1/sessions/sess-pending/captions").respond(status_code=404)
            panopto_mock.get("/Panopto/Pages/Transcription/GenerateSRT.ashx").respond(status_code=404)

            # Create coordinator and clients
            coordinator = SyncCoordinator(test_config)
            cortex_client = CortexClient("http://cortex.test", "tok")
            panopto_client = PanoptoClient("https://ncsu.hosted.panopto.com", cookies={"a": "b"})

            # --- RUN 1 ---
            summary1 = await coordinator.run(
                cortex_client=cortex_client,
                panopto_client=panopto_client,
            )

            assert summary1.courses_scanned == 1
            assert summary1.sessions_discovered == 2
            assert summary1.ingested_new == 1
            assert summary1.pending_transcripts == 1
            assert summary1.errors == 0
            assert ingest_route.call_count == 1

            # Check database state
            db = coordinator.state_db
            assert db.is_already_ingested("sess-ready")
            assert not db.is_already_ingested("sess-pending")
            assert db.get_session("sess-pending")["status"] == "PENDING_TRANSCRIPT"

            # --- RUN 2 (Idempotency) ---
            summary2 = await coordinator.run(
                cortex_client=cortex_client,
                panopto_client=panopto_client,
            )

            # sess-ready is unchanged, sess-pending is still pending
            assert summary2.unchanged == 1
            assert summary2.pending_transcripts == 1
            assert summary2.ingested_new == 0
            # ingest should not be called again for sess-ready!
            assert ingest_route.call_count == 1


@pytest.mark.asyncio
async def test_sync_circuit_breaker_halts(test_config: Config):
    test_config.set_auth_locked("Circuit breaker test")
    coordinator = SyncCoordinator(test_config)

    summary = await coordinator.run()
    assert summary.errors == 1
    assert summary.courses_scanned == 0
