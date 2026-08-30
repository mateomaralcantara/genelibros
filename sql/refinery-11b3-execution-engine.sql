-- ============================================================
-- GENELIBROS 5.0 — FASE 11B.3
-- BOOK REFINERY EXECUTION ENGINE
-- Non-destructive candidates + Editorial Delta + apply/rollback
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.manuscript_refinement_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  evaluation_id uuid not null references public.manuscript_evaluations(id) on delete cascade,

  mode text not null default 'DEEP',
  status text not null default 'QUEUED',
  priority integer not null default 1,
  progress numeric(6,2) not null default 0,

  checkpoint jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  policy jsonb not null default '{}'::jsonb,

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

  constraint manuscript_refinement_jobs_mode_check
    check (mode in ('DEEP', 'SUPREME')),
  constraint manuscript_refinement_jobs_status_check
    check (status in (
      'QUEUED', 'RUNNING', 'RETRYING', 'COMPLETED',
      'FAILED', 'DEAD_LETTER', 'CANCELLED'
    ))
);

create index if not exists idx_manuscript_refinement_jobs_queue
  on public.manuscript_refinement_jobs(status, next_retry_at, priority, created_at);
create index if not exists idx_manuscript_refinement_jobs_project
  on public.manuscript_refinement_jobs(project_id, created_at desc);
create index if not exists idx_manuscript_refinement_jobs_evaluation
  on public.manuscript_refinement_jobs(evaluation_id, created_at desc);
create index if not exists idx_manuscript_refinement_jobs_lease
  on public.manuscript_refinement_jobs(status, lease_expires_at)
  where status = 'RUNNING';

create table if not exists public.manuscript_chapter_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null references public.manuscript_refinement_jobs(id) on delete cascade,
  evaluation_id uuid not null references public.manuscript_evaluations(id) on delete cascade,
  section_id uuid,

  chapter_number integer not null,
  title text not null default '',
  version_number integer not null,
  parent_version_id uuid references public.manuscript_chapter_versions(id) on delete set null,

  action text not null,
  status text not null default 'CANDIDATE',
  source_content_hash text not null,
  content text not null,
  agent_chain jsonb not null default '[]'::jsonb,
  candidate_meta jsonb not null default '{}'::jsonb,
  before_audit jsonb not null default '{}'::jsonb,
  after_audit jsonb not null default '{}'::jsonb,
  editorial_delta jsonb not null default '{}'::jsonb,
  research_gaps jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  decided_at timestamptz,
  applied_at timestamptz,

  constraint manuscript_chapter_versions_status_check
    check (status in (
      'CANDIDATE', 'APPROVED', 'REJECTED',
      'NEEDS_RESEARCH', 'APPLIED', 'ROLLED_BACK'
    )),
  constraint manuscript_chapter_versions_action_check
    check (action in (
      'PRESERVE', 'POLISH', 'REDUCE', 'EXPAND',
      'REWRITE', 'RESTRUCTURE', 'MERGE'
    )),
  constraint manuscript_chapter_versions_unique_version
    unique(project_id, chapter_number, version_number)
);

create index if not exists idx_manuscript_chapter_versions_project
  on public.manuscript_chapter_versions(project_id, chapter_number, version_number desc);
create index if not exists idx_manuscript_chapter_versions_job
  on public.manuscript_chapter_versions(job_id, chapter_number);
create index if not exists idx_manuscript_chapter_versions_status
  on public.manuscript_chapter_versions(status, created_at desc);

create table if not exists public.manuscript_refinement_applies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_id uuid not null references public.manuscript_chapter_versions(id) on delete restrict,
  section_id uuid not null,
  previous_content text not null,
  previous_content_hash text not null,
  applied_content_hash text not null,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz
);

create index if not exists idx_manuscript_refinement_applies_project
  on public.manuscript_refinement_applies(project_id, created_at desc);
create index if not exists idx_manuscript_refinement_applies_version
  on public.manuscript_refinement_applies(version_id, created_at desc);

alter table public.manuscript_refinement_jobs enable row level security;
alter table public.manuscript_chapter_versions enable row level security;
alter table public.manuscript_refinement_applies enable row level security;

drop policy if exists manuscript_refinement_jobs_select_own on public.manuscript_refinement_jobs;
create policy manuscript_refinement_jobs_select_own
  on public.manuscript_refinement_jobs for select to authenticated
  using (user_id = auth.uid());

drop policy if exists manuscript_chapter_versions_select_own on public.manuscript_chapter_versions;
create policy manuscript_chapter_versions_select_own
  on public.manuscript_chapter_versions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists manuscript_refinement_applies_select_own on public.manuscript_refinement_applies;
create policy manuscript_refinement_applies_select_own
  on public.manuscript_refinement_applies for select to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.manuscript_refinement_jobs from anon, authenticated;
revoke insert, update, delete on public.manuscript_chapter_versions from anon, authenticated;
revoke insert, update, delete on public.manuscript_refinement_applies from anon, authenticated;
grant select on public.manuscript_refinement_jobs to authenticated;
grant select on public.manuscript_chapter_versions to authenticated;
grant select on public.manuscript_refinement_applies to authenticated;

create or replace function public.refinery_claim_refinement_job(
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns setof public.manuscript_refinement_jobs
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidate as (
    select j.id
    from public.manuscript_refinement_jobs j
    where j.status not in ('CANCELLED', 'DEAD_LETTER', 'COMPLETED')
      and j.attempts < j.max_attempts
      and (
        (j.status in ('QUEUED', 'RETRYING', 'FAILED') and coalesce(j.next_retry_at, now()) <= now())
        or
        (j.status = 'RUNNING' and coalesce(j.lease_expires_at, to_timestamp(0)) < now())
      )
    order by j.priority asc, j.created_at asc
    for update skip locked
    limit 1
  )
  update public.manuscript_refinement_jobs j
  set status = 'RUNNING',
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

create or replace function public.refinery_heartbeat_refinement_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.manuscript_refinement_jobs
  set heartbeat_at = now(),
      lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      updated_at = now()
  where id = p_job_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.refinery_release_refinement_job(
  p_job_id uuid,
  p_worker_id text,
  p_checkpoint jsonb,
  p_result jsonb,
  p_progress numeric
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.manuscript_refinement_jobs
  set status = 'QUEUED',
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
  where id = p_job_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.refinery_complete_refinement_job(
  p_job_id uuid,
  p_worker_id text,
  p_result jsonb
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.manuscript_refinement_jobs
  set status = 'COMPLETED',
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
  where id = p_job_id and status = 'RUNNING' and locked_by = p_worker_id;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create or replace function public.refinery_fail_refinement_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_attempts integer;
  v_max integer;
  v_dead boolean;
  v_delay integer;
begin
  select attempts + 1, max_attempts
  into v_attempts, v_max
  from public.manuscript_refinement_jobs
  where id = p_job_id and status = 'RUNNING' and locked_by = p_worker_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lease_not_owned');
  end if;

  v_dead := v_attempts >= v_max;
  v_delay := least(3600, greatest(15, (power(2, greatest(0, v_attempts - 1)) * 30)::integer));

  update public.manuscript_refinement_jobs
  set attempts = v_attempts,
      status = case when v_dead then 'DEAD_LETTER' else 'RETRYING' end,
      error = left(coalesce(p_error, 'Worker failure'), 6000),
      last_error = left(coalesce(p_error, 'Worker failure'), 6000),
      dead_letter_at = case when v_dead then now() else null end,
      next_retry_at = case when v_dead then null else now() + make_interval(secs => v_delay) end,
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
    'retry_in_seconds', case when v_dead then null else v_delay end
  );
end;
$$;

create or replace function public.refinery_create_chapter_version(
  p_user_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_evaluation_id uuid,
  p_section_id uuid,
  p_chapter_number integer,
  p_title text,
  p_action text,
  p_source_content_hash text,
  p_content text,
  p_agent_chain jsonb,
  p_before_audit jsonb,
  p_candidate_meta jsonb,
  p_research_gaps jsonb default '[]'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_version integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_project_id::text || ':' || p_chapter_number::text));

  select coalesce(max(version_number), 0) + 1
  into v_version
  from public.manuscript_chapter_versions
  where project_id = p_project_id and chapter_number = p_chapter_number;

  insert into public.manuscript_chapter_versions (
    user_id, project_id, job_id, evaluation_id, section_id,
    chapter_number, title, version_number, action, status,
    source_content_hash, content, agent_chain, before_audit,
    candidate_meta, research_gaps
  ) values (
    p_user_id, p_project_id, p_job_id, p_evaluation_id, p_section_id,
    p_chapter_number, coalesce(p_title, ''), v_version, upper(p_action), 'CANDIDATE',
    p_source_content_hash, p_content, coalesce(p_agent_chain, '[]'::jsonb),
    coalesce(p_before_audit, '{}'::jsonb), coalesce(p_candidate_meta, '{}'::jsonb),
    coalesce(p_research_gaps, '[]'::jsonb)
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.refinery_apply_chapter_version(
  p_version_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_version public.manuscript_chapter_versions%rowtype;
  v_current text;
  v_current_hash text;
  v_apply_id uuid;
begin
  select * into v_version
  from public.manuscript_chapter_versions
  where id = p_version_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'version_not_found');
  end if;

  if v_version.status <> 'APPROVED' then
    return jsonb_build_object('ok', false, 'reason', 'version_not_approved', 'status', v_version.status);
  end if;

  if v_version.section_id is null then
    return jsonb_build_object('ok', false, 'reason', 'version_has_no_section_id');
  end if;

  select content into v_current
  from public.sections
  where id = v_version.section_id and project_id = v_version.project_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'section_not_found');
  end if;

  v_current_hash := encode(digest(coalesce(v_current, ''), 'sha256'), 'hex');

  if v_current_hash <> v_version.source_content_hash then
    return jsonb_build_object(
      'ok', false,
      'reason', 'source_changed_since_refinement',
      'message', 'El capítulo cambió después de crear la versión; se bloqueó la aplicación para evitar sobrescritura.'
    );
  end if;

  insert into public.manuscript_refinement_applies (
    user_id, project_id, version_id, section_id,
    previous_content, previous_content_hash, applied_content_hash
  ) values (
    p_user_id, v_version.project_id, v_version.id, v_version.section_id,
    coalesce(v_current, ''), v_current_hash,
    encode(digest(coalesce(v_version.content, ''), 'sha256'), 'hex')
  ) returning id into v_apply_id;

  update public.sections
  set content = v_version.content
  where id = v_version.section_id and project_id = v_version.project_id;

  update public.manuscript_chapter_versions
  set status = 'APPLIED', applied_at = now(), decided_at = coalesce(decided_at, now())
  where id = v_version.id;

  return jsonb_build_object('ok', true, 'apply_id', v_apply_id, 'version_id', v_version.id);
end;
$$;

create or replace function public.refinery_rollback_chapter_apply(
  p_apply_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_apply public.manuscript_refinement_applies%rowtype;
  v_current text;
  v_current_hash text;
begin
  select * into v_apply
  from public.manuscript_refinement_applies
  where id = p_apply_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'apply_not_found');
  end if;

  if v_apply.rolled_back_at is not null then
    return jsonb_build_object('ok', true, 'already_rolled_back', true);
  end if;

  select content into v_current
  from public.sections
  where id = v_apply.section_id and project_id = v_apply.project_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'section_not_found');
  end if;

  v_current_hash := encode(digest(coalesce(v_current, ''), 'sha256'), 'hex');
  if v_current_hash <> v_apply.applied_content_hash then
    return jsonb_build_object(
      'ok', false,
      'reason', 'section_changed_after_apply',
      'message', 'El capítulo fue modificado después de aplicar la versión; rollback automático bloqueado.'
    );
  end if;

  update public.sections
  set content = v_apply.previous_content
  where id = v_apply.section_id and project_id = v_apply.project_id;

  update public.manuscript_refinement_applies
  set rolled_back_at = now()
  where id = v_apply.id;

  update public.manuscript_chapter_versions
  set status = 'ROLLED_BACK'
  where id = v_apply.version_id;

  return jsonb_build_object('ok', true, 'apply_id', v_apply.id, 'version_id', v_apply.version_id);
end;
$$;

revoke all on function public.refinery_claim_refinement_job(text, integer) from public, anon, authenticated;
revoke all on function public.refinery_heartbeat_refinement_job(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.refinery_release_refinement_job(uuid, text, jsonb, jsonb, numeric) from public, anon, authenticated;
revoke all on function public.refinery_complete_refinement_job(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.refinery_fail_refinement_job(uuid, text, text) from public, anon, authenticated;
revoke all on function public.refinery_create_chapter_version(uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.refinery_apply_chapter_version(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refinery_rollback_chapter_apply(uuid, uuid) from public, anon, authenticated;

grant execute on function public.refinery_claim_refinement_job(text, integer) to service_role;
grant execute on function public.refinery_heartbeat_refinement_job(uuid, text, integer) to service_role;
grant execute on function public.refinery_release_refinement_job(uuid, text, jsonb, jsonb, numeric) to service_role;
grant execute on function public.refinery_complete_refinement_job(uuid, text, jsonb) to service_role;
grant execute on function public.refinery_fail_refinement_job(uuid, text, text) to service_role;
grant execute on function public.refinery_create_chapter_version(uuid, uuid, uuid, uuid, uuid, integer, text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.refinery_apply_chapter_version(uuid, uuid) to service_role;
grant execute on function public.refinery_rollback_chapter_apply(uuid, uuid) to service_role;

comment on table public.manuscript_refinement_jobs is
  'Genelibros 11B.3: cola durable para cirugía editorial no destructiva.';
comment on table public.manuscript_chapter_versions is
  'Genelibros 11B.3: versiones candidatas por capítulo con auditoría before/after y Editorial Delta.';
comment on table public.manuscript_refinement_applies is
  'Genelibros 11B.3: historial reversible de aplicaciones explícitas al manuscrito.';
