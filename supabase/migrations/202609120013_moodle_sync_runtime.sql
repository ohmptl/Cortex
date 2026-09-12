alter table public.sync_runs add column worker_version text;

-- Atomic queue creation. Dispatch can never leave a run with no bootstrap task.
create function public.enqueue_moodle_sync(p_connection uuid, p_trigger text default 'scheduled')
returns uuid language plpgsql security definer set search_path=public as $$
declare conn public.provider_connections; run_id uuid;
begin
  select * into strict conn from public.provider_connections where id=p_connection and provider='moodle' and status='active';
  perform pg_advisory_xact_lock(hashtextextended(p_connection::text,0));
  select id into run_id from public.sync_runs where connection_id=p_connection and status in('queued','running');
  if run_id is not null then return run_id; end if;
  if p_trigger='scheduled' and exists(select 1 from public.sync_runs where connection_id=p_connection and created_at>now()-interval '15 minutes') then return null; end if;
  insert into public.sync_runs(owner_id,connection_id,trigger_type) values(conn.owner_id,p_connection,p_trigger) returning id into run_id;
  insert into public.sync_tasks(owner_id,connection_id,sync_run_id,phase) values(conn.owner_id,p_connection,run_id,'bootstrap');
  return run_id;
end $$;

-- Lock the run BEFORE changing a task: concurrent finishers cannot leave the run
-- running because each saw another task's uncommitted status. Terminal runs never revive.
create function public.settle_moodle_task(p_task_id uuid,p_worker_token uuid,p_status text,p_counts jsonb,p_cursor jsonb,p_error text,p_version text)
returns void language plpgsql security definer set search_path=public as $$
declare task public.sync_tasks; run public.sync_runs;
begin
  if p_status not in('queued','succeeded','failed') then raise exception 'Invalid settlement status'; end if;
  select * into strict task from public.sync_tasks where id=p_task_id;
  select * into strict run from public.sync_runs where id=task.sync_run_id for update;
  if run.status not in('queued','running') then raise exception 'Run is terminal'; end if;
  update public.sync_tasks set status=p_status,cursor=p_cursor,claim_token=null,claimed_at=null,
    attempts=case when p_status='queued' then 0 else attempts end,
    last_error_code=case when p_error is not null then 'sync_phase_failed' end,last_error_message=left(p_error,1000)
  where id=p_task_id and status='running' and claim_token=p_worker_token;
  if not found then raise exception 'Task claim is no longer valid'; end if;
  update public.sync_runs set status='running',worker_version=p_version,heartbeat_at=now(),
    started_at=coalesce(started_at,now()),
    inserted_count=inserted_count+coalesce((p_counts->>'inserted')::integer,0),
    updated_count=updated_count+coalesce((p_counts->>'updated')::integer,0),
    unchanged_count=unchanged_count+coalesce((p_counts->>'unchanged')::integer,0),
    missing_count=missing_count+coalesce((p_counts->>'missing')::integer,0),
    skipped_count=skipped_count+coalesce((p_counts->>'skipped')::integer,0),
    failed_count=failed_count+coalesce((p_counts->>'failed')::integer,0),
    error_code=case when p_error is not null then 'sync_phase_failed' else error_code end,
    error_message=coalesce(left(p_error,1000),error_message)
  where id=run.id;
  if p_status='failed' and task.phase='bootstrap' then
    update public.sync_tasks set status='failed',claim_token=null,last_error_code='run_aborted' where sync_run_id=run.id and status in('queued','running');
    update public.sync_runs set status='failed',finished_at=now() where id=run.id;
  elsif not exists(select 1 from public.sync_tasks where sync_run_id=run.id and status in('queued','running')) then
    update public.sync_runs set status=case when failed_count>0 then 'partial' else 'succeeded' end,finished_at=now() where id=run.id;
  end if;
end $$;

create function public.recover_moodle_sync()
returns void language plpgsql security definer set search_path=public as $$
declare run record;
begin
  for run in select r.id from public.sync_runs r join public.provider_connections c on c.id=r.connection_id
    where c.provider='moodle' and r.status in('queued','running') for update of r skip locked
  loop
    update public.sync_tasks set status='failed',claim_token=null,last_error_code='retry_exhausted',last_error_message='Worker lease expired three times'
      where sync_run_id=run.id and status='running' and claimed_at<now()-interval '5 minutes' and attempts>=3;
    if not exists(select 1 from public.sync_tasks where sync_run_id=run.id and status in('queued','running')) then
      update public.sync_runs set status=case when exists(select 1 from public.sync_tasks where sync_run_id=run.id and status='succeeded') then 'partial' else 'failed' end,
        finished_at=now(),error_code='recovered_unsettled_run',error_message='No runnable tasks; inspect task errors',
        failed_count=greatest(failed_count,1) where id=run.id;
    end if;
  end loop;
end $$;

create or replace function public.claim_sync_tasks_for_run(worker_token uuid,requested_run_id uuid default null,task_limit integer default 5,deadline_tasks_only boolean default false)
returns setof public.sync_tasks language plpgsql security definer set search_path=public as $$
begin
  return query with candidates as (
    select t.id from public.sync_tasks t join public.sync_runs r on r.id=t.sync_run_id
      join public.provider_connections c on c.id=t.connection_id
    where c.provider='moodle' and c.status='active' and r.status in('queued','running')
      and ((t.status='queued' and t.available_at<=now()) or (t.status='running' and t.claimed_at<now()-interval '5 minutes' and t.attempts<3))
      and (requested_run_id is null or t.sync_run_id=requested_run_id)
      and (not deadline_tasks_only or t.phase in('bootstrap','contents','events'))
      -- Grade linking runs after state identity repair, never concurrently with it.
      and (t.phase<>'grades' or not exists(select 1 from public.sync_tasks s where s.sync_run_id=t.sync_run_id and s.phase in('bootstrap','contents','events') and s.status in('queued','running')))
    order by case t.phase when 'bootstrap' then 0 when 'events' then 1 when 'contents' then 1 else 2 end,t.updated_at,t.created_at
    for update of t skip locked limit greatest(1,least(task_limit,3))
  ) update public.sync_tasks t set status='running',claim_token=worker_token,claimed_at=now(),attempts=attempts+1
    from candidates c where t.id=c.id returning t.*;
end $$;

-- Old workers must fail visibly instead of using obsolete settlement semantics.
create or replace function public.finish_sync_task(p_task_id uuid,p_worker_token uuid,p_final_status text,
 p_inserted_delta integer default 0,p_updated_delta integer default 0,p_unchanged_delta integer default 0,p_missing_delta integer default 0,
 p_skipped_delta integer default 0,p_failed_delta integer default 0,p_error_code text default null,p_error_message text default null,p_mandatory_failure boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin raise exception 'Moodle worker deployment is obsolete; deploy version 2026-09-12.1'; end $$;

revoke all on function public.enqueue_moodle_sync(uuid,text),public.settle_moodle_task(uuid,uuid,text,jsonb,jsonb,text,text),public.recover_moodle_sync() from public,anon,authenticated;
grant execute on function public.enqueue_moodle_sync(uuid,text),public.settle_moodle_task(uuid,uuid,text,jsonb,jsonb,text,text),public.recover_moodle_sync() to service_role;

create or replace function public.request_moodle_sync(requested_trigger text default 'manual')
returns uuid language plpgsql security definer set search_path=public as $$
declare connection uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if requested_trigger not in('manual','mcp') then raise exception 'Invalid trigger'; end if;
  select id into connection from public.provider_connections where owner_id=auth.uid() and provider='moodle' and status='active' order by updated_at desc limit 1;
  if connection is null then raise exception 'Moodle is not connected'; end if;
  perform public.recover_moodle_sync();
  return public.enqueue_moodle_sync(connection,requested_trigger);
end $$;
