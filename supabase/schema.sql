-- Cortex assignment tracker schema (Supabase/Postgres)
-- Single-user app: every table is scoped to auth.uid() via RLS, but since
-- there is only ever one signed-in user, this mainly guards against a leaked
-- anon key rather than multi-tenant isolation.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- courses
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code text not null,
  name text not null,
  color text not null default '#3b82f6',
  instructor text,
  grade_weights jsonb not null default '[]',
  graded_items jsonb not null default '[]',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table courses enable row level security;

drop policy if exists "owner can manage own courses" on courses;
create policy "owner can manage own courses" on courses
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ─────────────────────────────────────────────────────────────────────────
-- assignments
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid references courses (id) on delete set null,
  title text not null,
  deadline timestamptz not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'completed')),
  category text not null default 'assignment'
    check (category in ('assignment','exam','quiz','homework','lab','discussion','project','event','other')),
  tags text[] not null default '{}',
  notes text,

  source text not null default 'manual' check (source in ('manual', 'gradescope', 'moodle')),
  gradescope_id text,
  gradescope_course_id text,
  moodle_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table assignments enable row level security;

drop policy if exists "owner can manage own assignments" on assignments;
create policy "owner can manage own assignments" on assignments
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists assignments_owner_deadline_idx on assignments (owner_id, deadline);
create index if not exists assignments_course_idx on assignments (course_id);
create unique index if not exists assignments_gradescope_id_idx
  on assignments (owner_id, gradescope_id) where gradescope_id is not null;
create unique index if not exists assignments_moodle_id_idx
  on assignments (owner_id, moodle_id) where moodle_id is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- conflicts — raised when a synced assignment looks like a manual duplicate
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  manual_assignment_id uuid not null references assignments (id) on delete cascade,
  source text not null check (source in ('gradescope', 'moodle')),
  source_title text not null,
  source_deadline timestamptz not null,
  source_course_id text not null,
  source_course_name text not null,
  source_data jsonb not null,
  resolved boolean not null default false,
  resolution text check (resolution in ('keep_manual', 'use_synced', 'keep_both')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table conflicts enable row level security;

drop policy if exists "owner can manage own conflicts" on conflicts;
create policy "owner can manage own conflicts" on conflicts
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create index if not exists conflicts_owner_resolved_idx on conflicts (owner_id, resolved);

-- ─────────────────────────────────────────────────────────────────────────
-- integrations — one row per service per user, holds encrypted credentials
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists integrations (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  service text not null check (service in ('gradescope', 'moodle')),

  -- Gradescope: encrypted session token. Moodle: url/username + encrypted token/password.
  email text,
  url text,
  username text,
  encrypted_credential text, -- AES-GCM ciphertext, base64
  last_sync timestamptz, -- last time a sync actually completed successfully
  last_attempt timestamptz, -- last time a sync was attempted (success or failure) — drives debounce
  syncing boolean not null default false, -- true while a sync is in flight (background or manual)
  token_expiry timestamptz,

  primary key (owner_id, service)
);

-- safe to re-run against an existing database — adds the new columns if missing
alter table integrations add column if not exists last_attempt timestamptz;
alter table integrations add column if not exists syncing boolean not null default false;

alter table integrations enable row level security;

drop policy if exists "owner can manage own integrations" on integrations;
create policy "owner can manage own integrations" on integrations
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- keep assignments.updated_at current on every update
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists assignments_set_updated_at on assignments;
create trigger assignments_set_updated_at
  before update on assignments
  for each row execute function set_updated_at();
