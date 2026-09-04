-- Replace outbound Panopto OAuth acquisition with an inbound, owner-scoped connector.

create table public.connector_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connector_type text not null check (connector_type = 'panopto'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_ingest_at timestamptz,
  revoked_at timestamptz
);
create unique index connector_credentials_one_active_idx
  on public.connector_credentials(owner_id, connector_type) where revoked_at is null;
create index connector_credentials_lookup_idx
  on public.connector_credentials(token_hash) where revoked_at is null;

alter table public.connector_credentials enable row level security;
create policy connector_credentials_owner_read on public.connector_credentials
  for select using (auth.uid() = owner_id);
revoke all on public.connector_credentials from anon, authenticated;

-- Panopto mappings are owner/course/folder relationships, not OAuth connections.
-- Moodle continues to use the shared provider connection tables unchanged.
alter table public.course_provider_links alter column connection_id drop not null;
alter table public.course_provider_links add column sync_since timestamptz;
alter table public.course_provider_links add constraint course_provider_links_connection_shape_check check (
  (provider = 'moodle' and connection_id is not null and link_type = 'course') or
  (provider = 'panopto' and connection_id is null and link_type = 'folder')
) not valid;

-- Preserve useful folder mappings and lecture knowledge while detaching OAuth.
update public.course_provider_links set connection_id = null, provider_url = null where provider = 'panopto';
alter table public.course_provider_links validate constraint course_provider_links_connection_shape_check;
alter table public.lectures alter column provider_connection_id drop not null;
update public.lectures set provider_connection_id = null where provider = 'panopto';
delete from public.provider_connections where provider = 'panopto';
alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check check (provider = 'moodle');

create unique index course_provider_links_one_panopto_folder_per_course_idx
  on public.course_provider_links(owner_id, course_id, provider)
  where provider = 'panopto';
create unique index course_provider_links_one_course_per_panopto_folder_idx
  on public.course_provider_links(owner_id, provider, external_id)
  where provider = 'panopto';

alter table public.lectures drop constraint if exists lectures_owner_id_provider_connection_id_provider_session_id_key;
alter table public.lectures drop column provider_connection_id;
create unique index lectures_provider_session_identity_idx
  on public.lectures(owner_id, provider, provider_session_id);
alter table public.lectures alter column duration_seconds type integer using duration_seconds::integer;
alter table public.lectures add constraint lectures_duration_sane_check
  check (duration_seconds is null or duration_seconds between 1 and 86400);

-- Older rows retained normalized text only. Preserve that knowledge in both fields;
-- connector writes from this point onward store the exact SRT/VTT in raw_content.
alter table public.lecture_transcripts rename column raw_text to plain_text;
alter table public.lecture_transcripts add column raw_content text;
update public.lecture_transcripts set raw_content = plain_text where raw_content is null;
alter table public.lecture_transcripts alter column raw_content set not null;
alter table public.lecture_transcripts rename column source_format to format;
alter table public.lecture_transcripts drop column if exists provider_modified_at;
alter table public.lecture_transcripts rename column imported_at to created_at;
alter table public.lecture_transcripts add constraint lecture_transcripts_format_check
  check (format in ('srt', 'webvtt'));
alter table public.lecture_transcripts add constraint lecture_transcripts_hash_check
  check (content_hash ~ '^[0-9a-f]{64}$');

create or replace function public.rotate_connector_credential(p_owner_id uuid, p_connector_type text, p_token_hash text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare created timestamptz;
begin
  if p_connector_type <> 'panopto' or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid connector credential'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':connector:' || p_connector_type, 0));
  update public.connector_credentials set revoked_at = now()
    where owner_id = p_owner_id and connector_type = p_connector_type and revoked_at is null;
  insert into public.connector_credentials(owner_id, connector_type, token_hash)
    values (p_owner_id, p_connector_type, p_token_hash) returning created_at into created;
  return created;
end; $$;
revoke all on function public.rotate_connector_credential(uuid,text,text) from public, anon, authenticated;
grant execute on function public.rotate_connector_credential(uuid,text,text) to service_role;

create or replace function public.revoke_connector_credential(p_owner_id uuid, p_connector_type text)
returns void language sql security definer set search_path = public as $$
  update public.connector_credentials set revoked_at = now()
    where owner_id = p_owner_id and connector_type = p_connector_type and revoked_at is null;
$$;
revoke all on function public.revoke_connector_credential(uuid,text) from public, anon, authenticated;
grant execute on function public.revoke_connector_credential(uuid,text) to service_role;

create or replace function public.ingest_panopto_lecture(
  p_owner_id uuid, p_course_id uuid, p_provider_folder_id text,
  p_provider_session_id text, p_title text, p_recorded_at timestamptz,
  p_duration_seconds integer, p_provider_url text, p_transcript_format text,
  p_transcript_language text, p_content_hash text, p_raw_content text,
  p_plain_text text, p_segments jsonb
)
returns table(status text, lecture_id uuid, segments_rebuilt boolean)
language plpgsql security definer set search_path = public as $$
declare
  existing_lecture public.lectures%rowtype;
  existing_hash text;
  existing_format text;
  transcript_uuid uuid;
  outcome text;
  rebuild boolean := false;
begin
  if not exists (select 1 from public.courses where id = p_course_id and owner_id = p_owner_id)
    then raise exception 'connector course ownership check failed'; end if;
  if not exists (
    select 1 from public.course_provider_links
    where owner_id = p_owner_id and course_id = p_course_id and provider = 'panopto'
      and link_type = 'folder' and external_id = p_provider_folder_id
  ) then raise exception 'connector folder mapping check failed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':panopto:' || p_provider_session_id, 0));
  select * into existing_lecture from public.lectures
    where owner_id = p_owner_id and provider = 'panopto'
      and provider_session_id = p_provider_session_id for update;

  if existing_lecture.id is null then
    insert into public.lectures(
      owner_id, course_id, provider, provider_session_id, provider_folder_id,
      title, recorded_at, duration_seconds, provider_url, transcript_status, transcript_language
    ) values (
      p_owner_id, p_course_id, 'panopto', p_provider_session_id, p_provider_folder_id,
      p_title, p_recorded_at, p_duration_seconds, p_provider_url, 'available', p_transcript_language
    ) returning id into lecture_id;
    outcome := 'created'; rebuild := true;
  else
    lecture_id := existing_lecture.id;
    select content_hash, format into existing_hash, existing_format from public.lecture_transcripts
      where lecture_transcripts.lecture_id = existing_lecture.id;
    if existing_lecture.course_id is not distinct from p_course_id
      and existing_lecture.provider_folder_id is not distinct from p_provider_folder_id
      and existing_lecture.title is not distinct from p_title
      and existing_lecture.recorded_at is not distinct from p_recorded_at
      and existing_lecture.duration_seconds is not distinct from p_duration_seconds
      and existing_lecture.provider_url is not distinct from p_provider_url
      and existing_lecture.transcript_language is not distinct from p_transcript_language
      and existing_lecture.transcript_status = 'available'
      and existing_hash = p_content_hash and existing_format = p_transcript_format then
      status := 'unchanged'; segments_rebuilt := false; return next; return;
    end if;
    update public.lectures set
      course_id = p_course_id, provider_folder_id = p_provider_folder_id, title = p_title,
      recorded_at = p_recorded_at, duration_seconds = p_duration_seconds,
      provider_url = p_provider_url, transcript_status = 'available',
      transcript_language = p_transcript_language
    where id = existing_lecture.id;
    outcome := 'updated'; rebuild := existing_hash is distinct from p_content_hash;
    if not rebuild then
      update public.lecture_transcripts set format = p_transcript_format, language = p_transcript_language
        where lecture_transcripts.lecture_id = existing_lecture.id;
    end if;
  end if;

  if rebuild then
    if p_plain_text is null or p_segments is null then raise exception 'connector transcript rebuild data required'; end if;
    insert into public.lecture_transcripts(
      owner_id, lecture_id, format, language, content_hash, raw_content, plain_text
    ) values (
      p_owner_id, lecture_id, p_transcript_format, p_transcript_language,
      p_content_hash, p_raw_content, p_plain_text
    ) on conflict (lecture_id) do update set
      format = excluded.format, language = excluded.language,
      content_hash = excluded.content_hash, raw_content = excluded.raw_content,
      plain_text = excluded.plain_text
    returning id into transcript_uuid;

    delete from public.lecture_segments where lecture_segments.lecture_id = ingest_panopto_lecture.lecture_id;
    insert into public.lecture_segments(
      owner_id, lecture_id, transcript_id, segment_key, ordinal,
      start_seconds, end_seconds, text, character_count, token_estimate
    )
    select p_owner_id, lecture_id, transcript_uuid, row.segment_key, row.ordinal,
      row.start_seconds, row.end_seconds, row.text, length(row.text),
      greatest(1, ceil(length(row.text) / 4.0)::integer)
    from jsonb_to_recordset(p_segments) as row(
      segment_key text, ordinal integer, start_seconds numeric, end_seconds numeric, text text
    );
  end if;

  status := outcome; segments_rebuilt := rebuild; return next;
end;
$$;

revoke all on function public.ingest_panopto_lecture(uuid,uuid,text,text,text,timestamptz,integer,text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.ingest_panopto_lecture(uuid,uuid,text,text,text,timestamptz,integer,text,text,text,text,text,text,jsonb)
  to service_role;
