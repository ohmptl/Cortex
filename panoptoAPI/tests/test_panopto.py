"""Unit tests for Panopto client folder listing and caption retrieval."""

import pytest
import respx

from custom_panopto.panopto import PanoptoClient


@pytest.mark.asyncio
async def test_list_folder_sessions_success():
    base_url = "https://ncsu.hosted.panopto.com"
    folder_id = "test-folder-uuid"

    with respx.mock(base_url=base_url) as respx_mock:
        respx_mock.get(f"/Panopto/api/v1/folders/{folder_id}/sessions").respond(
            status_code=200,
            json={
                "Results": [
                    {
                        "Id": "session-1",
                        "Name": "Lecture 01",
                        "StartTime": "2026-09-02T10:00:00Z",
                        "Duration": 3000,
                        "Urls": {"ViewerUrl": "https://ncsu.hosted.panopto.com/Pages/Viewer.aspx?id=session-1"},
                        "LastModified": "2026-09-02T11:00:00Z",
                    }
                ]
            },
        )

        client = PanoptoClient(base_url=base_url, cookies={".ASPXAUTH": "fake_cookie"})
        sessions = await client.list_folder_sessions(folder_id)

        assert len(sessions) == 1
        assert sessions[0].session_id == "session-1"
        assert sessions[0].title == "Lecture 01"
        assert sessions[0].duration_seconds == 3000
        assert sessions[0].viewer_url == "https://ncsu.hosted.panopto.com/Pages/Viewer.aspx?id=session-1"


@pytest.mark.asyncio
async def test_get_transcript_via_srt_endpoint():
    base_url = "https://ncsu.hosted.panopto.com"
    session_id = "session-srt-1"

    raw_srt = (
        "1\r\n00:00:01,000 --> 00:00:05,000\r\nHello class from legacy SRT\r\n"
    )

    with respx.mock(base_url=base_url) as respx_mock:
        respx_mock.get("/Panopto/Pages/Transcription/GenerateSRT.ashx").respond(
            status_code=200,
            headers={"Content-Type": "application/x-subrip"},
            text=raw_srt,
        )

        client = PanoptoClient(base_url=base_url, cookies={".ASPXAUTH": "fake_cookie"})
        res = await client.get_transcript(session_id)

        assert res is not None
        assert res.format == "srt"
        assert "Hello class from legacy SRT" in res.content


@pytest.mark.asyncio
async def test_get_transcript_fallback_to_official_endpoint():
    base_url = "https://ncsu.hosted.panopto.com"
    session_id = "session-captions-1"

    vtt_content = (
        "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nWelcome to Computer Systems Architecture."
    )

    with respx.mock(base_url=base_url) as respx_mock:
        # SRT endpoint returns 404
        respx_mock.get("/Panopto/Pages/Transcription/GenerateSRT.ashx").respond(status_code=404)
        # Fallback captions returns VTT
        respx_mock.get(f"/Panopto/api/v1/sessions/{session_id}/captions").respond(
            status_code=200,
            headers={"Content-Type": "text/vtt"},
            text=vtt_content,
        )

        client = PanoptoClient(base_url=base_url, cookies={".ASPXAUTH": "fake_cookie"})
        res = await client.get_transcript(session_id)

        assert res is not None
        assert res.format == "webvtt"
        assert "Computer Systems" in res.content
        assert res.content_hash is not None



@pytest.mark.asyncio
async def test_get_transcript_unavailable_returns_none():
    base_url = "https://ncsu.hosted.panopto.com"
    session_id = "session-no-transcripts"

    with respx.mock(base_url=base_url) as respx_mock:
        respx_mock.get(f"/Panopto/api/v1/sessions/{session_id}/captions").respond(status_code=404)
        respx_mock.get("/Panopto/Pages/Transcription/GenerateSRT.ashx").respond(
            status_code=200,
            text="",  # Empty or not ready
        )

        client = PanoptoClient(base_url=base_url, cookies={".ASPXAUTH": "fake_cookie"})
        res = await client.get_transcript(session_id)
        assert res is None
