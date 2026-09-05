"""Unit tests for SQLite state tracking and transcript normalization."""

import pytest
from custom_panopto.state import (
    StateDatabase,
    compute_content_hash,
    normalize_transcript,
)


def test_transcript_normalization():
    raw_with_bom = "\ufeff1\r\n00:00:01,000 --> 00:00:04,000  \r\nHello class!  \r\n\r\n"
    raw_clean = "1\n00:00:01,000 --> 00:00:04,000\nHello class!"

    normalized1 = normalize_transcript(raw_with_bom)
    normalized2 = normalize_transcript(raw_clean)

    assert normalized1 == normalized2
    assert compute_content_hash(raw_with_bom) == compute_content_hash(raw_clean)


def test_session_state_lifecycle(state_db: StateDatabase):
    session_id = "sess-12345"
    course_id = "course-abc"
    folder_id = "folder-xyz"

    # 1. Initially not ingested
    assert not state_db.is_already_ingested(session_id)

    # 2. Record discovery
    state_db.record_discovered(
        provider_session_id=session_id,
        course_id=course_id,
        provider_folder_id=folder_id,
        title="Lecture 1: Intro to Architectures",
        recorded_at="2026-09-01T14:30:00Z",
        duration_seconds=3600,
    )

    sess = state_db.get_session(session_id)
    assert sess is not None
    assert sess["status"] == "DISCOVERED"
    assert sess["title"] == "Lecture 1: Intro to Architectures"

    # 3. Mark pending
    state_db.mark_pending(session_id, reason="TRANSCRIPT_NOT_READY")
    sess = state_db.get_session(session_id)
    assert sess["status"] == "PENDING_TRANSCRIPT"
    assert sess["last_error_code"] == "TRANSCRIPT_NOT_READY"

    # 4. Mark ingested
    test_hash = "abc1234567890abcdef"
    state_db.mark_ingested(session_id, test_hash)
    sess = state_db.get_session(session_id)
    assert sess["status"] == "INGESTED"
    assert sess["transcript_hash"] == test_hash
    assert sess["error_count"] == 0

    # 5. Check is_already_ingested
    assert state_db.is_already_ingested(session_id)
    assert state_db.is_already_ingested(session_id, test_hash)
    assert not state_db.is_already_ingested(session_id, "different_hash")


def test_auth_state_circuit_breaker_counting(state_db: StateDatabase):
    assert state_db.get_auth_failures() == 0

    fail1 = state_db.record_auth_failure("Bad password")
    assert fail1 == 1
    assert state_db.get_auth_failures() == 1

    fail2 = state_db.record_auth_failure("Bad password again")
    assert fail2 == 2

    fail3 = state_db.record_auth_failure("Bad password 3rd time")
    assert fail3 == 3

    # Reset
    state_db.reset_auth_failures()
    assert state_db.get_auth_failures() == 0
