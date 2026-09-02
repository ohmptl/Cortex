# Cortex

Cortex is a private academic context platform built around persistent student state, live provider-owned course content, and durable academic knowledge.

```text
Moodle sync → student state ─┐
Moodle live → course content ├→ Cortex UI + MCP
Panopto sync → knowledge ────┘
```

## What Cortex includes

- Automatic Moodle course creation using stable Moodle course IDs
- Capability discovery from the connected token's real web-service allowlist
- Action-event and activity workload discovery without a course-content mirror
- Activity-specific typing and optional assignment, quiz, completion, submission, and grade enrichment
- Typed student-state history, stable provider references, missing-upstream state, and observable sync runs
- Relational grade categories/items with authoritative course/category association
- Immutable provider grades plus user-owned grade models, overrides, notes, tags, completion, and reviews
- Live Moodle announcements, modules, resources, files, and bounded document reading
- Panopto OAuth, explicit folder mappings, canonical transcripts, deterministic segments, and lexical retrieval
- Editorial Today, Calendar, Course, gradebook, lecture, and diagnostics views
- OAuth-protected remote MCP read and safe-write tools

Moodle mirror tables, raw provider payload archives, fuzzy identity matching, page-load synchronization, mandatory LLM enrichment, and token-bearing provider URLs are intentionally excluded.

## Stack

- Next.js 16.3.2 / React 19 / TypeScript
- Supabase Auth, Postgres, RLS, Cron, Vault, and Edge Functions
- Official Model Context Protocol TypeScript SDK
- Node.js 22+

## Local development

1. Copy `.env.example` to `.env.local` and fill in the local Supabase values.
2. Install packages with `npm install`.
3. Apply the destructive migrations with `supabase db reset` for local development, or `supabase migration up` against the intended database.
4. Deploy `moodle-sync-dispatch` and `moodle-sync-worker` and configure their secrets.
5. Create the single Supabase Auth user, then run `npm run dev`.
6. Connect Moodle and run the first student-state sync. Configure Panopto OAuth, connect it from Settings, explicitly map folders, then run `npm run sync:panopto -- <course-uuid>`.

Provider credentials and the service-role key remain server-side and encrypted with a 32-byte AES-GCM key. Provider tokens, authenticated file URLs, transcript bodies, and announcement bodies are excluded from diagnostics.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

See [architecture](docs/architecture.md), [MCP deployment and client connection](docs/mcp.md), and the [Vault-backed cron template](supabase/cron.sql.example).
