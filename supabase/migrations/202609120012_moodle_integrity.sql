-- Durable identities outlive credentials; historical parents remain addressable.
alter table public.course_provider_links add column site_key text, add column account_key text;
update public.course_provider_links l set site_key = regexp_replace(c.base_url, '/+$', ''), account_key = c.external_user_id
from public.provider_connections c where c.id=l.connection_id and l.provider='moodle';
alter table public.course_provider_links drop constraint if exists course_provider_links_connection_shape_check;
alter table public.course_provider_links add constraint course_provider_links_connection_shape_check check (
 (provider='moodle' and link_type='course') or (provider='panopto' and link_type='folder'));
alter table public.course_provider_links drop constraint course_provider_links_connection_id_fkey;
alter table public.course_provider_links alter column connection_id drop not null;
alter table public.course_provider_links add foreign key(connection_id) references public.provider_connections(id) on delete set null;
create unique index course_provider_links_durable_moodle_idx
on public.course_provider_links(owner_id, provider, site_key, account_key, external_id)
where provider='moodle' and link_type='course';
alter table public.courses add column merged_into_id uuid references public.courses(id);
alter table public.academic_items add column merged_into_id uuid references public.academic_items(id);

create table public.moodle_reconciliation_issues (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  entity_table text not null, entity_id uuid not null, canonical_id uuid,
  reason text not null, details jsonb not null default '{}', created_at timestamptz not null default now(),
  unique(entity_table, entity_id, reason)
);
alter table public.moodle_reconciliation_issues enable row level security;
create policy owner_read on public.moodle_reconciliation_issues for select using (owner_id=auth.uid());

-- Repoint every FK, including future dependents. Conflicting children remain on the
-- historical parent, intact, and are reported; parents are NEVER deleted.
create function public.repoint_moodle_dependents(p_table regclass, p_old uuid, p_new uuid, p_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
declare fk record; child record;
begin
  for fk in
    select c.conrelid::regclass as child_table, a.attname as column_name
    from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid=p_table and cardinality(c.conkey)=1
      and c.conrelid<>p_table
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

create function public.merge_moodle_course(p_old uuid, p_new uuid, p_owner uuid)
returns void language plpgsql security definer set search_path=public as $$
declare model record;
begin
  if p_old=p_new then return; end if;
  if (select count(*) from public.courses where id in(p_old,p_new) and owner_id=p_owner)<>2 then raise exception 'Course ownership mismatch'; end if;
  -- Personal grade models keep all rules; disambiguate names rather than dropping them.
  for model in select * from public.grade_models where course_id=p_old loop
    update public.grade_models set
      name=case when exists(select 1 from public.grade_models where course_id=p_new and name=model.name)
        then model.name||' (recovered '||model.id||')' else model.name end,
      is_default=case when exists(select 1 from public.grade_models where course_id=p_new and is_default and archived_at is null)
        then false else model.is_default end,
      course_id=p_new where id=model.id;
  end loop;
  perform public.repoint_moodle_dependents('public.courses',p_old,p_new,p_owner);
  update public.courses set active=false,merged_into_id=p_new where id=p_old;
end $$;

create function public.reconcile_moodle_course(p_connection uuid, p_external text, p_code text, p_name text, p_active boolean)
returns uuid language plpgsql security definer set search_path=public as $$
declare conn public.provider_connections; canonical uuid; candidate record;
begin
  select * into strict conn from public.provider_connections where id=p_connection and provider='moodle' and status='active';
  if coalesce(conn.external_user_id,'')='' or coalesce(p_external,'')='' then raise exception 'Moodle account/course identity is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(conn.owner_id||':'||conn.base_url||':'||conn.external_user_id||':'||p_external,0));
  select course_id into canonical from public.course_provider_links where owner_id=conn.owner_id and provider='moodle' and link_type='course'
    and site_key=regexp_replace(conn.base_url,'/+$','') and account_key=conn.external_user_id and external_id=p_external;
  if canonical is null then
    select course_id into canonical from public.course_provider_links where connection_id=p_connection and link_type='course' and external_id=p_external;
  end if;
  -- A connection lost before this migration also lost its account provenance.
  -- Recover only when the owner has a single known Moodle account on this site and
  -- every provider item on the candidate agrees on site and external course.
  for candidate in
    select c.id from public.courses c where c.owner_id=conn.owner_id and c.merged_into_id is null
      and exists(select 1 from public.academic_items a where a.course_id=c.id and a.provider='moodle' and a.provider_course_id=p_external
        and starts_with(coalesce(a.provider_url,a.url,''),regexp_replace(conn.base_url,'/+$','')||'/'))
      and not exists(select 1 from public.academic_items a where a.course_id=c.id and a.provider='moodle' and (
        a.provider_course_id is distinct from p_external or not starts_with(coalesce(a.provider_url,a.url,''),regexp_replace(conn.base_url,'/+$','')||'/')))
      and not exists(select 1 from public.course_provider_links l where l.course_id=c.id and l.provider='moodle'
        and (l.site_key is distinct from regexp_replace(conn.base_url,'/+$','') or l.account_key is distinct from conn.external_user_id or l.external_id<>p_external))
      and not exists(select 1 from public.provider_connections pc where pc.owner_id=conn.owner_id and pc.provider='moodle' and pc.base_url=conn.base_url
        and pc.external_user_id is distinct from conn.external_user_id)
    order by c.created_at,c.id
  loop
    if canonical is null then canonical:=candidate.id;
    elsif canonical<>candidate.id then perform public.merge_moodle_course(candidate.id,canonical,conn.owner_id); end if;
  end loop;
  if canonical is null then
    insert into public.courses(owner_id,code,name,active) values(conn.owner_id,p_code,p_name,p_active) returning id into canonical;
  else update public.courses set code=p_code,name=p_name,active=p_active where id=canonical; end if;
  insert into public.course_provider_links(owner_id,course_id,connection_id,provider,link_type,external_id,provider_url,site_key,account_key)
  values(conn.owner_id,canonical,p_connection,'moodle','course',p_external,conn.base_url||'/course/view.php?id='||p_external,regexp_replace(conn.base_url,'/+$',''),conn.external_user_id)
  on conflict(owner_id,provider,site_key,account_key,external_id) where provider='moodle' and link_type='course'
  do update set connection_id=excluded.connection_id,course_id=excluded.course_id;
  return canonical;
end $$;

-- Called with freshly resolved module + instance IDs. The URL is an exact module
-- view URL, never a title match. It repairs old CMID-as-instance identities too.
create function public.reconcile_moodle_item(p_connection uuid, p_course uuid, p_external_course text,
  p_identity text, p_module text, p_url text, p_aliases text[] default '{}')
returns uuid language plpgsql security definer set search_path=public as $$
declare conn public.provider_connections; canonical uuid; candidate record;
begin
  select * into strict conn from public.provider_connections where id=p_connection and provider='moodle' and status='active';
  if not exists(select 1 from public.course_provider_links where connection_id=p_connection and course_id=p_course and external_id=p_external_course) then
    raise exception 'Course mapping does not belong to connection'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_connection||':'||p_identity,0));
  for candidate in select a.* from public.academic_items a
    where a.owner_id=conn.owner_id and a.origin='provider' and a.provider='moodle' and a.course_id=p_course and a.merged_into_id is null
      and (a.provider_connection_id=p_connection or a.provider_connection_id is null)
      and (a.provider_item_id=p_identity or a.provider_item_id=any(p_aliases)
        or (p_module is not null and a.provider_module_id=p_module)
        or (p_url is not null and coalesce(a.provider_url,a.url)=p_url))
    order by (a.provider_connection_id=p_connection and a.provider_item_id=p_identity) desc nulls last,a.created_at,a.id
  loop
    if canonical is null then canonical:=candidate.id;
    else
      perform public.repoint_moodle_dependents('public.academic_items',candidate.id,canonical,conn.owner_id);
      update public.academic_items set upstream_state='missing',merged_into_id=canonical,provider_connection_id=null where id=candidate.id;
    end if;
  end loop;
  if canonical is not null then
    update public.academic_items set provider_connection_id=p_connection,provider_course_id=p_external_course,provider_item_id=p_identity,
      provider_module_id=coalesce(p_module,provider_module_id) where id=canonical;
  end if;
  return canonical;
end $$;

-- Disable credentials atomically while keeping mappings, diagnostics and identities.
create function public.disconnect_moodle()
returns void language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.provider_connections set status='disabled' where owner_id=auth.uid() and provider='moodle';
  delete from public.provider_credentials where owner_id=auth.uid() and connection_id in(select id from public.provider_connections where owner_id=auth.uid() and provider='moodle');
  update public.sync_tasks set status='failed',claim_token=null,last_error_code='disconnected',last_error_message='Moodle disconnected'
    where owner_id=auth.uid() and connection_id in(select id from public.provider_connections where owner_id=auth.uid() and provider='moodle') and status in('queued','running');
  update public.sync_runs set status='cancelled',finished_at=now() where owner_id=auth.uid()
    and connection_id in(select id from public.provider_connections where owner_id=auth.uid() and provider='moodle') and status in('queued','running');
end $$;
-- Prevent an authenticated direct DELETE from reintroducing the old bug.
drop policy if exists owner_delete on public.provider_connections;
create policy owner_delete_panopto on public.provider_connections for delete using(auth.uid()=owner_id and provider<>'moodle');

-- A grade can exist before the student's work is done. Completion belongs to state sync.
drop trigger if exists grade_items_project_completion on public.grade_items;

revoke all on function public.repoint_moodle_dependents(regclass,uuid,uuid,uuid),
  public.merge_moodle_course(uuid,uuid,uuid),public.reconcile_moodle_course(uuid,text,text,text,boolean),
  public.reconcile_moodle_item(uuid,uuid,text,text,text,text,text[]) from public,anon,authenticated;
grant execute on function public.repoint_moodle_dependents(regclass,uuid,uuid,uuid),
  public.merge_moodle_course(uuid,uuid,uuid),public.reconcile_moodle_course(uuid,text,text,text,boolean),
  public.reconcile_moodle_item(uuid,uuid,text,text,text,text,text[]) to service_role;
revoke all on function public.disconnect_moodle() from public,anon;
grant execute on function public.disconnect_moodle() to authenticated;

-- Safe, idempotent repair of current mappings; activity aliases are repaired using
-- fresh provider evidence by the subsequent full worker run.
do $$ declare link record; orphan record; begin
  for link in select l.*,c.code,c.name,c.active from public.course_provider_links l join public.courses c on c.id=l.course_id
    join public.provider_connections pc on pc.id=l.connection_id where l.provider='moodle' and pc.status='active' and pc.external_user_id is not null
  loop perform public.reconcile_moodle_course(link.connection_id,link.external_id,link.code,link.name,link.active); end loop;
  for orphan in select c.* from public.courses c where c.merged_into_id is null
    and not exists(select 1 from public.course_provider_links l where l.course_id=c.id and l.provider='moodle')
  loop
    insert into public.moodle_reconciliation_issues(owner_id,entity_table,entity_id,reason,details)
    values(orphan.owner_id,'courses',orphan.id,'unmapped_course',jsonb_build_object('message','No provable Moodle identity; inspect historical account/site/course evidence before merging'))
    on conflict do nothing;
  end loop;
end $$;

-- Verification happens in Next.js; the verified identity, credential and capabilities
-- become visible atomically. Dispatch never sees active-without-credentials.
create function public.connect_moodle(p_owner uuid,p_site text,p_user text,p_username text,p_display text,p_encrypted text,p_capabilities jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare connection uuid; cap jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner||':'||p_site||':'||p_user,0));
  select id into connection from public.provider_connections where owner_id=p_owner and provider='moodle' and base_url=p_site and external_user_id=p_user order by created_at limit 1;
  if connection is null then
    insert into public.provider_connections(owner_id,provider,instance_key,base_url,external_user_id)
    values(p_owner,'moodle',p_site||'#user:'||p_user,p_site,p_user) returning id into connection;
  end if;
  insert into public.provider_credentials(connection_id,owner_id,encrypted_payload) values(connection,p_owner,p_encrypted)
    on conflict(connection_id) do update set encrypted_payload=excluded.encrypted_payload;
  update public.provider_connections set status='active',external_username=p_username,display_name=p_display,last_capability_check_at=now() where id=connection;
  for cap in select * from jsonb_array_elements(p_capabilities) loop
    insert into public.provider_capabilities(owner_id,connection_id,capability_name,diagnostic_group,desired,available,checked_at)
    values(p_owner,connection,cap->>'name',cap->>'group',(cap->>'desired')::boolean,(cap->>'available')::boolean,now())
    on conflict(connection_id,capability_name) do update set desired=excluded.desired,available=excluded.available,checked_at=now();
  end loop;
  return connection;
end $$;
revoke all on function public.connect_moodle(uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.connect_moodle(uuid,text,text,text,text,text,jsonb) to service_role;

alter table public.grade_items add column merged_into_id uuid references public.grade_items(id);
alter table public.grade_categories add column merged_into_id uuid references public.grade_categories(id);
create function public.reconcile_moodle_grade(p_connection uuid,p_course uuid,p_external_course text,p_external text,p_category boolean default false)
returns uuid language plpgsql security definer set search_path=public as $$
declare conn public.provider_connections; canonical uuid; candidate record;
 tbl text:=case when p_category then 'grade_categories' else 'grade_items' end;
 key text:=case when p_category then 'provider_category_id' else 'provider_item_id' end;
begin
 select * into strict conn from public.provider_connections where id=p_connection and status='active';
 if not exists(select 1 from public.course_provider_links where connection_id=p_connection and course_id=p_course and external_id=p_external_course) then raise exception 'Invalid course mapping'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_connection||':'||tbl||':'||p_external,0));
 for candidate in execute format('select id from public.%I where owner_id=$1 and course_id=$2 and provider=''moodle'' and %I=$3 and merged_into_id is null and (provider_connection_id=$4 or provider_connection_id is null) order by (provider_connection_id=$4) desc nulls last,created_at,id',tbl,key)
 using conn.owner_id,p_course,p_external,p_connection loop
  if canonical is null then canonical:=candidate.id;
  else
   perform public.repoint_moodle_dependents(('public.'||tbl)::regclass,candidate.id,canonical,conn.owner_id);
   execute format('update public.%I set merged_into_id=$1,provider_connection_id=null where id=$2',tbl) using canonical,candidate.id;
  end if;
 end loop;
 if canonical is not null then execute format('update public.%I set provider_connection_id=$1,provider_course_id=$2 where id=$3',tbl) using p_connection,p_external_course,canonical; end if;
 return canonical;
end $$;
revoke all on function public.reconcile_moodle_grade(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.reconcile_moodle_grade(uuid,uuid,text,text,boolean) to service_role;
