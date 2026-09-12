-- Append merge pointers without changing existing view column order or grants.
do $$ declare definition text; begin
  definition:=rtrim(pg_get_viewdef('public.effective_courses'::regclass,true), E';\n ');
  execute 'create or replace view public.effective_courses with (security_invoker=true) as select existing.*,c.merged_into_id from ('||definition||') existing join public.courses c on c.id=existing.id';
  definition:=rtrim(pg_get_viewdef('public.effective_academic_items'::regclass,true), E';\n ');
  execute 'create or replace view public.effective_academic_items with (security_invoker=true) as select existing.*,a.merged_into_id from ('||definition||') existing join public.academic_items a on a.id=existing.id';
end $$;
