create function public.get_moodle_sync_status(p_run_id uuid default null)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare conn uuid; connection jsonb; runs jsonb; active jsonb; success jsonb; tasks jsonb; steps jsonb;
begin
  select c.id,jsonb_build_object('id',c.id,'connected',c.status='active','status',c.status,'baseUrl',c.base_url,'lastCapabilityCheckAt',c.last_capability_check_at)
  into conn,connection from public.provider_connections c where c.owner_id=auth.uid() and c.provider='moodle'
    and (p_run_id is null or c.id=(select connection_id from public.sync_runs where id=p_run_id and owner_id=auth.uid()))
    order by (c.status='active') desc,c.updated_at desc limit 1;
  if conn is null then return jsonb_build_object('connected',false); end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]') into runs from
    (select * from public.sync_runs where connection_id=conn and (p_run_id is null or id=p_run_id) order by created_at desc limit 20) r;
  select to_jsonb(r) into active from public.sync_runs r where connection_id=conn and status in('queued','running') limit 1;
  select to_jsonb(r) into success from public.sync_runs r where connection_id=conn and status='succeeded' order by finished_at desc limit 1;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into tasks from (
    select id,sync_run_id,phase,scope_external_id,status,attempts,available_at,claimed_at,last_error_code,last_error_message,updated_at
    from public.sync_tasks where connection_id=conn and (p_run_id is null or sync_run_id=p_run_id)
      and (p_run_id is not null or status in('queued','running','failed')) order by updated_at desc limit 200) t;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]') into steps from (
    select s.* from public.sync_run_steps s join public.sync_runs r on r.id=s.sync_run_id where r.connection_id=conn
      and (p_run_id is null or r.id=p_run_id) and (p_run_id is not null or s.status='failed') order by s.created_at desc limit 100) s;
  return jsonb_build_object('connected',connection->'connected','connection',connection,'latestRun',runs->0,'recentRuns',runs,'activeRun',active,
    'lastSuccessfulRun',success,'tasks',tasks,'steps',steps,
    'taskCounts',(select jsonb_build_object('queued',count(*) filter(where status='queued'),'running',count(*) filter(where status='running'),'failed',count(*) filter(where status='failed')) from public.sync_tasks where connection_id=conn),
    'capabilities',(select coalesce(jsonb_agg(jsonb_build_object('name',capability_name,'available',available,'desired',desired,'checkedAt',checked_at)),'[]') from public.provider_capabilities where connection_id=conn),
    'reconciliationIssues',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from public.moodle_reconciliation_issues i where owner_id=auth.uid()),
    'expectedSchedule',jsonb_build_object('dispatchMinutes',15,'workerMinutes',1,'verified',false),
    'expectedWorkerVersion','2026-09-12.1',
    'workerVersionCurrent',case when runs->0->>'worker_version' is null then null else runs->0->>'worker_version'='2026-09-12.1' end);
end $$;
revoke all on function public.get_moodle_sync_status(uuid) from public,anon;
grant execute on function public.get_moodle_sync_status(uuid) to authenticated;

-- Operator-only, credential-free wiring diagnostic. Extension absence is data, not a SQL error.
create function public.moodle_runtime_diagnostics()
returns jsonb language plpgsql security definer set search_path=public as $$
declare jobs jsonb:='[]'; executions jsonb:='[]'; requests jsonb:='[]'; secrets jsonb:='{}';
begin
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''name'',jobname,''schedule'',schedule,''active'',active)),''[]'') from cron.job where jobname in(''cortex-moodle-dispatch'',''cortex-moodle-worker'')' into jobs;
    execute 'select coalesce(jsonb_agg(to_jsonb(r)),''[]'') from (select j.jobname,d.status,d.return_message,d.start_time,d.end_time from cron.job_run_details d join cron.job j using(jobid) where j.jobname in(''cortex-moodle-dispatch'',''cortex-moodle-worker'') order by d.start_time desc limit 20) r' into executions;
  end if;
  if to_regclass('net._http_response') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(r)),''[]'') from (select id,status_code,timed_out,created from net._http_response order by created desc limit 20) r' into requests;
  end if;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select jsonb_build_object(''project_url'',exists(select 1 from vault.decrypted_secrets where name=''cortex_project_url'' and length(decrypted_secret)>0),''service_role_key'',exists(select 1 from vault.decrypted_secrets where name=''cortex_service_role_key'' and length(decrypted_secret)>0))' into secrets;
  end if;
  return jsonb_build_object('schemaVersion','202609120014','extensions',(select jsonb_agg(extname) from pg_extension where extname in('pg_cron','pg_net','supabase_vault')),
    'cronJobs',jobs,'recentCronExecutions',executions,'recentHttpResponses',requests,'vaultSecretsPresent',secrets,
    'activeRuns',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.sync_runs r where status in('queued','running')),
    'recentRuns',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (select * from public.sync_runs order by created_at desc limit 20) r),
    'taskFailures',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from (select id,sync_run_id,phase,status,attempts,last_error_code,last_error_message from public.sync_tasks where status='failed' order by updated_at desc limit 30) t));
end $$;
revoke all on function public.moodle_runtime_diagnostics() from public,anon,authenticated;
grant execute on function public.moodle_runtime_diagnostics() to service_role;
