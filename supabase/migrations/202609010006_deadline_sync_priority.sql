drop function if exists public.claim_sync_tasks_for_run(uuid, uuid, integer);

create or replace function public.claim_sync_tasks_for_run(
  worker_token uuid,
  requested_run_id uuid default null,
  task_limit integer default 5,
  deadline_tasks_only boolean default false
)
returns setof public.sync_tasks language plpgsql security definer set search_path = public as $$
begin
  return query
  with candidates as (
    select id from public.sync_tasks
    where ((status = 'queued' and available_at <= now())
       or (status = 'running' and claimed_at < now() - interval '5 minutes'))
      and (requested_run_id is null or sync_run_id = requested_run_id)
      and (not deadline_tasks_only or phase in ('bootstrap', 'events'))
    order by case phase
      when 'bootstrap' then 0
      when 'events' then 1
      when 'contents' then 2
      when 'grades' then 3
      else 4
    end, created_at
    for update skip locked
    limit greatest(1, least(task_limit, 20))
  )
  update public.sync_tasks t
  set status = 'running', claim_token = worker_token, claimed_at = now(),
      attempts = attempts + 1, updated_at = now()
  from candidates c where t.id = c.id returning t.*;
end;
$$;

revoke all on function public.claim_sync_tasks_for_run(uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_sync_tasks_for_run(uuid, uuid, integer, boolean) to service_role;
