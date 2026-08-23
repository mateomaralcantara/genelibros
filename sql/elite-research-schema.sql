-- sql/elite-research-schema.sql
-- Capa Elite para investigación real, fuentes, hechos y quality gate.

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text,
  url text,
  author text,
  publisher text,
  source_type text,
  published_at timestamptz,
  extracted_text text,
  summary text,
  reliability_score numeric check (reliability_score is null or (reliability_score >= 1 and reliability_score <= 10)),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.research_facts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  claim text not null,
  status text not null default 'UNVERIFIED' check (
    status in ('VERIFIED', 'PARTIALLY_VERIFIED', 'DISPUTED', 'UNVERIFIED', 'REJECTED')
  ),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_ids uuid[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.chapter_quality_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  score numeric not null check (score >= 1 and score <= 10),
  status text not null default 'PENDING_REVIEW',
  factual_risks jsonb not null default '[]'::jsonb,
  unsupported_claims jsonb not null default '[]'::jsonb,
  rewrite_instructions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_research_sources_project_id
on public.research_sources(project_id);

create index if not exists idx_research_facts_project_id
on public.research_facts(project_id);

create index if not exists idx_chapter_quality_project_chapter
on public.chapter_quality_reports(project_id, chapter_number);

alter table public.research_sources enable row level security;
alter table public.research_facts enable row level security;
alter table public.chapter_quality_reports enable row level security;

drop policy if exists "research_sources_select_own" on public.research_sources;
create policy "research_sources_select_own"
on public.research_sources
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = research_sources.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "research_facts_select_own" on public.research_facts;
create policy "research_facts_select_own"
on public.research_facts
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = research_facts.project_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists "chapter_quality_reports_select_own" on public.chapter_quality_reports;
create policy "chapter_quality_reports_select_own"
on public.chapter_quality_reports
for select
to authenticated
using (
  exists (
    select 1
    from public.projects p
    where p.id = chapter_quality_reports.project_id
      and p.user_id = auth.uid()
  )
);


-- =========================================================
-- ELITE_MARKET_10_SAAS_SCHEMA
-- =========================================================

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_usd numeric not null default 0,
  credits_per_month integer not null default 0,
  max_books_per_month integer not null default 0,
  max_chapters_per_book integer not null default 0,
  usage_limit jsonb not null default '{}'::jsonb,
  plan_limits jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  billing jsonb not null default '{}'::jsonb,
  stripe_price_id text,
  checkout_url text,
  payment_provider text default 'stripe_or_local',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
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
  worker text,
  background boolean not null default true,
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

create index if not exists idx_generation_jobs_queue
on public.generation_jobs(status, priority, created_at);

create index if not exists idx_usage_events_user
on public.usage_events(user_id, created_at desc);

create index if not exists idx_pipeline_events_project
on public.pipeline_events(project_id, created_at desc);

insert into public.subscription_plans (
  code,
  name,
  monthly_price_usd,
  credits_per_month,
  max_books_per_month,
  max_chapters_per_book,
  usage_limit,
  plan_limits,
  pricing,
  billing,
  payment_provider
)
values
('BASIC', 'Básico', 19, 100, 3, 12,
 '{"books_per_month":3,"chapters_per_book":12,"research":false}'::jsonb,
 '{"max_books":3,"max_chapters":12}'::jsonb,
 '{"currency":"USD","billing_cycle":"monthly"}'::jsonb,
 '{"provider":"stripe_or_local"}'::jsonb,
 'stripe_or_local'
),
('PRO', 'Pro', 49, 500, 15, 30,
 '{"books_per_month":15,"chapters_per_book":30,"research":true,"fact_check":true}'::jsonb,
 '{"max_books":15,"max_chapters":30}'::jsonb,
 '{"currency":"USD","billing_cycle":"monthly"}'::jsonb,
 '{"provider":"stripe_or_local"}'::jsonb,
 'stripe_or_local'
),
('AGENCY', 'Agencia', 149, 2000, 80, 80,
 '{"books_per_month":80,"chapters_per_book":80,"research":true,"fact_check":true,"team":true}'::jsonb,
 '{"max_books":80,"max_chapters":80}'::jsonb,
 '{"currency":"USD","billing_cycle":"monthly"}'::jsonb,
 '{"provider":"stripe_or_local"}'::jsonb,
 'stripe_or_local'
),
('EDITORIAL', 'Editorial', 499, 10000, 500, 120,
 '{"books_per_month":500,"chapters_per_book":120,"research":true,"fact_check":true,"priority_queue":true}'::jsonb,
 '{"max_books":500,"max_chapters":120}'::jsonb,
 '{"currency":"USD","billing_cycle":"monthly","custom_contract":true}'::jsonb,
 '{"provider":"stripe_or_local"}'::jsonb,
 'stripe_or_local'
)
on conflict (code) do update set
  name = excluded.name,
  monthly_price_usd = excluded.monthly_price_usd,
  credits_per_month = excluded.credits_per_month,
  max_books_per_month = excluded.max_books_per_month,
  max_chapters_per_book = excluded.max_chapters_per_book,
  usage_limit = excluded.usage_limit,
  plan_limits = excluded.plan_limits,
  pricing = excluded.pricing,
  billing = excluded.billing,
  payment_provider = excluded.payment_provider,
  is_active = true;
