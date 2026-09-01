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
      and (not deadline_tasks_only or phase in ('bootstrap', 'contents', 'events'))
    order by case phase
      when 'bootstrap' then 0
      when 'contents' then 1
      when 'events' then 2
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

create or replace function public.project_grade_completion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.academic_item_id is not null
    and (new.score is not null or new.percentage is not null or new.graded_at is not null) then
    update public.academic_items
    set status = 'completed',
        completion_state = coalesce(completion_state, 'graded'),
        completed_at = coalesce(completed_at, new.graded_at, now()),
        updated_at = now()
    where id = new.academic_item_id
      and owner_id = new.owner_id;
  end if;
  return new;
end;
$$;

drop trigger if exists grade_items_project_completion on public.grade_items;
create trigger grade_items_project_completion
after insert or update of academic_item_id, score, percentage, graded_at on public.grade_items
for each row execute function public.project_grade_completion();
