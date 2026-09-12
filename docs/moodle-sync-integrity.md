# Moodle synchronization integrity

Moodle owns academic source fields and completion. `field_overrides`, notes, tags,
relations, knowledge, and personal grade models remain separate Cortex state.
The Today overdue predicate is unchanged.

## Confirmed production diagnosis (September 12, 2026)

- Run `28004d82-2032-49d1-b465-aba4367fcdd9`, created September 9 at
  22:00:06 UTC, was queued with **zero tasks**. Dispatch created runs and bootstrap
  tasks in separate requests, ignored task insert errors, then indefinitely skipped
  the active run. The precise failed insertion response was not retained.
- Cron was installed and active: `cortex-moodle-dispatch` every 15 minutes and
  `cortex-moodle-worker` every minute. pg_cron, pg_net, and Vault existed. Recent
  worker responses were HTTP 200 with `processed:0,remaining:0`; occasional HTTP
  500 gateway timeouts also occurred. Cron SQL success did not prove sync success.
- Deployed dispatcher version 4 and worker version 12 were last updated September 1,
  before commit `7183e37` (forum persistence/completion). Downloaded worker source
  confirmed forums were merely a live capability, not persisted from module contents.
- The old worker marked unseen rows missing even when only a filtered action
  calendar had been read. It did not write module-only activities. Its assignment /
  quiz enrichment resolved modules by CMID without the instance-ID fallback.
- Destructive disconnect discarded mappings while retaining courses/items.
  Production had three ENG 331 courses and two ECE 484 courses. Eighteen ENG items
  were attached to an inactive UUID. An old ECE 484 UUID held a Panopto folder link.
- Calendar requests used `limitnum=500`; Moodle rejected every course request because
  its maximum is 50. Pagination now uses 50 and `aftereventid`. Optional failure rows
  previously omitted required counters in bulk inserts, hiding the endpoint errors.
- Completion resets only existed for forums in repository code; generic grade
  imports and a database trigger could override completion with grade existence.
- Live reads discarded numeric section/module/file IDs through a string-only helper.
- Task settlement could race between concurrent finishers, stale claims were
  unbounded, errors from several database operations were ignored, and active
  connection publication preceded credential insertion.

Production migration history omitted `202609040011` although its Panopto schema
changes were present. This is pre-existing migration-ledger drift: do not rerun
that destructive migration blindly or mark it applied without comparing its full
schema. The Moodle migrations were applied and recorded separately.

## Identity and reconciliation

Durable course links use `(owner, moodle, normalized site URL, external user ID,
external course ID)`. Credential rotation/disconnect does not change that identity.
Disconnect disables the connection, removes its credential, and cancels outstanding
work transactionally. Connect publishes credential/capabilities/active status atomically.

`reconcile_moodle_course` reuses current or durable mappings. Historical recovery
requires consistent site/course provider evidence and no competing account. A title
alone is insufficient. The service-only `merge_moodle_course` is also available for
reviewed legacy pairs whose original provenance was lost.

Activities use `activity:<module>:<instance>`. Module IDs and exact provider URLs
connect legacy calendar/module identities to the canonical row. `reconcile_moodle_item`
repoints foreign-key dependents before marking a duplicate historical/missing. Grade
identity recovery likewise preserves personal model references.

Parents are never hard-deleted. Unique/check conflicts leave the conflicting child
intact on its historical parent and create `moodle_reconciliation_issues`. Conflicting
personal grade model names are disambiguated; a recovered competing default becomes
non-default. Both models and all rules survive. `merged_into_id` makes historical
records explicit. Investigate unresolved issues through the status tool/SQL before
making a human choice between conflicting overrides or mappings.

Historical courses with no remaining provider evidence are reported. For this repair,
the user-identified empty ENG 331 and ECE 484 duplicates were reviewed separately;
the ECE 484 Panopto mapping was moved by the same non-deleting merge routine.

## Completion and scope

The actual Edge engine is `supabase/functions/moodle-sync-worker/engine.ts`, tested
against real PostgreSQL migrations through PGlite. Live and persisted reads share
`moodle-values.ts`; academic identity and completion rules are also shared helpers.

- Moodle completion states 1, 2, and 3 mean the activity is complete (3 means complete
  with a failing result). Grade success remains a separate question.
- Assignment `submitted` state means the student's submission is done; draft/reopened
  states provide incomplete evidence. Team submission status is supported.
- Quiz attempts are consulted when completion tracking is unavailable. Non-preview
  finished/submitted attempts provide completion evidence. A finished attempt does not
  override explicit incomplete activity-completion rules.
- Disabled tracking (`completion:0`, `hascompletion:false`) is unknown, not incomplete.
- Private submission/attempt lookups are skipped, with a recorded skipped step, when
  Moodle explicitly reports `uservisible=false`. The academic row and its reported
  completion still persist. Two future ENG assignments exposed this condition.
- A grade or best-grade response alone is not used as generic completion evidence.
- Authoritative incomplete evidence clears stale completion; unknown evidence preserves it.
- Course modules persist assignments, quizzes, forums and other tracked activities even
  when absent from action calendars or specialized endpoints.
- Forum structured/calendar/completion deadlines survive disappearance from the action
  calendar. Explicit structured deadline removal on assignments/quizzes is honored.
- Missing detection runs only after all state pages finish, using complete observed
  source scopes. Action calendars are filtered and capped, so absence there is not a
  deletion signal. Failed/malformed authoritative content responses cannot erase a scope.

References: [Moodle activity completion API](https://moodledev.io/docs/5.0/apis/core/activitycompletion),
[Moodle quiz attempt support](https://docs.moodle.org/dev/Quiz_support_in_the_Mobile_app).

## Queue and diagnostics

`enqueue_moodle_sync` atomically creates the run and bootstrap task under a connection
lock. Each invocation claims at most three tasks. State pages checkpoint after up to
30 writes or a time budget and resume by canonical ID. Grade linking waits for state
repair. `settle_moodle_task` locks the run before task mutation, fences the claim, and
never revives terminal runs. A lease expires after five minutes; three expired attempts
become observable failures. `recover_moodle_sync` closes empty/stranded runs so new runs
can proceed. A failed course produces a partial run and is retried in the next full run. Transient
gateway/timeouts also receive up to three attempts while the run remains active.

`get_moodle_sync_status` and `get_moodle_sync_run` are read-only owner-scoped MCP tools.
The same diagnostic feeds `/api/moodle/status`: latest/active/recent/successful runs,
trigger/start/end times, counters, task counts/errors, optional endpoint steps,
capabilities, expected cadence, worker version and reconciliation issues. Expected
cadence is explicitly not proof of installed cron. Detailed arrays are bounded;
task totals are exact. Credentials and task claim tokens are not returned.

## Deployment and operator commands

1. Run `npm test`, `npm run lint`, `npm run typecheck` and `npm run build`.
   Where Turbopack cannot bind a port, `npm run build -- --webpack` is equivalent
   production build validation. Existing Google Fonts require network access.
2. Compare `npx supabase migration list` to production schema before applying
   migrations. Apply the new Moodle migrations in order. Do not replay historical
   migrations or silently include an unrelated pending destructive migration.
3. Deploy `npx supabase functions deploy moodle-sync-worker --use-api` and
   `npx supabase functions deploy moodle-sync-dispatch --use-api`.
   Keep `verify_jwt=true`; the gateway verifies the service JWT signature. A valid
   rotated service JWT need not be byte-identical to the injected API key.
4. Required Edge configuration: Supabase URL/service role (platform-provided) and
   `MOODLE_ENCRYPTION_KEY`, matching the key used by the Next.js connection route.
   Required application configuration remains in `.env.example`.
5. Check Vault names `cortex_project_url` and `cortex_service_role_key` without
   printing values. Check pg_cron/pg_net. If wiring is absent, run
   `npx supabase db query --linked --file scripts/moodle-scheduler.sql`.
   It reuses existing job names and does not embed secrets in source.
6. Deploy Next.js through the project's Vercel pipeline. This also deploys MCP;
   no separate MCP service exists. It is needed for connect/disconnect, numeric live
   IDs, canonical course listings and the two new read-only tools.
7. Run `npm run check:moodle-sync` using the authenticated Supabase CLI. It reports
   functions, migration ledger, extensions, cron schedules/results, recent HTTP
   status codes, Vault secret presence, runs and task failures.
8. Backfill/resume with
   `npx supabase db query --linked --file scripts/run-moodle-sync.sql`.
   This queues real sync work; it never manually changes completion. Cron continues
   the remaining pages. Repeating after completion starts another idempotency check.

## Verification checklist

- Both functions ACTIVE, JWT verification enabled, worker responses and runs stamped
  `2026-09-12.1`; no unexplained migration/schema mismatch.
- Cron job SQL succeeds AND corresponding HTTP responses succeed. Worker success with
  no tasks is insufficient if an active run has zero tasks or is old.
- Bootstrap succeeds (proves credential decryption and Moodle reachability), capabilities
  are freshly checked, and optional failures are inspected. A partial run is not a full
  success even when the named activities have been repaired.
- One unmerged active course per durable Moodle identity; old course pointers explicit.
- All user-owned dependent counts preserved; inspect `moodle_reconciliation_issues`.
- ECE 463 Quiz 4 / work upload and ECE 484 Product Requirements Document are completed.
- ENG Challenger Part 2, September Audience Analysis and Resumes are present/completed
  on canonical ENG 331. Resume Peer Review was incomplete in the September 12 live
  observation and must stay incomplete until Moodle changes it.
- HESF Chapter Two Quiz completion requires completion/attempt evidence. Do not infer
  it from a due date, title, grade existence or the other courses' outcomes.
- A second full sync introduces no additional canonical course/activity identities.
- Today uses the reconciled source data without class-specific filters or completion overrides.

## Production results

The repair verified five canonical active Moodle courses and no duplicate current
course-module identities. Quiz 4 (`activity:quiz:63087`), its work upload
(`activity:assign:116771`), and Product Requirements Document
(`activity:assign:107860`) became completed from Moodle. ENG forums
`71220` (Challenger Part 2), `71225` (September Audience Analysis), and `71228`
(Resumes) are present/completed on course `79833a0b-b63d-4c5a-aacd-d431d90d58c8`.
The Resume Peer Review forum remains incomplete. HESF Chapter Two Quiz has a
finished attempt; its persisted completion evidence is `attempt:finished`.
No completion overrides were created.

The first repair run `dabf3638-4eeb-40ab-84d7-70e11f7aff99` completed at
22:55:33 UTC, with 54 inserts and 273 updates. It is correctly marked partial
because it spans the deployment/debugging window and retained nine observed
failures.

The clean acceptance run `fcf25783-6e03-4f84-91f6-64d818832f60` succeeded at
23:03:11 UTC (7:03 p.m. Eastern) on September 12. All 11 tasks succeeded on their
first attempt: zero inserts, 327 updates, zero missing, zero failures. This repeat
full reconciliation introduced no new identities. No current module duplicates,
durable course duplicates, or unresolved merge issues remained. Worker HTTP responses
reported version `2026-09-12.1` and zero remaining tasks.

Migrations 012–016 and both Edge Functions are deployed to the linked Cortex project.
Next.js/MCP changes are implemented and build successfully, but their deployment is
pending Vercel authentication (the local Vercel CLI is logged out). Deploy the existing
project through its normal pipeline to activate the live numeric-ID fix, connection
routes, canonical listings, and new MCP diagnostics.

Validation: Node tests (including real worker + PostgreSQL integration), ESLint,
TypeScript, Deno Edge type checking, and Next.js webpack production build.
The pre-existing unused `resourceUrlForTests` route export was removed because
Next.js rejected it during the production build.
