-- ============================================================
-- GENELIBROS 5.0 — FASE 11B.2
-- DURABLE MANUSCRIPT AUDITOR
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.manuscript_audit_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,

  mode text not null default 'DEEP',
  status text not null default 'QUEUED',
  priority integer not null default 1,
  progress numeric(6,2) not null default 0,

  checkpoint jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,

  attempts integer not null default 0,
  max_attempts integer not null default 5,

  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,

  next_retry_at timestamptz,
  error text,
  last_error text,
  dead_letter_at timestamptz,

  workflow_version text,

  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint manuscript_audit_jobs_mode_check
    check (mode in ('DEEP', 'SUPREME')),

  constraint manuscript_audit_jobs_status_check
    check (
      status in (
        'QUEUED',
        'RUNNING',
        'RETRYING',
        'COMPLETED',
        'FAILED',
        'DEAD_LETTER',
        'CANCELLED'
      )
    )
);

create index if not exists idx_manuscript_audit_jobs_queue
  on public.manuscript_audit_jobs(status, next_retry_at, priority, created_at);

create index if not exists idx_manuscript_audit_jobs_project
  on public.manuscript_audit_jobs(project_id, created_at desc);

create index if not exists idx_manuscript_audit_jobs_user
  on public.manuscript_audit_jobs(user_id, created_at desc);

create index if not exists idx_manuscript_audit_jobs_lease
  on public.manuscript_audit_jobs(status, lease_expires_at)
  where status = 'RUNNING';

create index if not exists idx_manuscript_audit_jobs_dead
  on public.manuscript_audit_jobs(dead_letter_at desc)
  where status = 'DEAD_LETTER';

alter table public.manuscript_audit_jobs enable row level security;

drop policy if exists manuscript_audit_jobs_select_own
  on public.manuscript_audit_jobs;

create policy manuscript_audit_jobs_select_own
  on public.manuscript_audit_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete
  on public.manuscript_audit_jobs
  from anon, authenticated;

grant select
  on public.manuscript_audit_jobs
  to authenticated;

alter table public.manuscript_evaluations
  add column if not exists job_id uuid;

create unique index if not exists idx_manuscript_evaluations_job_id
  on public.manuscript_evaluations(job_id)
  where job_id is not null;

create or replace function public.refinery_claim_audit_job(
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns setof public.manuscript_audit_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select j.id
    from public.manuscript_audit_jobs j
    where j.status not in ('CANCELLED', 'DEAD_LETTER', 'COMPLETED')
      and j.attempts < j.max_attempts
      and (
        (
          j.status in ('QUEUED', 'RETRYING', 'FAILED')
          and coalesce(j.next_retry_at, now()) <= now()
        )
        or
        (
          j.status = 'RUNNING'
          and coalesce(j.lease_expires_at, to_timestamp(0)) < now()
        )
      )
    order by j.priority asc, j.created_at asc
    for update skip locked
    limit 1
  )
  update public.manuscript_audit_jobs j
  set
    status = 'RUNNING',
    locked_by = p_worker_id,
    locked_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    heartbeat_at = now(),
    started_at = coalesce(j.started_at, now()),
    updated_at = now()
  from candidate c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.refinery_heartbeat_audit_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.manuscript_audit_jobs
  set
    heartbeat_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    updated_at = now()
  where id = p_job_id
    and status = 'RUNNING'
    and locked_by = p_worker_id;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.refinery_release_audit_job(
  p_job_id uuid,
  p_worker_id text,
  p_checkpoint jsonb,
  p_result jsonb,
  p_progress numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.manuscript_audit_jobs
  set
    status = 'QUEUED',
    checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
    result = coalesce(p_result, '{}'::jsonb),
    progress = greatest(0, least(100, coalesce(p_progress, progress))),
    error = null,
    last_error = null,
    next_retry_at = now(),
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    heartbeat_at = null,
    updated_at = now()
  where id = p_job_id
    and status = 'RUNNING'
    and locked_by = p_worker_id;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.refinery_complete_audit_job(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.manuscript_audit_jobs
  set
    status = 'COMPLETED',
    result = coalesce(p_result, '{}'::jsonb),
    progress = 100,
    error = null,
    last_error = null,
    completed_at = now(),
    next_retry_at = null,
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    heartbeat_at = null,
    updated_at = now()
  where id = p_job_id
    and status = 'RUNNING'
    and locked_by = p_worker_id;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.refinery_fail_audit_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts integer;
  v_max integer;
  v_dead boolean;
  v_delay_seconds integer;
begin
  select attempts + 1, max_attempts
  into v_attempts, v_max
  from public.manuscript_audit_jobs
  where id = p_job_id
    and status = 'RUNNING'
    and locked_by = p_worker_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lease_not_owned');
  end if;

  v_dead := v_attempts >= v_max;
  v_delay_seconds :=
    least(
      3600,
      greatest(
        15,
        (power(2, greatest(0, v_attempts - 1)) * 30)::integer
      )
    );

  update public.manuscript_audit_jobs
  set
    attempts = v_attempts,
    status = case when v_dead then 'DEAD_LETTER' else 'RETRYING' end,
    error = left(coalesce(p_error, 'Worker failure'), 6000),
    last_error = left(coalesce(p_error, 'Worker failure'), 6000),
    dead_letter_at = case when v_dead then now() else null end,
    next_retry_at = case
      when v_dead then null
      else now() + make_interval(secs => v_delay_seconds)
    end,
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    heartbeat_at = null,
    updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'ok', true,
    'dead_letter', v_dead,
    'attempts', v_attempts,
    'max_attempts', v_max,
    'retry_in_seconds', case when v_dead then null else v_delay_seconds end
  );
end;
$$;

create or replace function public.refinery_sweep_audit_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dead integer := 0;
begin
  update public.manuscript_audit_jobs
  set
    status = 'DEAD_LETTER',
    dead_letter_at = coalesce(dead_letter_at, now()),
    last_error = coalesce(last_error, error, 'Max attempts exhausted'),
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    heartbeat_at = null,
    updated_at = now()
  where status not in ('COMPLETED', 'CANCELLED', 'DEAD_LETTER')
    and attempts >= max_attempts;

  get diagnostics v_dead = row_count;

  return jsonb_build_object(
    'ok', true,
    'dead_lettered', v_dead,
    'swept_at', now()
  );
end;
$$;

revoke all on function public.refinery_claim_audit_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.refinery_heartbeat_audit_job(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.refinery_release_audit_job(uuid, text, jsonb, jsonb, numeric)
  from public, anon, authenticated;
revoke all on function public.refinery_complete_audit_job(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.refinery_fail_audit_job(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.refinery_sweep_audit_jobs()
  from public, anon, authenticated;

grant execute on function public.refinery_claim_audit_job(text, integer)
  to service_role;
grant execute on function public.refinery_heartbeat_audit_job(uuid, text, integer)
  to service_role;
grant execute on function public.refinery_release_audit_job(uuid, text, jsonb, jsonb, numeric)
  to service_role;
grant execute on function public.refinery_complete_audit_job(uuid, text, jsonb)
  to service_role;
grant execute on function public.refinery_fail_audit_job(uuid, text, text)
  to service_role;
grant execute on function public.refinery_sweep_audit_jobs()
  to service_role;

comment on table public.manuscript_audit_jobs is
  'Genelibros 11B.2: cola durable de auditoría editorial, un capítulo por tick.';
