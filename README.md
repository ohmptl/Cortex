# Cortex

Cortex is a private, single-user academic data platform. Moodle data is retained as sanitized raw source records and projected into a provider-neutral relational model used by both the editorial web interface and remote MCP server.

```text
Moodle → raw records + versions → normalized academic domain → UI + MCP
```

## What V2 includes

- Automatic Moodle course creation using stable Moodle course IDs
- Capability discovery from the connected token's real web-service allowlist
- Course sections/modules and action-event-first workload discovery
- Activity-specific typing and optional assignment, quiz, completion, submission, and grade enrichment
- Raw record provenance, content hashes, version history, missing-upstream state, and observable sync runs
- Relational grade categories/items with authoritative course/category association
- User-owned overrides, notes, tags, completion state, and review items
- Editorial Today, Calendar, Course, gradebook, diagnostics, and raw-source views
- OAuth-protected remote MCP read and safe-write tools

Inherited provider scraping, fuzzy duplicate resolution, syllabus parsing, gamification/statistics, page-load synchronization, and the duplicated workflow have been removed. `panopto_summarizer/` remains unchanged for the later lecture phase.

## Stack

- Next.js 16.3.2 / React 19 / TypeScript
- Supabase Auth, Postgres, RLS, Cron, Vault, and Edge Functions
- Official Model Context Protocol TypeScript SDK
- Node.js 22+

## Local development

1. Copy `.env.example` to `.env.local` and fill in the local Supabase values.
2. Install packages with `npm install`.
3. Apply the destructive V2 migrations with `supabase db reset` for local development, or `supabase migration up` against the intended disposable database.
4. Deploy `moodle-sync-dispatch` and `moodle-sync-worker` and configure their secrets.
5. Create the single Supabase Auth user, then run `npm run dev`.
6. Open `/settings/integrations/moodle`, connect the Moodle token, and run the first sync.

The Moodle token and service-role key remain server-side. Tokens are submitted in POST bodies, encrypted with a 32-byte AES-GCM key, and stripped from raw payloads and diagnostics.

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

See [architecture](docs/architecture.md), [MCP deployment and client connection](docs/mcp.md), and the [Vault-backed cron template](supabase/cron.sql.example).
