do $$
declare duplicate record;
begin
  for duplicate in
    with event_map as (
      select e.connection_id, e.external_id as event_id,
        e.payload->>'modulename' as module_name,
        e.payload->>'instance' as old_instance,
        m.payload->>'instance' as canonical_instance
      from public.raw_source_records e
      join public.raw_source_records m
        on m.connection_id = e.connection_id
       and m.object_type = 'course-module'
       and m.external_id = substring(e.payload->>'url' from '[?&]id=([0-9]+)')
      where e.object_type = 'calendar-event'
    )
    select distinct old_ref.id as old_reference_id,
      old_ref.academic_item_id as old_item_id
    from event_map em
    join public.source_references old_ref
      on old_ref.connection_id = em.connection_id
     and old_ref.object_type = 'academic-item'
     and old_ref.external_id = 'activity:' || em.module_name || ':' || em.old_instance
    join public.source_references canonical_ref
      on canonical_ref.connection_id = em.connection_id
     and canonical_ref.object_type = 'academic-item'
     and canonical_ref.external_id = 'activity:' || em.module_name || ':' || em.canonical_instance
    join public.source_references calendar_ref
      on calendar_ref.connection_id = em.connection_id
     and calendar_ref.object_type = 'calendar-event'
     and calendar_ref.external_id = em.event_id
     and calendar_ref.academic_item_id = canonical_ref.academic_item_id
    where old_ref.academic_item_id <> canonical_ref.academic_item_id
      and not exists (select 1 from public.notes n where n.academic_item_id = old_ref.academic_item_id)
      and not exists (select 1 from public.field_overrides o where o.academic_item_id = old_ref.academic_item_id)
      and not exists (select 1 from public.academic_item_tags t where t.academic_item_id = old_ref.academic_item_id)
      and not exists (select 1 from public.grade_items g where g.academic_item_id = old_ref.academic_item_id)
      and not exists (
        select 1 from public.academic_item_relations r
        where r.source_item_id = old_ref.academic_item_id or r.target_item_id = old_ref.academic_item_id
      )
  loop
    delete from public.source_references where id = duplicate.old_reference_id;
    delete from public.academic_items
      where id = duplicate.old_item_id
        and not exists (
          select 1 from public.source_references s
          where s.academic_item_id = duplicate.old_item_id
        );
  end loop;
end;
$$;
