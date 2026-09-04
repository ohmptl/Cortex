# Panopto acquisition refactor audit

## OAuth-era implementation removed

The prior Cortex path was an outbound pull architecture:

1. `/api/panopto/connect` created an OAuth authorization request and cookie state.
2. `/api/panopto/callback` exchanged the code and encrypted access/refresh tokens into the shared `provider_credentials` table.
3. `/api/panopto/folders` decrypted the access token and called Panopto REST for discovery.
4. `/api/panopto/map-course` attached a folder to a Panopto `provider_connections` row.
5. `PanoptoClient` called folder/session/caption REST endpoints and a legacy cookie-backed SRT endpoint.
6. `syncPanoptoCourse` refreshed tokens, discovered sessions, downloaded captions, and performed multiple non-transactional Supabase writes.
7. `check-panopto-live.ts`, `sync-panopto.ts`, npm scripts, OAuth UI, and `PANOPTO_BASE_URL`, `PANOPTO_CLIENT_ID`, and `PANOPTO_CLIENT_SECRET` supported that path.

Those routes, services, scripts, configuration variables, and UI concepts were deleted. The migration detaches useful mappings and lecture knowledge, then deletes Panopto connection rows; cascading foreign keys remove their obsolete encrypted credentials and capability diagnostics. `provider_connections`, `provider_credentials`, and Moodle synchronization remain intact for Moodle only.

## Downstream infrastructure reused

- `lectures`, now identified by `(owner_id, provider, provider_session_id)` without a provider connection.
- `lecture_transcripts`, extended to retain exact `raw_content` plus derived `plain_text`.
- `lecture_segments`, including generated PostgreSQL `search_vector` and its GIN index.
- `search_lecture_transcripts`, course/lecture/date filters, timestamps, and neighboring context.
- MCP tools: `list_course_lectures`, `get_lecture`, `get_lecture_transcript`, and `search_lecture_transcripts`.
- Lecture-targeted notes, source segment/timestamp provenance, and `knowledge_links`.
- Shared Moodle provider connection, credential, capability, synchronization, live-content, student-state, and grade infrastructure.

## Connector replacement

The replacement is inbound only:

```text
Cortex Settings → token hash + course/folder mappings
Custom Panopto Worker → GET manifest
Custom Panopto Worker → acquire and normalize timed captions
Custom Panopto Worker → POST ingest
Cortex → validate/hash → atomic canonical write → timed segments → generated FTS → MCP
```

The adjacent `panoptoAPI` worker was inspected. Its live payload field names, manifest field names, normalized caption content, lowercase SHA-256 digest, SRT/WebVTT values, bearer header, and endpoint paths match the implemented contract. The worker normalizes BOM, line endings, trailing per-line whitespace, and trailing blank lines before transmission; Cortex hashes the exact UTF-8 bytes it receives, so the digest semantics agree without Cortex mutating the canonical input.
