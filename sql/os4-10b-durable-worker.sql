-- ============================================================
-- BESTSELLER OS4 — FASE 10B
-- DURABLE WORKER 24/7 + LEASING + RETRIES + DEAD LETTER
-- Ejecutar en Supabase SQL Editor.
-- Idempotente sobre generation_jobs existente.
-- ============================================================

create extension if not exists pgcrypto;

alter table public.generation_jobs
  add column if not exists lease_expires_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists checkpoint jsonb not null default '{}'::jsonb,
  add column if not exists last_error text,
  add column if not exists dead_letter_at timestamptz,
  add column if not exists execution_count integer not null default 0,
  add column if not exists workflow_version text;

create unique index if not exists idx_generation_jobs_idempotency_key
  on public.generation_jobs(idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_generation_jobs_durable_queue
  on public.generation_jobs(status, next_retry_at, priority, created_at);

create index if not exists idx_generation_jobs_lease
  on public.generation_jobs(status, lease_expires_at)
  where status = 'RUNNING';

create index if not exists idx_generation_jobs_dead_letter
  on public.generation_jobs(dead_letter_at desc)
  where status = 'DEAD_LETTER';

-- ------------------------------------------------------------
-- Reclamo atómico:
-- SELECT ... FOR UPDATE SKIP LOCKED evita que dos workers
-- procesen el mismo job.
-- attempts NO aumenta por cada step correcto; solo por fallo.
-- ------------------------------------------------------------
create or replace function public.os4_claim_generation_job(
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select j.id
    from public.generation_jobs j
    where j.job_type in ('OS4_FULL_BOOK', 'OS4_HEALTHCHECK')
      and j.status <> 'CANCELLED'
      and j.status <> 'DEAD_LETTER'
      and j.status <> 'COMPLETED'
      and j.status <> 'WAITING_APPROVAL'
      and j.status <> 'BLOCKED'
      and j.attempts < j.max_attempts
      and (
        (
          j.status in ('QUEUED', 'RETRYING')
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
  update public.generation_jobs j
  set
    status = 'RUNNING',
    locked_by = p_worker_id,
    locked_at = now(),
    lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
    heartbeat_at = now(),
    started_at = coalesce(j.started_at, now()),
    execution_count = coalesce(j.execution_count, 0) + 1,
    updated_at = now()
  from candidate c
  where j.id = c.id
  returning j.*;
end;
$$;

create or replace function public.os4_heartbeat_generation_job(
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
  update public.generation_jobs
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

-- Libera el job después de UN step correcto y lo deja listo
-- para el siguiente tick del scheduler.
create or replace function public.os4_release_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_checkpoint jsonb,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.generation_jobs
  set
    status = 'QUEUED',
    checkpoint = coalesce(p_checkpoint, '{}'::jsonb),
    result = coalesce(p_result, '{}'::jsonb),
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

create or replace function public.os4_complete_generation_job(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.generation_jobs
  set
    status = 'COMPLETED',
    result = coalesce(p_result, '{}'::jsonb),
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

-- Fallo durable:
-- 1) aumenta attempts
-- 2) exponential backoff
-- 3) DEAD_LETTER al agotar max_attempts
create or replace function public.os4_fail_generation_job(
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
  from public.generation_jobs
  where id = p_job_id
    and status = 'RUNNING'
    and locked_by = p_worker_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lease_not_owned');
  end if;

  v_dead := v_attempts >= v_max;
  v_delay_seconds := least(3600, greatest(30, (power(2, greatest(0, v_attempts - 1)) * 60)::integer));

  update public.generation_jobs
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

-- Barrido defensivo:
-- - RUNNING con lease vencido vuelve a ser reclamable por claim()
-- - cualquier job agotado termina en DEAD_LETTER
create or replace function public.os4_sweep_generation_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dead integer := 0;
begin
  update public.generation_jobs
  set
    status = 'DEAD_LETTER',
    dead_letter_at = coalesce(dead_letter_at, now()),
    last_error = coalesce(last_error, error, 'Max attempts exhausted'),
    locked_by = null,
    locked_at = null,
    lease_expires_at = null,
    heartbeat_at = null,
    updated_at = now()
  where job_type in ('OS4_FULL_BOOK', 'OS4_HEALTHCHECK')
    and status not in ('COMPLETED','CANCELLED','DEAD_LETTER')
    and attempts >= max_attempts;

  get diagnostics v_dead = row_count;

  return jsonb_build_object(
    'ok', true,
    'dead_lettered', v_dead,
    'swept_at', now()
  );
end;
$$;

-- Solo el backend service_role debe ejecutar las RPC de worker.
revoke all on function public.os4_claim_generation_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.os4_heartbeat_generation_job(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.os4_release_generation_job(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.os4_complete_generation_job(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.os4_fail_generation_job(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.os4_sweep_generation_jobs()
  from public, anon, authenticated;

grant execute on function public.os4_claim_generation_job(text, integer)
  to service_role;
grant execute on function public.os4_heartbeat_generation_job(uuid, text, integer)
  to service_role;
grant execute on function public.os4_release_generation_job(uuid, text, jsonb, jsonb)
  to service_role;
grant execute on function public.os4_complete_generation_job(uuid, text, jsonb)
  to service_role;
grant execute on function public.os4_fail_generation_job(uuid, text, text)
  to service_role;
grant execute on function public.os4_sweep_generation_jobs()
  to service_role;

-- generation_jobs ya tiene RLS own-read. No se agrega write de cliente.
-- /api/os4-jobs valida JWT + ownership y escribe con service role.
