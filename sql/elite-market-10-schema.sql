-- sql/elite-market-10-schema.sql
-- Tablas para llevar BestSeller AI a estándar SaaS premium.

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  monthly_price_usd numeric not null default 0,
  credits_per_month integer not null default 0,
  max_books_per_month integer not null default 0,
  max_chapters_per_book integer not null default 0,
  max_words_per_chapter integer not null default 3000,
  allow_research boolean not null default false,
  allow_fact_check boolean not null default false,
  allow_exports boolean not null default false,
  export_formats text[] not null default '{}',
  rate_limit_per_hour integer not null default 20,
  usage_limit jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  stripe_price_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_plan_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_code text not null references public.subscription_plans(code),
  status text not null default 'ACTIVE',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  credits_balance integer not null default 0,
  billing jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  event_type text not null,
  action text,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  credits_used integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  project_id uuid references public.projects(id) on delete cascade,
  job_type text not null,
  status text not null default 'QUEUED',
  priority integer not null default 5,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  locked_at timestamptz,
  locked_by text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pipeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  project_id uuid references public.projects(id) on delete cascade,
  stage text not null,
  status text not null default 'PENDING',
  score numeric check (score is null or (score >= 1 and score <= 10)),
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_user_created
on public.usage_events(user_id, created_at desc);

create index if not exists idx_usage_events_project
on public.usage_events(project_id);

create index if not exists idx_generation_jobs_status_priority
on public.generation_jobs(status, priority, created_at);

create index if not exists idx_generation_jobs_project
on public.generation_jobs(project_id);

create index if not exists idx_pipeline_events_project
on public.pipeline_events(project_id, created_at desc);

insert into public.subscription_plans (
  code,
  name,
  description,
  monthly_price_usd,
  credits_per_month,
  max_books_per_month,
  max_chapters_per_book,
  max_words_per_chapter,
  allow_research,
  allow_fact_check,
  allow_exports,
  export_formats,
  rate_limit_per_hour,
  usage_limit,
  pricing
)
values
(
  'BASIC',
  'Básico',
  'Para usuarios que desean crear libros cortos o borradores iniciales.',
  19,
  100,
  3,
  12,
  2500,
  false,
  false,
  true,
  array['pdf'],
  20,
  '{"books_per_month":3,"chapters_per_book":12,"research":false}',
  '{"currency":"USD","billing_cycle":"monthly"}'
),
(
  'PRO',
  'Pro',
  'Para autores, consultores y creadores que necesitan libros largos con mejor estructura.',
  49,
  500,
  15,
  30,
  5000,
  true,
  true,
  true,
  array['pdf','docx','epub'],
  60,
  '{"books_per_month":15,"chapters_per_book":30,"research":true,"fact_check":true}',
  '{"currency":"USD","billing_cycle":"monthly"}'
),
(
  'AGENCY',
  'Agencia',
  'Para equipos que producen múltiples libros, ebooks y documentos editoriales.',
  149,
  2000,
  80,
  80,
  8000,
  true,
  true,
  true,
  array['pdf','docx','epub'],
  180,
  '{"books_per_month":80,"chapters_per_book":80,"research":true,"fact_check":true,"team":true}',
  '{"currency":"USD","billing_cycle":"monthly"}'
),
(
  'EDITORIAL',
  'Editorial',
  'Para uso editorial intensivo con investigación, auditoría y exportación avanzada.',
  499,
  10000,
  500,
  120,
  12000,
  true,
  true,
  true,
  array['pdf','docx','epub'],
  500,
  '{"books_per_month":500,"chapters_per_book":120,"research":true,"fact_check":true,"priority_queue":true}',
  '{"currency":"USD","billing_cycle":"monthly","custom_contract":true}'
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  monthly_price_usd = excluded.monthly_price_usd,
  credits_per_month = excluded.credits_per_month,
  max_books_per_month = excluded.max_books_per_month,
  max_chapters_per_book = excluded.max_chapters_per_book,
  max_words_per_chapter = excluded.max_words_per_chapter,
  allow_research = excluded.allow_research,
  allow_fact_check = excluded.allow_fact_check,
  allow_exports = excluded.allow_exports,
  export_formats = excluded.export_formats,
  rate_limit_per_hour = excluded.rate_limit_per_hour,
  usage_limit = excluded.usage_limit,
  pricing = excluded.pricing,
  is_active = true;

alter table public.subscription_plans enable row level security;
alter table public.user_plan_assignments enable row level security;
alter table public.usage_events enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.pipeline_events enable row level security;

drop policy if exists "subscription_plans_public_read" on public.subscription_plans;
create policy "subscription_plans_public_read"
on public.subscription_plans
for select
to authenticated
using (is_active = true);

drop policy if exists "user_plan_assignments_own_read" on public.user_plan_assignments;
create policy "user_plan_assignments_own_read"
on public.user_plan_assignments
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "usage_events_own_read" on public.usage_events;
create policy "usage_events_own_read"
on public.usage_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "generation_jobs_own_read" on public.generation_jobs;
create policy "generation_jobs_own_read"
on public.generation_jobs
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "pipeline_events_own_read" on public.pipeline_events;
create policy "pipeline_events_own_read"
on public.pipeline_events
for select
to authenticated
using (user_id = auth.uid());
