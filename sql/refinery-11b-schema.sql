-- ============================================================
-- GENELIBROS 5.0 — FASE 11B
-- BOOK REFINERY / MANUSCRIPT AUDITOR
-- Persistencia de auditorías. Idempotente.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.manuscript_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  audit_version text not null,
  mode text not null default 'DEEP',
  status text not null default 'COMPLETED',
  overall_score numeric(5,2),
  current_words integer not null default 0,
  recommended_words integer not null default 0,
  recommended_reduction_percent numeric(6,2) not null default 0,
  model text,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_manuscript_evaluations_project_created
  on public.manuscript_evaluations(project_id, created_at desc);

create index if not exists idx_manuscript_evaluations_user_created
  on public.manuscript_evaluations(user_id, created_at desc);

create index if not exists idx_manuscript_evaluations_score
  on public.manuscript_evaluations(overall_score desc);

alter table public.manuscript_evaluations enable row level security;

drop policy if exists manuscript_evaluations_select_own
  on public.manuscript_evaluations;

create policy manuscript_evaluations_select_own
  on public.manuscript_evaluations
  for select
  to authenticated
  using (user_id = auth.uid());

-- Las escrituras normales se realizan desde API server-side con service role.
revoke insert, update, delete on public.manuscript_evaluations
  from anon, authenticated;

grant select on public.manuscript_evaluations to authenticated;

comment on table public.manuscript_evaluations is
  'Genelibros Book Refinery: auditorías editoriales completas y no destructivas.';
