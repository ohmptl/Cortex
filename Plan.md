# Cortex — Merge Plan (Overdue → Cortex)

Status: **Planning complete, awaiting go-ahead to scaffold.**

## 1. Vision

Cortex becomes a personal, single-user "second brain" web app hosted at `cortex.ohmptl.com` (Vercel):
- An assignment tracker that auto-syncs from Moodle and Gradescope (no manual entry needed).
- Keeps the existing Panopto transcript fetcher / summarizer as an isolated module, with a future
  integration path (not built yet).
- Not built to scale — single user, kept as simple as possible.

## 2. Source repos

- **Cortex** (this repo, owned by user): `panopto_summarizer/` — Python CLI, Panopto OAuth2 →
  caption fetch → Gemini summary. Fully standalone, no web app. Kept as-is.
- **overdue** (friend's repo): Next.js 14 + TypeScript + Tailwind + Zustand assignment tracker.
  Backend = Appwrite. Source of the features being ported into Cortex.

## 3. Architecture decisions

| Area | Decision |
|---|---|
| Frontend | Next.js (App Router), lives at the **root** of the Cortex repo |
| Backend/DB | **Supabase** (Postgres + RLS), replacing Appwrite |
| Auth | Single hardcoded/seeded account — no signup, no forgot-password/verify-email flows |
| Hosting | Vercel |
| `panopto_summarizer/` | Untouched, isolated folder (own deps), not part of the Next.js build |
| Sync trigger | GitHub Actions workflow, dispatched on-demand when the site is visited (via
  `workflow_dispatch` API call from a Next.js API route), rate-limited so it doesn't fire on every
  page load (e.g. only if last sync was >N minutes ago). No fixed daily/hourly cron. |
| UI | Use Overdue's speced dark-theme redesign (`Claude Code Prompt.md` + bundled HTML mockup) as
  the **inspiration/starting point**, not a strict spec — free to simplify/improve. Bottom line:
  minimal, dark-themed, clean. |

## 4. Feature scope

### Keeping (ported from Overdue)
- Assignment CRUD: title, course, deadline, status, category, tags, notes
- Course management: code, name, color, instructor, office hours, grade weights/graded items
  (grade calculator)
- **Gradescope auto-sync**: encrypted session token, connect/status/sync/disconnect, conflict
  detection + resolution (manual vs. synced assignment collisions)
- **Moodle auto-sync**: URL + token/password connect, sync, disconnect
- Statistics tab: completion rate, quick stats, trend chart, course workload, streak tracker
- Calendar tab: month/week view of assignments (no external calendar sync)
- **Syllabus parsing (Gemini)**: upload a syllabus PDF → auto-creates the course — the only AI
  feature kept for MVP

### Dropped entirely
- Chrome extension (Gradescope/Moodle page scraping) — explicitly out of scope
- AI "Solver" (Claude session key + browser automation to auto-solve and upload assignment
  solutions) — academic-integrity concern, removed
- Nextcloud/WebDAV file storage + assignment attachments — no file storage in MVP
- Google Calendar sync (NextAuth Google OAuth + googleapis import/export) — removed fully
- IndexedDB offline-storage layer — legacy, superseded by Supabase
- NLP quick-add ("CS homework due Friday" parsing) and AI study tips — not useful enough to keep
- Hardcoded dev-password feature gate (`HelloBye123`) — insecure leftover, removed
- Old Cortex roadmap items (Notion sync, Discord bot) — superseded by the new DB-backed tracker

### Deferred (not built now, design shouldn't block them later)
- **Panopto integration**: stays a local CLI script the user runs themselves. Later, it (or
  "Hermes") could push summaries into Supabase via an API endpoint + service-role key.
- **Hermes**: user's local agentic AI harness (separate infra). Not touched now — the webapp's API
  should stay decoupled enough that Hermes can call into it later without a rework.

## 5. Data model (initial sketch, Supabase/Postgres)

- `courses`: id, code, name, color, instructor, office_hours (jsonb), grade_weights (jsonb),
  graded_items (jsonb), active, created_at
- `assignments`: id, title, course_id (fk), deadline, status, category, tags (text[]), notes,
  source ('manual' | 'gradescope' | 'moodle'), gradescope_id, gradescope_course_id, moodle_id,
  created_at, updated_at, completed_at
- `conflicts`: id, manual_assignment_id (fk), source_title, source_deadline, source_course_id,
  source_course_name, source_data (jsonb), resolved, resolution, created_at, resolved_at
- `integrations` (single row per service since single-user): gradescope (encrypted session token,
  email, last_sync), moodle (url, username, encrypted token, last_sync)

RLS: since single-user, policies can just check `auth.uid() = owner_id`, or app can skip RLS
complexity and rely on the Supabase service role for all server-side access (API routes only,
no direct client DB access) — to be decided during implementation.

## 6. Sync mechanism (Gradescope + Moodle)

- Rewrite `scripts/sync_gradescope.py` and the Moodle sync logic to use the Supabase Python/JS
  client instead of Appwrite SDK.
- GitHub Actions workflow (`.github/workflows/sync.yml`) runs both syncs, triggered via
  `workflow_dispatch`.
- A Next.js API route (`/api/sync/trigger`) is called client-side on dashboard load; it checks
  last-sync timestamp in Supabase and, if stale, calls the GitHub REST API to dispatch the
  workflow. Encryption key + GitHub PAT stored as Vercel env vars.

## 7. Rough implementation order

1. Scaffold Next.js app at Cortex repo root (App Router, Tailwind, Supabase client)
2. Supabase schema + auth (single seeded user)
3. Port assignment/course CRUD + stores (Zustand) from Overdue, adapted to Supabase
4. Port Gradescope sync (API routes + GitHub Actions workflow, Appwrite→Supabase rewrite)
5. Port Moodle sync (same treatment)
6. Conflict resolution UI
7. Statistics + Calendar tabs
8. Syllabus parsing (Gemini) for auto course creation
9. On-visit sync trigger wiring (debounced GitHub Actions dispatch)
10. Basic settings page (integrations only — no appearance/dev-gate/solver/nextcloud sections)

## 8. Explicitly out of scope for this merge
Chrome extension, AI Solver, Nextcloud, Google Calendar sync, IndexedDB, NLP quick-add, AI study
tips, multi-user auth, Hermes integration, Panopto webapp integration.
