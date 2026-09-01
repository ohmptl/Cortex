-- Cortex V2: destructive replacement of the inherited Overdue data model.
create extension if not exists pgcrypto;

drop table if exists public.conflicts cascade;
drop table if exists public.assignments cascade;
drop table if exists public.integrations cascade;
drop table if exists public.courses cascade;
drop function if exists public.keep_assignment_completion_consistent() cascade;
drop function if exists public.set_updated_at() cascade;

create table public.user_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'America/New_York',
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('moodle', 'panopto')),
  instance_key text not null,
  base_url text not null,
  external_user_id text,
  external_username text,
  display_name text,
  status text not null default 'active' check (status in ('active', 'disabled', 'error')),
  last_capability_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, instance_key)
);

create table public.provider_credentials (
  connection_id uuid primary key references public.provider_connections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  encrypted_payload text not null,
  encryption_format text not null default 'aes-256-gcm-json-v1',
  key_version integer not null default 1 check (key_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_capabilities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  capability_name text not null,
  diagnostic_group text not null,
  desired boolean not null default false,
  available boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  unique(connection_id, capability_name)
);

create index provider_connections_owner_idx on public.provider_connections(owner_id, provider);
create index provider_capabilities_connection_idx on public.provider_capabilities(connection_id, diagnostic_group);
