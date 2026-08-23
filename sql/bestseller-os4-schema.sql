-- ============================================================
-- BESTSELLER AUTONOMOUS PUBLISHING OS 4.0 SUPREME
-- PostgreSQL / Supabase
-- Ejecutar en Supabase SQL Editor
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.os4_profiles (
  project_id uuid primary key references public.projects(id) on delete cascade,
  user_id uuid not null,
  mode text not null default 'SUPERVISED'
    check (mode in ('AUTONOMOUS','SUPERVISED','EDITORIAL')),
  current_stage text not null default 'MARKET',
  status text not null default 'IDLE'
    check (status in ('IDLE','RUNNING','WAITING_APPROVAL','BLOCKED','COMPLETED','FAILED')),
  overall_score numeric,
  market jsonb,
  concept_battle jsonb,
  author_dna jsonb,
  blueprint jsonb,
  research_bundle jsonb,
  knowledge_graph jsonb,
  simulation jsonb,
  chief_approval jsonb,
  master_audit jsonb,
  launch_plan jsonb,
  portfolio_insights jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os4_agent_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  trace_id text not null,
  agent text not null,
  action text not null,
  status text not null default 'COMPLETED',
  model text,
  input_summary text,
  output jsonb not null default '{}'::jsonb,
  score numeric,
  latency_ms integer,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.os4_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  status text not null,
  message text not null,
  score numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.os4_quality_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer not null,
  global_score numeric not null,
  status text not null
    check (status in ('APPROVED','REWRITE_REQUIRED','BLOCKED')),
  dimensions jsonb not null default '{}'::jsonb,
  deterministic jsonb not null default '{}'::jsonb,
  council jsonb not null default '[]'::jsonb,
  blocking_issues jsonb not null default '[]'::jsonb,
  rewrite_instructions jsonb not null default '[]'::jsonb,
  iteration integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.os4_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  decision text not null check (decision in ('APPROVED','REJECTED')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.os4_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer,
  claim text not null,
  status text not null default 'UNVERIFIED'
    check (status in ('VERIFIED','PARTIAL','DISPUTED','UNVERIFIED','REJECTED')),
  confidence numeric not null default 0,
  evidence jsonb not null default '[]'::jsonb,
  source_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_os4_profiles_user on public.os4_profiles(user_id);
create index if not exists idx_os4_agent_runs_project on public.os4_agent_runs(project_id, created_at desc);
create index if not exists idx_os4_agent_runs_trace on public.os4_agent_runs(trace_id);
create index if not exists idx_os4_events_project on public.os4_events(project_id, created_at desc);
create index if not exists idx_os4_quality_project_chapter on public.os4_quality_reports(project_id, chapter_number, created_at desc);
create index if not exists idx_os4_claims_project_chapter on public.os4_claims(project_id, chapter_number);

alter table public.os4_profiles enable row level security;
alter table public.os4_agent_runs enable row level security;
alter table public.os4_events enable row level security;
alter table public.os4_quality_reports enable row level security;
alter table public.os4_approvals enable row level security;
alter table public.os4_claims enable row level security;

drop policy if exists os4_profiles_owner on public.os4_profiles;
create policy os4_profiles_owner on public.os4_profiles
for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists os4_agent_runs_owner on public.os4_agent_runs;
create policy os4_agent_runs_owner on public.os4_agent_runs
for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists os4_events_owner on public.os4_events;
create policy os4_events_owner on public.os4_events
for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists os4_quality_reports_owner on public.os4_quality_reports;
create policy os4_quality_reports_owner on public.os4_quality_reports
for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists os4_approvals_owner on public.os4_approvals;
create policy os4_approvals_owner on public.os4_approvals
for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

drop policy if exists os4_claims_owner on public.os4_claims;
create policy os4_claims_owner on public.os4_claims
for all
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.projects p
    where p.id = project_id and p.user_id = auth.uid()
  )
);

-- Vista rápida para Mission Control
create or replace view public.os4_project_health with (security_invoker = true) as
select
  p.id as project_id,
  p.user_id,
  p.title,
  o.mode,
  o.current_stage,
  o.status,
  o.overall_score,
  (o.market->>'market_score')::numeric as market_score,
  (o.blueprint->>'blueprint_score')::numeric as blueprint_score,
  (o.research_bundle->>'coverage_score')::numeric as research_coverage_score,
  (o.simulation->>'structural_score')::numeric as simulation_score,
  o.updated_at
from public.projects p
left join public.os4_profiles o on o.project_id = p.id;

-- security_invoker=true obliga a aplicar los permisos/RLS del usuario que consulta la vista.
