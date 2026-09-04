# Custom Panopto Connector contract

Cortex never authenticates to, polls, or downloads from Panopto. The external worker owns acquisition; Cortex owns folder mappings and durable academic knowledge.

## Authentication and provisioning

Generate a token in **Settings → Lectures → Panopto Connector**. The raw high-entropy token is shown once. Send it on every worker request:

```http
Authorization: Bearer <connector-token>
```

Cortex stores only the token's SHA-256 lookup hash. Rotation revokes the previous token atomically. Missing, malformed, invalid, or revoked credentials return `401 UNAUTHORIZED`. Successful use updates `last_used_at`; successful ingestion updates `last_ingest_at`.

## Manifest

```http
GET /api/connectors/panopto/manifest
Authorization: Bearer <connector-token>
```

Only active courses owned by the token owner are returned. `syncSince` is omitted when the user did not configure it.

```json
{
  "courses": [
    {
      "courseId": "123e4567-e89b-42d3-a456-426614174000",
      "panoptoFolderId": "f0f2c21f-3fe0-432b-be56-b4a3005a4f59",
      "syncSince": "2026-08-01T00:00:00+00:00"
    }
  ]
}
```

No mappings returns `200 {"courses":[]}`.

## Ingest

```http
POST /api/connectors/panopto/ingest
Authorization: Bearer <connector-token>
Content-Type: application/json
```

```json
{
  "provider": "panopto",
  "courseId": "123e4567-e89b-42d3-a456-426614174000",
  "providerFolderId": "f0f2c21f-3fe0-432b-be56-b4a3005a4f59",
  "providerSessionId": "9bc28a03-42b5-49da-9a1e-b4a3005a61d6",
  "title": "2026 Fall ECE 463 001 09/02/26",
  "recordedAt": "2026-09-02T14:30:00-04:00",
  "durationSeconds": 4731,
  "providerUrl": "https://ncsu.hosted.panopto.com/Panopto/Pages/Viewer.aspx?id=9bc28a03-42b5-49da-9a1e-b4a3005a61d6",
  "transcript": {
    "format": "srt",
    "language": "en",
    "contentHash": "<64 lowercase hex characters>",
    "content": "1\n00:00:00,480 --> 00:00:06,760\n...\n"
  }
}
```

`recordedAt` must contain `Z` or an explicit UTC offset. `durationSeconds` is 1–86400. Folder/session IDs are at most 200 characters, title 500, language 35, URL 2048, and transcript content 10 MiB of UTF-8 at most. Formats are `srt` and `webvtt`. `providerUrl` must be credential-free HTTPS on `PANOPTO_PROVIDER_ORIGIN` (default `https://ncsu.hosted.panopto.com`).

### SHA-256 semantics

`contentHash` is lowercase hexadecimal SHA-256 of the exact UTF-8 bytes of the JSON `transcript.content` string. Cortex performs no newline or Unicode normalization before hashing and recomputes the digest before parsing.

### Outcomes and idempotency

- New Panopto session: `201 {"status":"created"}`.
- Metadata changed but exact transcript hash unchanged: `200 {"status":"updated"}`; segments are not rebuilt.
- Transcript hash changed: `200 {"status":"updated"}`; canonical transcript and derived segments are replaced atomically.
- Metadata and transcript unchanged: `200 {"status":"unchanged"}`; no transcript parsing or segment rebuild occurs in the database write.

The application validates captions before the transaction. The database locks the owner/session identity and atomically writes lecture metadata, exact raw caption content, normalized plain text, and caption-aware segments. PostgreSQL's generated FTS vector makes the segments immediately available to `search_lecture_transcripts` and MCP.

## Errors and retry behavior

Permanent/dead-letter responses:

- `401 UNAUTHORIZED`: connector token missing, malformed, invalid, or revoked.
- `403 COURSE_FORBIDDEN` or `PANOPTO_MAPPING_MISMATCH`: wrong owner, missing mapping, or wrong folder.
- `404 COURSE_NOT_FOUND`: Cortex course ID does not exist.
- `422 INVALID_PAYLOAD`, `INVALID_PROVIDER_URL`, `TRANSCRIPT_TOO_LARGE`, `TRANSCRIPT_HASH_MISMATCH`, or `MALFORMED_TRANSCRIPT`.
- `400` is reserved for other permanently malformed requests.

Retry `429`, `500`, `502`, `503`, and `504`. Cortex uses `503 DATABASE_UNAVAILABLE`, `CONNECTOR_AUTH_UNAVAILABLE`, or `INGESTION_UNAVAILABLE` for transient database failures and never returns stack traces.
