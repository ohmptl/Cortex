# Cortex three-domain architecture

> **Supabase is not a Moodle cache. Cortex persists student state and durable academic knowledge. Provider-owned instructional content remains provider-owned and is retrieved live.**

## Ownership

| Persistent student state | Live Moodle content | Persistent academic knowledge |
| --- | --- | --- |
| Courses/enrollments | Announcements and general forums | Panopto lectures |
| Actionable academic items | Sections and module lists | Canonical raw transcripts |
| Deadlines and availability | Pages, books, and URLs | Timestamped transcript segments |
| Submission and completion | PDFs, slides, and documents | PostgreSQL retrieval indexes |
| Provider grades and structure | Syllabus/static instructor material | User and assistant notes |
| Provider references and typed history | Reference files and handouts | Knowledge links |
| Overrides, manual items, tags, reviews | | Optional derived insights |
| Personal grade models | | |

## Data flow

Moodle synchronization writes only student state. It may call `core_course_get_contents` transiently to resolve actionable activities and completion, but never stores course navigation or file/resource bodies. Live operations resolve a Cortex course through an owner-scoped `course_provider_links` row, decrypt the Moodle token for that operation, normalize the result, and discard provider payloads after a five-minute in-process cache expires.

Provider grade rows are immutable provider truth. `grade_models`, category rules, and item rules hold Cortex-owned interpretation, exclusions, corrected weights, and hypothetical scores. Calculations never update provider rows.

Panopto is an ingestion provider because transcripts are durable academic memory. Cortex does not authenticate to or poll Panopto. A trusted external Custom Panopto Connector acquires lecture transcripts and pushes them into Cortex. Cortex owns course-folder mappings and the resulting durable academic knowledge. New or changed timed transcripts are retained canonically and deterministically segmented at caption boundaries. Unchanged content hashes skip reprocessing. Video is never downloaded.

```text
Custom Panopto Worker
  → GET connector manifest
  → Panopto folder discovery and caption acquisition
  → POST connector ingest
  → Cortex canonical transcript, segments, FTS, notes, and MCP
```

The worker is the sole acquisition layer. Cortex remains usable when the worker is offline, and neither Cortex nor MCP contacts Panopto or the worker at query time.

## Identity and provenance

- Moodle courses: connection plus Moodle course ID.
- Academic work: connection plus semantic provider item ID, retaining course/module/instance IDs.
- Grades: connection plus Moodle category/item ID.
- Panopto lectures: owner plus provider plus Panopto session ID; course folders are explicit owner/course/folder links with no OAuth connection.
- Transcript segments: stable cue time range, with deterministic ordinal/text fallback for untimed sources.

Names are display data, not identity keys. Returned Moodle file references are opaque hashes; callers never submit or receive authenticated provider URLs. Notes can cite a provider object, credential-free URL, lecture segment, and timestamp.

## Failure and security boundary

Live provider failures use explicit capability, access, authentication, timeout, availability, response, and mapping codes. A failed live request does not affect persistent dashboards, deadlines, grades, or knowledge. Credentials are decrypted only server-side, token-shaped URL parameters are removed from responses, downloads are restricted to the configured provider origin, and every operation verifies owner/course linkage.

Connector tokens are generated from 256 random bits, shown once, and stored only as SHA-256 lookup hashes in `connector_credentials`. A token resolves its owner; request bodies cannot choose an owner. Ingestion additionally verifies course ownership and the exact configured folder mapping before calling a service-role-only transactional database function.

Transcript search combines PostgreSQL lexical ranking with neighboring segments. A semantic ranker can be added behind the retrieval interface later; canonical transcript storage does not depend on an embedding model or graph database. See [the independent worker contract](panopto-connector.md).
