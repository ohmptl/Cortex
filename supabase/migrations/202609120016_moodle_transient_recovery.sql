create or replace function public.recover_moodle_sync()
returns void language plpgsql security definer set search_path=public as $$
declare run record;
begin
  for run in select r.id from public.sync_runs r join public.provider_connections c on c.id=r.connection_id
    where c.provider='moodle' and r.status in('queued','running') for update of r skip locked
  loop
    -- Retry transient transport/database errors while sibling tasks keep the run
    -- active. Attempts are not reset; permanent endpoint/schema failures remain final.
    update public.sync_tasks set status='queued',available_at=now()+interval '10 seconds',claim_token=null
      where sync_run_id=run.id and status='failed' and attempts between 1 and 2
        and last_error_message ~* '(gateway timeout|timed? ?out|Moodle HTTP 5[0-9][0-9]|fetch failed|network error)';
    update public.sync_tasks set status='failed',claim_token=null,last_error_code='retry_exhausted',last_error_message='Worker lease expired three times'
      where sync_run_id=run.id and status='running' and claimed_at<now()-interval '5 minutes' and attempts>=3;
    if not exists(select 1 from public.sync_tasks where sync_run_id=run.id and status in('queued','running')) then
      update public.sync_runs set status=case when exists(select 1 from public.sync_tasks where sync_run_id=run.id and status='succeeded') then 'partial' else 'failed' end,
        finished_at=now(),error_code='recovered_unsettled_run',error_message='No runnable tasks; inspect task errors',
        failed_count=greatest(failed_count,1) where id=run.id;
    end if;
  end loop;
end $$;

-- Preserve self-referencing grade category relationships as well as external FKs.
create or replace function public.repoint_moodle_dependents(p_table regclass, p_old uuid, p_new uuid, p_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
declare fk record; child record;
begin
  for fk in
    select c.conrelid::regclass as child_table, a.attname as column_name
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid=p_table and cardinality(c.conkey)=1
      and not (c.conrelid=p_table and a.attname='merged_into_id')
  loop
    -- Row-level savepoints preserve all non-conflicting children even when another conflicts.
    for child in execute format('select ctid::text as tid, to_jsonb(t) as payload from %s t where %I=$1',fk.child_table,fk.column_name) using p_old loop
      begin
        execute format('update %s set %I=$1 where ctid=$2::tid',fk.child_table,fk.column_name) using p_new,child.tid;
      exception when unique_violation or check_violation then
        insert into public.moodle_reconciliation_issues(owner_id,entity_table,entity_id,canonical_id,reason,details)
        values(p_owner,p_table::text,p_old,p_new,'dependent_conflict:'||fk.child_table::text||':'||fk.column_name,
          jsonb_build_object('childTable',fk.child_table::text,'column',fk.column_name,'message','Conflicting dependent preserved on historical parent'))
        on conflict(entity_table,entity_id,reason) do nothing;
      end;
    end loop;
  end loop;
end $$;
