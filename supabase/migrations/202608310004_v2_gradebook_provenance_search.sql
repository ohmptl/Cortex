create table public.grade_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  parent_category_id uuid references public.grade_categories(id) on delete set null,
  name text not null,
  aggregation text,
  weight numeric,
  minimum_score numeric,
  maximum_score numeric,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.grade_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  category_id uuid references public.grade_categories(id) on delete set null,
  academic_item_id uuid references public.academic_items(id) on delete set null,
  name text not null,
  item_type text,
  module_type text,
  module_instance_id text,
  item_number integer,
  score numeric,
  minimum_score numeric,
  maximum_score numeric,
  percentage numeric,
  weight numeric,
  feedback text,
  hidden boolean not null default false,
  position integer not null default 0,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  provider text not null,
  object_type text not null,
  external_id text not null,
  external_course_id text,
  relationship_kind text not null default 'authoritative',
  raw_source_record_id uuid references public.raw_source_records(id) on delete set null,
  course_id uuid references public.courses(id) on delete cascade,
  course_section_id uuid references public.course_sections(id) on delete cascade,
  course_module_id uuid references public.course_modules(id) on delete cascade,
  academic_item_id uuid references public.academic_items(id) on delete cascade,
  grade_category_id uuid references public.grade_categories(id) on delete cascade,
  grade_item_id uuid references public.grade_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, object_type, external_id),
  check (num_nonnulls(course_id, course_section_id, course_module_id, academic_item_id, grade_category_id, grade_item_id) = 1)
);

create index source_references_course_external_idx on public.source_references(connection_id, external_course_id);
create index source_references_item_idx on public.source_references(academic_item_id) where academic_item_id is not null;
create index grade_categories_course_idx on public.grade_categories(course_id, position);
create index grade_items_course_idx on public.grade_items(course_id, position);

create or replace view public.effective_academic_items with (security_invoker = true) as
select ai.*,
  case when coalesce(o.values, '{}'::jsonb) ? 'title' then o.values->>'title' else ai.title end as effective_title,
  case when coalesce(o.values, '{}'::jsonb) ? 'description' then o.values->>'description' else ai.description end as effective_description,
  case when coalesce(o.values, '{}'::jsonb) ? 'item_type' then o.values->>'item_type' else ai.item_type end as effective_item_type,
  case when coalesce(o.values, '{}'::jsonb) ? 'due_at' then (o.values->>'due_at')::timestamptz else ai.source_due_at end as effective_due_at,
  case when coalesce(o.values, '{}'::jsonb) ? 'available_at' then (o.values->>'available_at')::timestamptz else ai.source_available_at end as effective_available_at,
  case when coalesce(o.values, '{}'::jsonb) ? 'close_at' then (o.values->>'close_at')::timestamptz else ai.source_close_at end as effective_close_at,
  case when coalesce(o.values, '{}'::jsonb) ? 'url' then o.values->>'url' else ai.url end as effective_url,
  coalesce(o.values, '{}'::jsonb) as overrides
from public.academic_items ai
left join lateral (
  select jsonb_object_agg(field_name, value) as values from public.field_overrides where academic_item_id = ai.id
) o on true;

create or replace view public.effective_courses with (security_invoker = true) as
select c.*,
  case when coalesce(o.values, '{}'::jsonb) ? 'code' then o.values->>'code' else c.code end as effective_code,
  case when coalesce(o.values, '{}'::jsonb) ? 'name' then o.values->>'name' else c.name end as effective_name,
  case when coalesce(o.values, '{}'::jsonb) ? 'term' then o.values->>'term' else c.term end as effective_term,
  case when coalesce(o.values, '{}'::jsonb) ? 'instructor' then o.values->>'instructor' else c.instructor end as effective_instructor,
  case when coalesce(o.values, '{}'::jsonb) ? 'color' then o.values->>'color' else c.color end as effective_color,
  coalesce(o.values, '{}'::jsonb) as overrides
from public.courses c
left join lateral (
  select jsonb_object_agg(field_name, value) as values from public.field_overrides where course_id = c.id
) o on true;

create index academic_items_search_idx on public.academic_items using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);
create index course_modules_search_idx on public.course_modules using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
);
create index notes_search_idx on public.notes using gin (to_tsvector('english', body));
