"""Unit tests for the durable retry spool and dead-letter handling."""

import json
import pytest
import respx
import httpx

from custom_panopto.cortex import CortexClient
from custom_panopto.spool import RetrySpool
from custom_panopto.state import StateDatabase


@pytest.mark.asyncio
async def test_spool_write_and_successful_retry(retry_spool: RetrySpool, state_db: StateDatabase):
    session_id = "sess-spool-1"
    content_hash = "abcdef1234567890"
    payload = {
        "provider": "panopto",
        "courseId": "course-123",
        "providerSessionId": session_id,
        "transcript": {
            "contentHash": content_hash,
            "content": "Hello world transcript",
        },
    }

    # Record discovery first
    state_db.record_discovered(session_id, "course-123", "folder-123", "Spool Test")

    # 1. Write to spool
    spool_file = retry_spool.write_payload(session_id, content_hash, payload)
    assert spool_file.exists()
    assert retry_spool.count() == 1

    # 2. Mock Cortex returning 200
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.post("/api/connectors/panopto/ingest").respond(status_code=200, json={"status": "created"})

        cortex = CortexClient(base_url="http://cortex.test", connector_token="token")
        succ, perm, trans = await retry_spool.retry_all(cortex, state_db)

        assert succ == 1
        assert perm == 0
        assert trans == 0
        assert retry_spool.count() == 0
        assert not spool_file.exists()
        assert state_db.is_already_ingested(session_id, content_hash)


@pytest.mark.asyncio
async def test_spool_permanent_failure_moves_to_dead_letter(retry_spool: RetrySpool, state_db: StateDatabase):
    session_id = "sess-spool-reject"
    content_hash = "deadbeef12345678"
    payload = {
        "provider": "panopto",
        "courseId": "nonexistent-course",
        "providerSessionId": session_id,
        "transcript": {
            "contentHash": content_hash,
            "content": "Rejected content",
        },
    }

    state_db.record_discovered(session_id, "nonexistent-course", "folder-123", "Bad Course")
    retry_spool.write_payload(session_id, content_hash, payload)
    assert retry_spool.count() == 1

    # Mock Cortex returning 404 (permanent error)
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.post("/api/connectors/panopto/ingest").respond(status_code=404, text="Course not found")

        cortex = CortexClient(base_url="http://cortex.test", connector_token="token")
        succ, perm, trans = await retry_spool.retry_all(cortex, state_db)

        assert succ == 0
        assert perm == 1
        assert trans == 0
        # Active spool is empty now because it was moved to dead-letter
        assert retry_spool.count() == 0
        dead_letter_files = list(retry_spool.dead_letter_dir.glob("*.json"))
        assert len(dead_letter_files) == 1


@pytest.mark.asyncio
async def test_spool_transient_failure_retains_in_spool(retry_spool: RetrySpool, state_db: StateDatabase):
    session_id = "sess-spool-500"
    content_hash = "retrylater123"
    payload = {
        "provider": "panopto",
        "courseId": "course-123",
        "providerSessionId": session_id,
        "transcript": {"contentHash": content_hash},
    }

    retry_spool.write_payload(session_id, content_hash, payload)

    # Mock Cortex returning 500 error
    with respx.mock(base_url="http://cortex.test") as respx_mock:
        respx_mock.post("/api/connectors/panopto/ingest").respond(status_code=500, text="Internal Error")

        cortex = CortexClient(base_url="http://cortex.test", connector_token="token", max_retries=1)
        succ, perm, trans = await retry_spool.retry_all(cortex, state_db)

        assert succ == 0
        assert perm == 0
        assert trans == 1
        # Still in active spool
        assert retry_spool.count() == 1
