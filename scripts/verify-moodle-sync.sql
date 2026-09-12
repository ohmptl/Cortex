begin read only;
select jsonb_build_object(
 'canonicalCourses',(select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'active',c.active,'externalId',l.external_id)) from courses c join course_provider_links l on l.course_id=c.id and l.provider='moodle' where c.merged_into_id is null),
 'duplicateDurableCourses',(select jsonb_agg(to_jsonb(d)) from (select owner_id,site_key,account_key,external_id,count(*) from course_provider_links where provider='moodle' group by owner_id,site_key,account_key,external_id having count(*)>1) d),
 'duplicateCurrentModules',(select jsonb_agg(to_jsonb(d)) from (select provider_connection_id,provider_module_id,count(*) from academic_items where provider='moodle' and upstream_state='present' and merged_into_id is null and provider_module_id is not null group by provider_connection_id,provider_module_id having count(*)>1) d),
 'knownItems',(select jsonb_agg(jsonb_build_object('id',a.id,'course',c.code,'title',a.title,'status',a.status,'completion',a.completion_state,'upstream',a.upstream_state,'canonical',a.provider_item_id,'due',a.source_due_at,'mergedInto',a.merged_into_id)) from academic_items a join courses c on c.id=a.course_id where a.title='Quiz 4' or a.title='Quiz 4: upload file(s) that show your work' or a.title='Product Requirements Document' or a.title='Chapter Two Quiz' or a.title ilike '%Post to Challenger: Part 2%' or a.title ilike '%Post to Audience Analysis%' or a.title ilike '%Post to Resumes%' or a.title ilike '%Post to the Resume Peer Review Forum%'),
 'recentRuns',(select jsonb_agg(to_jsonb(r)) from (select id,status,trigger_type,started_at,finished_at,worker_version,inserted_count,updated_count,missing_count,failed_count from sync_runs order by created_at desc limit 3) r),
 'recentFailures',(select jsonb_agg(to_jsonb(s)) from (select capability_name,scope_external_id,error_message,created_at from sync_run_steps where status='failed' order by created_at desc limit 8) s),
 'issues',(select coalesce(jsonb_agg(to_jsonb(i)),'[]') from moodle_reconciliation_issues i)
) verification;
commit;
