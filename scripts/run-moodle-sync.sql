-- Operator backfill/resume. Uses existing Vault credentials without returning them.
select public.recover_moodle_sync();
select public.enqueue_moodle_sync(id,'manual') from public.provider_connections where provider='moodle' and status='active';
select net.http_post(
 url:=(select decrypted_secret from vault.decrypted_secrets where name='cortex_project_url')||'/functions/v1/moodle-sync-worker',
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='cortex_service_role_key')),
 body:='{}'::jsonb,timeout_milliseconds:=120000) request_id;
