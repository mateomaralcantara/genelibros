-- GENELIBROS 5.0 — FASE 11C — DEEP WORK ENGINE
create extension if not exists pgcrypto;

create table if not exists public.deep_work_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  target_type text not null default 'CHAPTER',
  operation text not null default 'IMPROVE',
  depth text not null default 'DEEP',
  chapter_number integer not null,
  section_id uuid null,
  objective text not null,
  target_words integer not null default 3000,
  status text not null default 'QUEUED',
  priority integer not null default 1,
  progress numeric(5,2) not null default 0,
  checkpoint jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  policy jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_retry_at timestamptz null default now(),
  locked_by text null,
  locked_at timestamptz null,
  heartbeat_at timestamptz null,
  lease_expires_at timestamptz null,
  last_error text null,
  error text null,
  dead_letter_at timestamptz null,
  workflow_version text not null default 'deep-work-11c-1.0.0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_deep_work_jobs_queue
  on public.deep_work_jobs(status, priority desc, created_at asc);
create index if not exists idx_deep_work_jobs_project
  on public.deep_work_jobs(user_id, project_id, created_at desc);
create index if not exists idx_deep_work_jobs_lease
  on public.deep_work_jobs(status, lease_expires_at);

create table if not exists public.deep_work_artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null references public.deep_work_jobs(id) on delete cascade,
  section_id uuid null,
  chapter_number integer not null,
  artifact_type text not null,
  label text null,
  content text null,
  payload jsonb not null default '{}'::jsonb,
  content_hash text null,
  model text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_deep_work_artifacts_job
  on public.deep_work_artifacts(job_id, created_at asc);

create table if not exists public.deep_work_apply_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id uuid not null references public.deep_work_jobs(id) on delete cascade,
  section_id uuid not null,
  source_hash text not null,
  applied_hash text not null,
  previous_content text not null,
  applied_content text not null,
  applied_at timestamptz not null default now(),
  rolled_back_at timestamptz null
);

alter table public.deep_work_jobs enable row level security;
alter table public.deep_work_artifacts enable row level security;
alter table public.deep_work_apply_history enable row level security;

drop policy if exists deep_work_jobs_select_own on public.deep_work_jobs;
create policy deep_work_jobs_select_own on public.deep_work_jobs
for select to authenticated using (auth.uid() = user_id);

drop policy if exists deep_work_artifacts_select_own on public.deep_work_artifacts;
create policy deep_work_artifacts_select_own on public.deep_work_artifacts
for select to authenticated using (auth.uid() = user_id);

drop policy if exists deep_work_apply_select_own on public.deep_work_apply_history;
create policy deep_work_apply_select_own on public.deep_work_apply_history
for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete on public.deep_work_jobs from anon, authenticated;
revoke insert, update, delete on public.deep_work_artifacts from anon, authenticated;
revoke insert, update, delete on public.deep_work_apply_history from anon, authenticated;

grant select on public.deep_work_jobs to authenticated;
grant select on public.deep_work_artifacts to authenticated;
grant select on public.deep_work_apply_history to authenticated;

create or replace function public.deep_claim_work_job(
  p_worker_id text,
  p_lease_seconds integer default 600
) returns public.deep_work_jobs
language plpgsql security definer set search_path = public
as $$
declare v_job public.deep_work_jobs;
begin
  perform public.deep_sweep_work_jobs();
  select * into v_job
  from public.deep_work_jobs
  where status in ('QUEUED','RETRYING')
    and coalesce(next_retry_at, now()) <= now()
    and dead_letter_at is null
  order by priority desc, created_at asc
  for update skip locked
  limit 1;
  if v_job.id is null then return null; end if;
  update public.deep_work_jobs
  set status='RUNNING', locked_by=p_worker_id, locked_at=now(), heartbeat_at=now(),
      lease_expires_at=now() + make_interval(secs => greatest(60,p_lease_seconds)),
      updated_at=now()
  where id=v_job.id returning * into v_job;
  return v_job;
end $$;

create or replace function public.deep_heartbeat_work_job(
  p_job_id uuid, p_worker_id text, p_lease_seconds integer default 600
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.deep_work_jobs
  set heartbeat_at=now(), lease_expires_at=now()+make_interval(secs=>greatest(60,p_lease_seconds)), updated_at=now()
  where id=p_job_id and status='RUNNING' and locked_by=p_worker_id;
  return found;
end $$;

create or replace function public.deep_release_work_job(
  p_job_id uuid, p_worker_id text, p_checkpoint jsonb, p_result jsonb, p_progress numeric
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.deep_work_jobs
  set status='QUEUED', checkpoint=coalesce(p_checkpoint,'{}'::jsonb), result=coalesce(p_result,'{}'::jsonb),
      progress=greatest(0,least(100,coalesce(p_progress,0))), locked_by=null, locked_at=null,
      heartbeat_at=null, lease_expires_at=null, next_retry_at=now(), updated_at=now()
  where id=p_job_id and status='RUNNING' and locked_by=p_worker_id;
  return found;
end $$;

create or replace function public.deep_complete_work_job(
  p_job_id uuid, p_worker_id text, p_result jsonb
) returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  update public.deep_work_jobs
  set status='COMPLETED', progress=100, result=coalesce(p_result,'{}'::jsonb), completed_at=now(),
      locked_by=null, locked_at=null, heartbeat_at=null, lease_expires_at=null, updated_at=now()
  where id=p_job_id and status='RUNNING' and locked_by=p_worker_id;
  return found;
end $$;

create or replace function public.deep_fail_work_job(
  p_job_id uuid, p_worker_id text, p_error text
) returns public.deep_work_jobs
language plpgsql security definer set search_path = public
as $$
declare v_job public.deep_work_jobs; v_attempts integer; v_delay integer;
begin
  select * into v_job from public.deep_work_jobs where id=p_job_id for update;
  if v_job.id is null or v_job.locked_by is distinct from p_worker_id then return null; end if;
  v_attempts := coalesce(v_job.attempts,0)+1;
  v_delay := least(3600, 15 * (2 ^ least(v_attempts,8))::integer);
  update public.deep_work_jobs
  set attempts=v_attempts, last_error=left(coalesce(p_error,'Unknown error'),6000), error=left(coalesce(p_error,'Unknown error'),6000),
      status=case when v_attempts >= coalesce(max_attempts,5) then 'DEAD_LETTER' else 'RETRYING' end,
      dead_letter_at=case when v_attempts >= coalesce(max_attempts,5) then now() else null end,
      next_retry_at=case when v_attempts >= coalesce(max_attempts,5) then null else now()+make_interval(secs=>v_delay) end,
      locked_by=null, locked_at=null, heartbeat_at=null, lease_expires_at=null, updated_at=now()
  where id=p_job_id returning * into v_job;
  return v_job;
end $$;

create or replace function public.deep_sweep_work_jobs() returns integer
language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  update public.deep_work_jobs
  set status='RETRYING', attempts=attempts+1, last_error=coalesce(last_error,'Lease expired'),
      next_retry_at=now()+interval '30 seconds', locked_by=null, locked_at=null, heartbeat_at=null,
      lease_expires_at=null, updated_at=now()
  where status='RUNNING' and lease_expires_at is not null and lease_expires_at < now()
    and attempts+1 < max_attempts;
  get diagnostics n = row_count;
  update public.deep_work_jobs
  set status='DEAD_LETTER', attempts=attempts+1, last_error=coalesce(last_error,'Lease expired'),
      dead_letter_at=now(), locked_by=null, locked_at=null, heartbeat_at=null, lease_expires_at=null, updated_at=now()
  where status='RUNNING' and lease_expires_at is not null and lease_expires_at < now()
    and attempts+1 >= max_attempts;
  return n;
end $$;

create or replace function public.deep_create_artifact(
  p_user_id uuid, p_project_id uuid, p_job_id uuid, p_section_id uuid, p_chapter_number integer,
  p_artifact_type text, p_label text, p_content text, p_payload jsonb, p_content_hash text, p_model text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.deep_work_artifacts(user_id,project_id,job_id,section_id,chapter_number,artifact_type,label,content,payload,content_hash,model)
  values(p_user_id,p_project_id,p_job_id,p_section_id,p_chapter_number,p_artifact_type,p_label,p_content,coalesce(p_payload,'{}'::jsonb),p_content_hash,p_model)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.deep_apply_chapter_candidate(p_user_id uuid, p_project_id uuid, p_job_id uuid)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_job public.deep_work_jobs; v_section public.sections; v_candidate text; v_source_hash text; v_applied_hash text; v_history uuid;
begin
  select * into v_job from public.deep_work_jobs where id=p_job_id and user_id=p_user_id and project_id=p_project_id and status='COMPLETED';
  if v_job.id is null then raise exception 'Deep Work job no encontrado o no COMPLETED'; end if;
  if coalesce(v_job.result->'quality'->>'verdict','') <> 'APPROVED' then raise exception 'Candidate no APPROVED'; end if;
  v_candidate := coalesce(v_job.result->'finalCandidate'->>'content','');
  v_source_hash := coalesce(v_job.result->>'sourceHash','');
  if v_job.section_id is null or v_candidate='' or v_source_hash='' then raise exception 'Job sin candidato aplicable'; end if;
  select * into v_section from public.sections where id=v_job.section_id and project_id=p_project_id for update;
  if v_section.id is null then raise exception 'Section no encontrada'; end if;
  if encode(digest(coalesce(v_section.content,''),'sha256'),'hex') <> v_source_hash then raise exception 'SOURCE_HASH_MISMATCH: el capítulo cambió desde que Deep Work empezó'; end if;
  v_applied_hash := encode(digest(v_candidate,'sha256'),'hex');
  update public.sections set content=v_candidate where id=v_section.id;
  insert into public.deep_work_apply_history(user_id,project_id,job_id,section_id,source_hash,applied_hash,previous_content,applied_content)
  values(p_user_id,p_project_id,p_job_id,v_section.id,v_source_hash,v_applied_hash,coalesce(v_section.content,''),v_candidate)
  returning id into v_history;
  return v_history;
end $$;

create or replace function public.deep_rollback_chapter_candidate(p_user_id uuid, p_project_id uuid, p_history_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare v_hist public.deep_work_apply_history; v_current text;
begin
  select * into v_hist from public.deep_work_apply_history where id=p_history_id and user_id=p_user_id and project_id=p_project_id and rolled_back_at is null for update;
  if v_hist.id is null then raise exception 'Historial no encontrado o ya revertido'; end if;
  select content into v_current from public.sections where id=v_hist.section_id for update;
  if encode(digest(coalesce(v_current,''),'sha256'),'hex') <> v_hist.applied_hash then raise exception 'ROLLBACK_HASH_MISMATCH: el capítulo cambió después del apply'; end if;
  update public.sections set content=v_hist.previous_content where id=v_hist.section_id;
  update public.deep_work_apply_history set rolled_back_at=now() where id=v_hist.id;
  return true;
end $$;

revoke all on function public.deep_claim_work_job(text,integer) from public, anon, authenticated;
revoke all on function public.deep_heartbeat_work_job(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.deep_release_work_job(uuid,text,jsonb,jsonb,numeric) from public, anon, authenticated;
revoke all on function public.deep_complete_work_job(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.deep_fail_work_job(uuid,text,text) from public, anon, authenticated;
revoke all on function public.deep_sweep_work_jobs() from public, anon, authenticated;
revoke all on function public.deep_create_artifact(uuid,uuid,uuid,uuid,integer,text,text,text,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.deep_apply_chapter_candidate(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.deep_rollback_chapter_candidate(uuid,uuid,uuid) from public, anon, authenticated;
