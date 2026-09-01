create table public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  term text,
  instructor text,
  active boolean not null default true,
  color text not null default '#b07b5c',
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_sections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  section_number integer,
  position integer not null default 0,
  name text not null,
  summary text,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.course_modules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  section_id uuid references public.course_sections(id) on delete set null,
  module_type text not null,
  title text not null,
  description text,
  url text,
  position integer not null default 0,
  visible boolean not null default true,
  availability jsonb not null default '{}'::jsonb,
  completion_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.academic_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  module_id uuid references public.course_modules(id) on delete set null,
  origin text not null default 'manual' check (origin in ('manual', 'provider')),
  item_type text not null check (item_type in ('assignment', 'quiz', 'exam', 'lab', 'project', 'discussion', 'reading', 'lecture', 'review', 'event', 'other')),
  title text not null,
  description text,
  source_start_at timestamptz,
  source_available_at timestamptz,
  source_due_at timestamptz,
  source_close_at timestamptz,
  source_end_at timestamptz,
  all_day boolean not null default false,
  url text,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'submitted', 'graded', 'cancelled')),
  completion_state text,
  submission_state text,
  submitted_at timestamptz,
  completed_at timestamptz,
  upstream_state text not null default 'present' check (upstream_state in ('present', 'missing', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.field_overrides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  academic_item_id uuid references public.academic_items(id) on delete cascade,
  field_name text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(course_id, academic_item_id) = 1)
);

alter table public.field_overrides add constraint field_overrides_target_field_key
  unique nulls not distinct (course_id, academic_item_id, field_name);

create table public.academic_item_relations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null references public.academic_items(id) on delete cascade,
  target_item_id uuid not null references public.academic_items(id) on delete cascade,
  relation_type text not null,
  created_at timestamptz not null default now(),
  unique(source_item_id, target_item_id, relation_type),
  check (source_item_id <> target_item_id)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  academic_item_id uuid references public.academic_items(id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(course_id, academic_item_id) = 1)
);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique(owner_id, name)
);

create table public.academic_item_tags (
  owner_id uuid not null references auth.users(id) on delete cascade,
  academic_item_id uuid not null references public.academic_items(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(academic_item_id, tag_id)
);

create index courses_owner_active_idx on public.courses(owner_id, active, code);
create index course_sections_course_idx on public.course_sections(course_id, position);
create index course_modules_course_idx on public.course_modules(course_id, position);
create index academic_items_agenda_idx on public.academic_items(owner_id, source_due_at) where upstream_state = 'present';
create index academic_items_course_idx on public.academic_items(course_id, source_due_at);
