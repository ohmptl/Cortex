-- Run as a database operator after configuring the two named Vault secrets.
-- Existing Cortex job names are reused, so scheduling is idempotent.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='cortex_project_url' and length(decrypted_secret)>0)
 or not exists(select 1 from vault.decrypted_secrets where name='cortex_service_role_key' and length(decrypted_secret)>0)
 then raise exception 'Configure cortex_project_url and cortex_service_role_key in Vault first'; end if;
end $$;
select cron.schedule('cortex-moodle-dispatch','*/15 * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='cortex_project_url')||'/functions/v1/moodle-sync-dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cortex_service_role_key')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
select cron.schedule('cortex-moodle-worker','* * * * *',$job$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='cortex_project_url')||'/functions/v1/moodle-sync-worker',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cortex_service_role_key')),
  body:='{}'::jsonb,timeout_milliseconds:=120000);
$job$);
