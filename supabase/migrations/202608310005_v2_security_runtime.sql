create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings', 'provider_connections', 'provider_credentials', 'sync_tasks',
    'courses', 'course_sections', 'course_modules', 'academic_items', 'field_overrides',
    'notes', 'grade_categories', 'grade_items', 'source_references'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name);
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings', 'provider_connections', 'provider_capabilities', 'sync_runs',
    'sync_run_steps', 'sync_tasks', 'raw_source_records', 'raw_source_record_versions',
    'courses', 'course_sections', 'course_modules', 'academic_items', 'field_overrides',
    'academic_item_relations', 'notes', 'tags', 'academic_item_tags', 'grade_categories',
    'grade_items', 'source_references'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists owner_access on public.%I', table_name);
    execute format(
      'create policy owner_access on public.%I for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id)',
      table_name
    );
  end loop;
end $$;

alter table public.provider_credentials enable row level security;
revoke all on public.provider_credentials from anon, authenticated;
revoke all on public.raw_source_record_versions from anon;

-- Provider truth, provenance, gradebook, and synchronization diagnostics are
-- readable by their owner but writable only through service-role ingestion.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'provider_capabilities', 'sync_runs', 'sync_run_steps', 'sync_tasks',
    'raw_source_records', 'raw_source_record_versions', 'courses', 'course_sections',
    'course_modules', 'grade_categories', 'grade_items', 'source_references'
  ] loop
    execute format('drop policy if exists owner_access on public.%I', table_name);
    execute format('create policy owner_read on public.%I for select using (auth.uid() = owner_id)', table_name);
  end loop;
end $$;

drop policy if exists owner_access on public.provider_connections;
create policy owner_read on public.provider_connections for select using (auth.uid() = owner_id);
create policy owner_delete on public.provider_connections for delete using (auth.uid() = owner_id);

drop policy if exists owner_access on public.academic_items;
create policy owner_read on public.academic_items for select using (auth.uid() = owner_id);
create policy owner_insert_manual on public.academic_items for insert
  with check (auth.uid() = owner_id and origin = 'manual');
create policy owner_update_state on public.academic_items for update
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy owner_delete_manual on public.academic_items for delete
  using (auth.uid() = owner_id and origin = 'manual');

create or replace function public.protect_provider_academic_truth()
returns trigger language plpgsql as $$
begin
  if old.origin = 'provider' and auth.role() = 'authenticated' and (
    new.owner_id is distinct from old.owner_id or
    new.course_id is distinct from old.course_id or
    new.module_id is distinct from old.module_id or
    new.origin is distinct from old.origin or
    new.item_type is distinct from old.item_type or
    new.title is distinct from old.title or
    new.description is distinct from old.description or
    new.source_start_at is distinct from old.source_start_at or
    new.source_available_at is distinct from old.source_available_at or
    new.source_due_at is distinct from old.source_due_at or
    new.source_close_at is distinct from old.source_close_at or
    new.source_end_at is distinct from old.source_end_at or
    new.all_day is distinct from old.all_day or
    new.url is distinct from old.url or
    new.completion_state is distinct from old.completion_state or
    new.submission_state is distinct from old.submission_state or
    new.submitted_at is distinct from old.submitted_at or
    new.upstream_state is distinct from old.upstream_state
  ) then
    raise exception 'provider-owned academic fields are immutable; use field_overrides';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_provider_academic_truth on public.academic_items;
create trigger protect_provider_academic_truth before update on public.academic_items
  for each row execute function public.protect_provider_academic_truth();

create or replace function public.request_moodle_sync(requested_trigger text default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  owner uuid := auth.uid();
  connection uuid;
  run_id uuid;
begin
  if owner is null then raise exception 'authentication required'; end if;
  if requested_trigger not in ('manual', 'mcp') then raise exception 'invalid trigger'; end if;
  select id into connection from public.provider_connections
    where owner_id = owner and provider = 'moodle' and status = 'active'
    order by created_at desc limit 1;
  if connection is null then raise exception 'Moodle is not connected'; end if;
  perform pg_advisory_xact_lock(hashtextextended(connection::text, 0));
  select id into run_id from public.sync_runs
    where connection_id = connection and status in ('queued', 'running')
    order by created_at desc limit 1;
  if run_id is not null then return run_id; end if;
  insert into public.sync_runs(owner_id, connection_id, trigger_type)
    values (owner, connection, requested_trigger) returning id into run_id;
  insert into public.sync_tasks(owner_id, sync_run_id, connection_id, phase)
    values (owner, run_id, connection, 'bootstrap');
  return run_id;
end;
$$;

create or replace function public.claim_sync_tasks(worker_token uuid, task_limit integer default 5)
returns setof public.sync_tasks language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select id from public.sync_tasks
    where (status = 'queued' and available_at <= now())
       or (status = 'running' and claimed_at < now() - interval '5 minutes')
    order by created_at for update skip locked
    limit greatest(1, least(task_limit, 20))
  )
  update public.sync_tasks t
  set status = 'running', claim_token = worker_token, claimed_at = now(),
      attempts = attempts + 1, updated_at = now()
  from candidates c where t.id = c.id returning t.*;
end;
$$;

revoke all on function public.claim_sync_tasks(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_sync_tasks(uuid, integer) to service_role;
revoke all on function public.request_moodle_sync(text) from public, anon;
grant execute on function public.request_moodle_sync(text) to authenticated;

create or replace function public.finish_sync_task(
  p_task_id uuid,
  p_worker_token uuid,
  p_final_status text,
  p_inserted_delta integer default 0,
  p_updated_delta integer default 0,
  p_unchanged_delta integer default 0,
  p_missing_delta integer default 0,
  p_skipped_delta integer default 0,
  p_failed_delta integer default 0,
  p_error_code text default null,
  p_error_message text default null,
  p_mandatory_failure boolean default false
)
returns void language plpgsql security definer set search_path = public as $$
declare run_id uuid;
begin
  if p_final_status not in ('succeeded', 'failed') then raise exception 'invalid task status'; end if;
  update public.sync_tasks set status = p_final_status, last_error_code = p_error_code,
    last_error_message = left(p_error_message, 1000), updated_at = now()
  where id = p_task_id and claim_token = p_worker_token returning sync_run_id into run_id;
  if run_id is null then raise exception 'task claim is no longer valid'; end if;

  update public.sync_runs set
    status = case when p_mandatory_failure then 'failed' else 'running' end,
    inserted_count = inserted_count + p_inserted_delta,
    updated_count = updated_count + p_updated_delta,
    unchanged_count = unchanged_count + p_unchanged_delta,
    missing_count = missing_count + p_missing_delta,
    skipped_count = skipped_count + p_skipped_delta,
    failed_count = failed_count + p_failed_delta,
    error_code = case when p_mandatory_failure then p_error_code else sync_runs.error_code end,
    error_message = case when p_mandatory_failure then left(p_error_message, 1000) else sync_runs.error_message end,
    heartbeat_at = now(),
    finished_at = case when p_mandatory_failure then now() else finished_at end
  where id = run_id;

  if p_mandatory_failure then
    update public.sync_tasks set status = 'failed', last_error_code = 'run_aborted',
      last_error_message = 'A mandatory synchronization phase failed', updated_at = now()
    where sync_run_id = run_id and status = 'queued';
  elsif not exists (select 1 from public.sync_tasks where sync_run_id = run_id and status in ('queued', 'running')) then
    update public.sync_runs set
      status = case when failed_count > 0 then 'partial' else 'succeeded' end,
      finished_at = now(), heartbeat_at = now()
    where id = run_id;
  end if;
end;
$$;

revoke all on function public.finish_sync_task(uuid, uuid, text, integer, integer, integer, integer, integer, integer, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_sync_task(uuid, uuid, text, integer, integer, integer, integer, integer, integer, text, text, boolean)
  to service_role;

create or replace function public.search_academic_context(query_text text, result_limit integer default 20)
returns table(kind text, id uuid, course_id uuid, title text, excerpt text, rank real)
language sql stable security invoker set search_path = public as $$
  with query as (select websearch_to_tsquery('english', query_text) q), results as (
    select 'course'::text kind, c.id, c.id course_id, c.name title, c.code excerpt,
      ts_rank(to_tsvector('english', coalesce(c.code, '') || ' ' || coalesce(c.name, '')), query.q) rank
    from public.courses c, query
    where c.owner_id = auth.uid() and to_tsvector('english', coalesce(c.code, '') || ' ' || coalesce(c.name, '')) @@ query.q
    union all
    select 'item', a.id, a.course_id, a.title, left(a.description, 240),
      ts_rank(to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.description, '')), query.q)
    from public.academic_items a, query
    where a.owner_id = auth.uid() and a.upstream_state = 'present'
      and to_tsvector('english', coalesce(a.title, '') || ' ' || coalesce(a.description, '')) @@ query.q
    union all
    select 'module', m.id, m.course_id, m.title, left(m.description, 240),
      ts_rank(to_tsvector('english', coalesce(m.title, '') || ' ' || coalesce(m.description, '')), query.q)
    from public.course_modules m, query
    where m.owner_id = auth.uid()
      and to_tsvector('english', coalesce(m.title, '') || ' ' || coalesce(m.description, '')) @@ query.q
    union all
    select 'note', n.id, n.course_id, 'Note', left(n.body, 240),
      ts_rank(to_tsvector('english', n.body), query.q)
    from public.notes n, query
    where n.owner_id = auth.uid() and to_tsvector('english', n.body) @@ query.q
  )
  select * from results order by rank desc limit greatest(1, least(result_limit, 100));
$$;

revoke all on function public.search_academic_context(text, integer) from public, anon;
grant execute on function public.search_academic_context(text, integer) to authenticated;

-- Deployment creates Vault-backed pg_cron calls for a 15-minute dispatcher and
-- a one-minute bounded worker. Project URLs and credentials remain outside SQL.
