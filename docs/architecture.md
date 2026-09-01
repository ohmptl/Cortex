# Cortex V2 architecture

## Data flow

Moodle is a provider, not the Cortex domain. The Moodle worker first stores sanitized source objects in `raw_source_records` and content-addressed history in `raw_source_record_versions`. It then resolves stable identities through `source_references` and updates normalized courses, structure, academic items, completion/submission state, and gradebook rows.

Provider payloads never write `field_overrides`. Effective views distinguish imported source values from deliberate Cortex edits. A due-date override therefore survives every later Moodle update.

## Identity rules

- Courses: Moodle course ID.
- Structure: Moodle section and course-module IDs.
- Activities: module type plus module instance ID, with course-module ID as fallback.
- Standalone events: Moodle calendar event ID.
- Grades: Moodle grade category/item IDs within the authoritative Moodle course.

Names are display data and never normal synchronization keys. Unknown grade categories remain null.

## Synchronization

`moodle-sync-dispatch` creates scheduled runs. `moodle-sync-worker` transactionally claims one bounded task, heartbeats the run, and atomically records counters. Bootstrap and enrolled courses are mandatory; optional endpoint failures are retained as failed steps and yield a partial run.

Missing state is applied only after a successful authoritative collection phase. Raw and normalized records are retained rather than immediately deleted.

The UI and MCP server share `AcademicRepository` and `AcademicService`. Next.js Server Components access these directly; they do not call internal HTTP routes.

## Panopto boundary

`panopto_summarizer/` remains standalone. A future migration will add lectures, complete transcripts, timestamped chunks, versioned structured summaries, concepts, and optional embeddings. The complete original transcript—not only an LLM summary—will be retained.
