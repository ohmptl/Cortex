create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('scheduled', 'manual', 'mcp')),
  status text not null default 'queued' check (status in ('queued', 'running', 'partial', 'succeeded', 'failed', 'cancelled', 'timed_out')),
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  missing_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index sync_runs_one_active_connection_idx on public.sync_runs(connection_id)
  where status in ('queued', 'running');

create table public.sync_run_steps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  capability_name text not null,
  scope_type text not null default 'connection',
  scope_external_id text,
  status text not null default 'queued' check (status in ('queued', 'running', 'skipped', 'succeeded', 'failed')),
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  missing_count integer not null default 0,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.sync_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  phase text not null,
  scope_external_id text,
  cursor jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  claim_token uuid,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sync_run_id, phase, scope_external_id)
);

create index sync_tasks_claim_idx on public.sync_tasks(status, available_at, created_at);
create index sync_run_steps_run_idx on public.sync_run_steps(sync_run_id, created_at);
create index sync_runs_owner_created_idx on public.sync_runs(owner_id, created_at desc);

create table public.raw_source_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  provider text not null,
  object_type text not null,
  external_id text not null,
  external_course_id text,
  payload jsonb not null,
  content_hash text not null,
  upstream_state text not null default 'present' check (upstream_state in ('present', 'missing', 'deleted')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),
  last_seen_run_id uuid references public.sync_runs(id) on delete set null,
  missing_since timestamptz,
  deleted_at timestamptz,
  unique(connection_id, object_type, external_id)
);

create table public.raw_source_record_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  raw_source_record_id uuid not null references public.raw_source_records(id) on delete cascade,
  sync_run_id uuid references public.sync_runs(id) on delete set null,
  content_hash text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  unique(raw_source_record_id, content_hash)
);

create index raw_source_records_scope_idx on public.raw_source_records(connection_id, object_type, external_course_id);
create index raw_source_records_state_idx on public.raw_source_records(owner_id, upstream_state);
create index raw_source_versions_record_idx on public.raw_source_record_versions(raw_source_record_id, fetched_at desc);
