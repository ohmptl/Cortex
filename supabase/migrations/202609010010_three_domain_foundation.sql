-- Cortex V3: student state + live provider content + durable academic knowledge.
-- This migration intentionally removes the Moodle content mirror and raw payload archive.

create table public.course_provider_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  provider text not null check (provider in ('moodle', 'panopto')),
  link_type text not null check (link_type in ('course', 'folder')),
  external_id text not null,
  external_parent_id text,
  provider_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, link_type, external_id),
  unique(course_id, connection_id, link_type)
);

insert into public.course_provider_links(owner_id, course_id, connection_id, provider, link_type, external_id)
select distinct sr.owner_id, sr.course_id, sr.connection_id, sr.provider, 'course', sr.external_id
from public.source_references sr
where sr.course_id is not null and sr.object_type = 'course'
on conflict do nothing;

alter table public.academic_items
  add column provider_connection_id uuid references public.provider_connections(id) on delete set null,
  add column provider text,
  add column provider_course_id text,
  add column provider_module_id text,
  add column provider_instance_id text,
  add column provider_item_id text,
  add column provider_url text;

update public.academic_items ai set
  provider_connection_id = sr.connection_id,
  provider = sr.provider,
  provider_course_id = sr.external_course_id,
  provider_item_id = sr.external_id,
  provider_url = ai.url
from public.source_references sr
where sr.academic_item_id = ai.id;

update public.academic_items ai set provider_module_id = module_ref.external_id
from public.source_references module_ref
where ai.module_id = module_ref.course_module_id;

alter table public.grade_categories
  add column provider_connection_id uuid references public.provider_connections(id) on delete set null,
  add column provider text,
  add column provider_course_id text,
  add column provider_category_id text;

update public.grade_categories gc set
  provider_connection_id = sr.connection_id,
  provider = sr.provider,
  provider_course_id = sr.external_course_id,
  provider_category_id = sr.external_id
from public.source_references sr where sr.grade_category_id = gc.id;

alter table public.grade_items
  add column provider_connection_id uuid references public.provider_connections(id) on delete set null,
  add column provider text,
  add column provider_course_id text,
  add column provider_item_id text;

update public.grade_items gi set
  provider_connection_id = sr.connection_id,
  provider = sr.provider,
  provider_course_id = sr.external_course_id,
  provider_item_id = sr.external_id
from public.source_references sr where sr.grade_item_id = gi.id;

create table public.academic_item_source_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  academic_item_id uuid not null references public.academic_items(id) on delete cascade,
  observed_at timestamptz not null default now(),
  title text not null,
  item_type text not null,
  available_at timestamptz,
  due_at timestamptz,
  close_at timestamptz,
  completion_state text,
  submission_state text,
  content_hash text not null,
  unique(academic_item_id, content_hash)
);

create table public.grade_item_source_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  grade_item_id uuid not null references public.grade_items(id) on delete cascade,
  observed_at timestamptz not null default now(),
  score numeric,
  minimum_score numeric,
  maximum_score numeric,
  percentage numeric,
  weight numeric,
  graded_at timestamptz,
  content_hash text not null,
  unique(grade_item_id, content_hash)
);

create table public.grade_models (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  is_default boolean not null default false,
  ungraded_policy text not null default 'exclude' check (ungraded_policy in ('exclude', 'zero')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, course_id, name)
);
create unique index grade_models_one_default_idx on public.grade_models(owner_id, course_id)
  where is_default and archived_at is null;

create table public.grade_model_category_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  model_id uuid not null references public.grade_models(id) on delete cascade,
  grade_category_id uuid not null references public.grade_categories(id) on delete cascade,
  excluded boolean not null default false,
  weight_override numeric check (weight_override is null or weight_override >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(model_id, grade_category_id)
);

create table public.grade_model_item_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  model_id uuid not null references public.grade_models(id) on delete cascade,
  grade_item_id uuid not null references public.grade_items(id) on delete cascade,
  excluded boolean not null default false,
  score_override numeric,
  maximum_score_override numeric check (maximum_score_override is null or maximum_score_override > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(model_id, grade_item_id)
);

create table public.lectures (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  provider_connection_id uuid not null references public.provider_connections(id) on delete cascade,
  provider text not null default 'panopto' check (provider = 'panopto'),
  provider_session_id text not null,
  provider_folder_id text,
  title text not null,
  recorded_at timestamptz,
  duration_seconds numeric,
  instructor text,
  provider_url text,
  transcript_status text not null default 'pending' check (transcript_status in ('pending','available','unavailable','error')),
  transcript_language text,
  transcript_source_modified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider_connection_id, provider_session_id)
);

create table public.lecture_transcripts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null unique references public.lectures(id) on delete cascade,
  raw_text text not null,
  source_format text not null,
  language text,
  provider_modified_at timestamptz,
  content_hash text not null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lecture_segments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  transcript_id uuid not null references public.lecture_transcripts(id) on delete cascade,
  segment_key text not null,
  ordinal integer not null check (ordinal >= 0),
  start_seconds numeric,
  end_seconds numeric,
  text text not null check (length(trim(text)) > 0),
  character_count integer not null,
  token_estimate integer not null,
  search_vector tsvector generated always as (to_tsvector('english', text)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(lecture_id, segment_key),
  unique(lecture_id, ordinal)
);

alter table public.notes drop constraint if exists notes_check;
alter table public.notes
  add column lecture_id uuid references public.lectures(id) on delete cascade,
  add column created_by text not null default 'user' check (created_by in ('user','assistant','system')),
  add column source_type text,
  add column source_id text,
  add column source_url text,
  add column source_timestamp_seconds numeric,
  add column source_segment_id uuid references public.lecture_segments(id) on delete set null,
  add column metadata jsonb not null default '{}'::jsonb,
  add column archived_at timestamptz,
  add constraint notes_exactly_one_target check (num_nonnulls(course_id, academic_item_id, lecture_id) = 1);

create table public.knowledge_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_segment_id uuid references public.lecture_segments(id) on delete cascade,
  source_note_id uuid references public.notes(id) on delete cascade,
  target_course_id uuid references public.courses(id) on delete cascade,
  target_academic_item_id uuid references public.academic_items(id) on delete cascade,
  target_lecture_id uuid references public.lectures(id) on delete cascade,
  target_note_id uuid references public.notes(id) on delete cascade,
  relation text not null check (relation in ('MENTIONS','CLARIFIES','RELATES_TO','CORRECTS','EXPLAINS')),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  created_by text not null default 'user' check (created_by in ('user','assistant','system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(source_segment_id, source_note_id) = 1),
  check (num_nonnulls(target_course_id, target_academic_item_id, target_lecture_id, target_note_id) = 1)
);

drop view public.effective_academic_items;
alter table public.academic_items drop column module_id;
drop table public.source_references cascade;
drop table public.course_modules cascade;
drop table public.course_sections cascade;
drop table public.raw_source_record_versions cascade;
drop table public.raw_source_records cascade;

create view public.effective_academic_items with (security_invoker = true) as
select ai.*,
  case when coalesce(o.values, '{}'::jsonb) ? 'title' then o.values->>'title' else ai.title end as effective_title,
  case when coalesce(o.values, '{}'::jsonb) ? 'description' then o.values->>'description' else ai.description end as effective_description,
  case when coalesce(o.values, '{}'::jsonb) ? 'item_type' then o.values->>'item_type' else ai.item_type end as effective_item_type,
  case when coalesce(o.values, '{}'::jsonb) ? 'due_at' then (o.values->>'due_at')::timestamptz else ai.source_due_at end as effective_due_at,
  case when coalesce(o.values, '{}'::jsonb) ? 'available_at' then (o.values->>'available_at')::timestamptz else ai.source_available_at end as effective_available_at,
  case when coalesce(o.values, '{}'::jsonb) ? 'close_at' then (o.values->>'close_at')::timestamptz else ai.source_close_at end as effective_close_at,
  case when coalesce(o.values, '{}'::jsonb) ? 'url' then o.values->>'url' else ai.url end as effective_url,
  coalesce(o.values, '{}'::jsonb) as overrides
from public.academic_items ai
left join lateral (
  select jsonb_object_agg(field_name, value) as values from public.field_overrides where academic_item_id = ai.id
) o on true;

create index course_provider_links_lookup_idx on public.course_provider_links(owner_id, course_id, provider);
create index academic_items_provider_idx on public.academic_items(provider_connection_id, provider_course_id, provider_item_id);
create index grade_items_provider_idx on public.grade_items(provider_connection_id, provider_course_id, provider_item_id);
create unique index academic_items_provider_identity_idx on public.academic_items(provider_connection_id, provider_item_id)
  where provider_connection_id is not null and provider_item_id is not null;
create unique index grade_categories_provider_identity_idx on public.grade_categories(provider_connection_id, provider_category_id)
  where provider_connection_id is not null and provider_category_id is not null;
create unique index grade_items_provider_identity_idx on public.grade_items(provider_connection_id, provider_item_id)
  where provider_connection_id is not null and provider_item_id is not null;
create index lectures_course_date_idx on public.lectures(owner_id, course_id, recorded_at desc);
create index lecture_segments_lecture_idx on public.lecture_segments(lecture_id, ordinal);
create index lecture_segments_search_idx on public.lecture_segments using gin(search_vector);
create index notes_active_idx on public.notes(owner_id, archived_at) where archived_at is null;

create or replace function public.validate_knowledge_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source_segment_id is not null and not exists(select 1 from public.lecture_segments where id=new.source_segment_id and owner_id=new.owner_id) then raise exception 'knowledge source is not owned by caller'; end if;
  if new.source_note_id is not null and not exists(select 1 from public.notes where id=new.source_note_id and owner_id=new.owner_id) then raise exception 'knowledge source is not owned by caller'; end if;
  if new.target_course_id is not null and not exists(select 1 from public.courses where id=new.target_course_id and owner_id=new.owner_id) then raise exception 'knowledge target is not owned by caller'; end if;
  if new.target_academic_item_id is not null and not exists(select 1 from public.academic_items where id=new.target_academic_item_id and owner_id=new.owner_id) then raise exception 'knowledge target is not owned by caller'; end if;
  if new.target_lecture_id is not null and not exists(select 1 from public.lectures where id=new.target_lecture_id and owner_id=new.owner_id) then raise exception 'knowledge target is not owned by caller'; end if;
  if new.target_note_id is not null and not exists(select 1 from public.notes where id=new.target_note_id and owner_id=new.owner_id) then raise exception 'knowledge target is not owned by caller'; end if;
  return new;
end; $$;
create trigger validate_knowledge_ownership before insert or update on public.knowledge_links
  for each row execute function public.validate_knowledge_ownership();

create or replace function public.validate_note_ownership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.course_id is not null and not exists(select 1 from public.courses where id=new.course_id and owner_id=new.owner_id) then raise exception 'note target is not owned by caller'; end if;
  if new.academic_item_id is not null and not exists(select 1 from public.academic_items where id=new.academic_item_id and owner_id=new.owner_id) then raise exception 'note target is not owned by caller'; end if;
  if new.lecture_id is not null and not exists(select 1 from public.lectures where id=new.lecture_id and owner_id=new.owner_id) then raise exception 'note target is not owned by caller'; end if;
  if new.source_segment_id is not null and not exists(select 1 from public.lecture_segments where id=new.source_segment_id and owner_id=new.owner_id) then raise exception 'note source is not owned by caller'; end if;
  return new;
end; $$;
create trigger validate_note_ownership before insert or update on public.notes
  for each row execute function public.validate_note_ownership();

create or replace function public.protect_provider_academic_truth()
returns trigger language plpgsql as $$
begin
  if old.origin = 'provider' and auth.role() = 'authenticated' and (
    new.owner_id is distinct from old.owner_id or new.course_id is distinct from old.course_id or
    new.origin is distinct from old.origin or new.item_type is distinct from old.item_type or
    new.title is distinct from old.title or new.description is distinct from old.description or
    new.source_start_at is distinct from old.source_start_at or new.source_available_at is distinct from old.source_available_at or
    new.source_due_at is distinct from old.source_due_at or new.source_close_at is distinct from old.source_close_at or
    new.source_end_at is distinct from old.source_end_at or new.all_day is distinct from old.all_day or
    new.url is distinct from old.url or new.completion_state is distinct from old.completion_state or
    new.submission_state is distinct from old.submission_state or new.submitted_at is distinct from old.submitted_at or
    new.upstream_state is distinct from old.upstream_state or new.provider_connection_id is distinct from old.provider_connection_id or
    new.provider is distinct from old.provider or new.provider_course_id is distinct from old.provider_course_id or
    new.provider_module_id is distinct from old.provider_module_id or new.provider_instance_id is distinct from old.provider_instance_id or
    new.provider_item_id is distinct from old.provider_item_id or new.provider_url is distinct from old.provider_url
  ) then raise exception 'provider-owned academic fields are immutable; use Cortex overrides or grade models'; end if;
  return new;
end;
$$;

drop trigger if exists protect_provider_academic_truth on public.academic_items;
create trigger protect_provider_academic_truth before update on public.academic_items
  for each row execute function public.protect_provider_academic_truth();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'course_provider_links','academic_item_source_history','grade_item_source_history','grade_models',
    'grade_model_category_rules','grade_model_item_rules','lectures','lecture_transcripts','lecture_segments','knowledge_links'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy owner_access on public.%I for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id)', table_name);
  end loop;
end $$;

-- Provider mappings, source history, and provider-ingested knowledge are owner-readable but service-written.
do $$
declare table_name text;
begin
  foreach table_name in array array['course_provider_links','academic_item_source_history','grade_item_source_history','lectures','lecture_transcripts','lecture_segments'] loop
    execute format('drop policy if exists owner_access on public.%I', table_name);
    execute format('create policy owner_read on public.%I for select using (auth.uid() = owner_id)', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'course_provider_links','grade_models','grade_model_category_rules','grade_model_item_rules',
    'lectures','lecture_transcripts','lecture_segments','notes'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
  end loop;
end $$;

create or replace function public.search_lecture_transcripts(
  query_text text, course_filter uuid default null, lecture_filter uuid default null,
  from_date timestamptz default null, to_date timestamptz default null, result_limit integer default 8
)
returns table(segment_id uuid, lecture_id uuid, course_id uuid, lecture_title text, recorded_at timestamptz,
  ordinal integer, start_seconds numeric, end_seconds numeric, matched_text text, context_text text, rank real)
language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('english', query_text) value), matches as (
    select s.*, l.course_id, l.title lecture_title, l.recorded_at,
      ts_rank_cd(s.search_vector, q.value) match_rank
    from public.lecture_segments s join public.lectures l on l.id = s.lecture_id, q
    where s.owner_id = auth.uid() and s.search_vector @@ q.value
      and (course_filter is null or l.course_id = course_filter)
      and (lecture_filter is null or l.id = lecture_filter)
      and (from_date is null or l.recorded_at >= from_date)
      and (to_date is null or l.recorded_at <= to_date)
    order by match_rank desc limit greatest(1, least(result_limit, 25))
  )
  select m.id, m.lecture_id, m.course_id, m.lecture_title, m.recorded_at, m.ordinal,
    m.start_seconds, m.end_seconds, m.text,
    (select string_agg(n.text, E'\n' order by n.ordinal) from public.lecture_segments n
      where n.lecture_id = m.lecture_id and n.ordinal between m.ordinal - 1 and m.ordinal + 1),
    m.match_rank
  from matches m order by m.match_rank desc;
$$;

create or replace function public.search_academic_context(query_text text, result_limit integer default 20)
returns table(kind text, id uuid, course_id uuid, title text, excerpt text, rank real)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('english', query_text) q),
  results(kind, id, course_id, title, excerpt, rank) as (
    select 'course'::text, c.id, c.id, c.name, c.code,
      ts_rank(to_tsvector('english', coalesce(c.code,'') || ' ' || coalesce(c.name,'')), query.q)
    from public.courses c, query where c.owner_id = auth.uid()
      and to_tsvector('english', coalesce(c.code,'') || ' ' || coalesce(c.name,'')) @@ query.q
    union all
    select 'item', a.id, a.course_id, a.title, left(a.description,240),
      ts_rank(to_tsvector('english', coalesce(a.title,'') || ' ' || coalesce(a.description,'')), query.q)
    from public.academic_items a, query where a.owner_id = auth.uid() and a.upstream_state = 'present'
      and to_tsvector('english', coalesce(a.title,'') || ' ' || coalesce(a.description,'')) @@ query.q
    union all
    select 'note', n.id, coalesce(n.course_id, a.course_id, l.course_id), 'Note', left(n.body,240),
      ts_rank(to_tsvector('english', n.body), query.q)
    from public.notes n left join public.academic_items a on a.id=n.academic_item_id
      left join public.lectures l on l.id=n.lecture_id, query
    where n.owner_id=auth.uid() and n.archived_at is null and to_tsvector('english',n.body) @@ query.q
    union all
    select 'lecture_segment', s.id, l.course_id, l.title, left(s.text,240), ts_rank_cd(s.search_vector,query.q)
    from public.lecture_segments s join public.lectures l on l.id=s.lecture_id, query
    where s.owner_id=auth.uid() and s.search_vector @@ query.q
  ) select * from results order by rank desc limit greatest(1,least(result_limit,100));
$$;

revoke all on function public.search_lecture_transcripts(text,uuid,uuid,timestamptz,timestamptz,integer) from public, anon;
grant execute on function public.search_lecture_transcripts(text,uuid,uuid,timestamptz,timestamptz,integer) to authenticated;
