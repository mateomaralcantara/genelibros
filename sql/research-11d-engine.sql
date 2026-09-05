begin;
create extension if not exists pgcrypto;

create table if not exists public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer,
  topic text not null,
  objective text not null default '',
  depth text not null default 'DEEP' check (depth in ('DEEP','SUPREME')),
  max_sources integer not null default 10 check (max_sources between 3 and 30),
  manual_urls jsonb not null default '[]'::jsonb,
  idempotency_key text not null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','RETRYING','COMPLETED','FAILED','DEAD_LETTER')),
  progress integer not null default 0 check (progress between 0 and 100),
  checkpoint jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  last_error text,
  attempts integer not null default 0,
  execution_count integer not null default 0,
  next_retry_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  worker_id text,
  dead_letter_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_research_jobs_active_idempotency on public.research_jobs(user_id,idempotency_key) where status in ('QUEUED','RUNNING','RETRYING');
create index if not exists idx_research_jobs_queue on public.research_jobs(status,next_retry_at,created_at);
create index if not exists idx_research_jobs_project on public.research_jobs(project_id,created_at desc);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.research_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_key text not null,
  url text not null,
  title text not null,
  publisher text,
  author text,
  published_at timestamptz,
  retrieved_at timestamptz not null default now(),
  source_class text not null check (source_class in ('A','B','C','D')),
  credibility_score numeric(5,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  excerpt text,
  created_at timestamptz not null default now(),
  unique(job_id,source_key)
);

create table if not exists public.research_evidence (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.research_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  evidence_key text not null,
  source_key text not null,
  question_ids jsonb not null default '[]'::jsonb,
  evidence text not null,
  relevance_score numeric(5,2) not null default 0,
  confidence_score numeric(5,2) not null default 0,
  supports jsonb not null default '[]'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(job_id,evidence_key)
);

create table if not exists public.research_claims (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.research_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  claim_key text not null,
  claim text not null,
  verification_status text not null check (verification_status in ('VERIFIED','PARTIALLY_VERIFIED','CONFLICTED','UNVERIFIED')),
  confidence_score numeric(5,2) not null default 0,
  evidence_ids jsonb not null default '[]'::jsonb,
  source_ids jsonb not null default '[]'::jsonb,
  contradiction_ids jsonb not null default '[]'::jsonb,
  citation_ready boolean not null default false,
  created_at timestamptz not null default now(),
  unique(job_id,claim_key)
);

create table if not exists public.research_dossiers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.research_jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_number integer,
  topic text not null,
  model text,
  coverage_score numeric(5,2) not null default 0,
  evidence_score numeric(5,2) not null default 0,
  factual_confidence_score numeric(5,2) not null default 0,
  ready_for_writing boolean not null default false,
  result jsonb not null default '{}'::jsonb,
  usage jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.research_jobs enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_evidence enable row level security;
alter table public.research_claims enable row level security;
alter table public.research_dossiers enable row level security;

drop policy if exists research_jobs_select_own on public.research_jobs;
create policy research_jobs_select_own on public.research_jobs for select to authenticated using (auth.uid()=user_id);
drop policy if exists research_sources_select_own on public.research_sources;
create policy research_sources_select_own on public.research_sources for select to authenticated using (auth.uid()=user_id);
drop policy if exists research_evidence_select_own on public.research_evidence;
create policy research_evidence_select_own on public.research_evidence for select to authenticated using (auth.uid()=user_id);
drop policy if exists research_claims_select_own on public.research_claims;
create policy research_claims_select_own on public.research_claims for select to authenticated using (auth.uid()=user_id);
drop policy if exists research_dossiers_select_own on public.research_dossiers;
create policy research_dossiers_select_own on public.research_dossiers for select to authenticated using (auth.uid()=user_id);

revoke insert,update,delete on public.research_jobs from anon,authenticated;
revoke insert,update,delete on public.research_sources from anon,authenticated;
revoke insert,update,delete on public.research_evidence from anon,authenticated;
revoke insert,update,delete on public.research_claims from anon,authenticated;
revoke insert,update,delete on public.research_dossiers from anon,authenticated;

create or replace function public.research_claim_job(p_worker_id text,p_lease_seconds integer default 240)
returns setof public.research_jobs language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  select id into v_id from public.research_jobs
  where ((status='QUEUED') or (status='RETRYING' and (next_retry_at is null or next_retry_at<=now())) or (status='RUNNING' and lease_expires_at is not null and lease_expires_at<=now())) and dead_letter_at is null
  order by case status when 'RUNNING' then 0 when 'RETRYING' then 1 else 2 end, created_at
  for update skip locked limit 1;
  if v_id is null then return; end if;
  update public.research_jobs set status='RUNNING',worker_id=p_worker_id,lease_expires_at=now()+make_interval(secs=>greatest(30,p_lease_seconds)),heartbeat_at=now(),execution_count=execution_count+1,started_at=coalesce(started_at,now()),updated_at=now() where id=v_id;
  return query select * from public.research_jobs where id=v_id;
end $$;

create or replace function public.research_heartbeat_job(p_job_id uuid,p_worker_id text,p_lease_seconds integer default 240)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.research_jobs set heartbeat_at=now(),lease_expires_at=now()+make_interval(secs=>greatest(30,p_lease_seconds)),updated_at=now() where id=p_job_id and status='RUNNING' and worker_id=p_worker_id;
  return found;
end $$;

create or replace function public.research_release_job(p_job_id uuid,p_worker_id text,p_checkpoint jsonb,p_progress integer,p_result jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.research_jobs set status='QUEUED',checkpoint=coalesce(p_checkpoint,'{}'::jsonb),progress=greatest(0,least(100,p_progress)),result=coalesce(p_result,'{}'::jsonb),worker_id=null,lease_expires_at=null,heartbeat_at=now(),next_retry_at=null,updated_at=now() where id=p_job_id and status='RUNNING' and worker_id=p_worker_id;
  return found;
end $$;

create or replace function public.research_complete_job(p_job_id uuid,p_worker_id text,p_result jsonb,p_checkpoint jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.research_jobs set status='COMPLETED',progress=100,result=coalesce(p_result,'{}'::jsonb),checkpoint=coalesce(p_checkpoint,'{}'::jsonb),worker_id=null,lease_expires_at=null,heartbeat_at=now(),completed_at=now(),updated_at=now() where id=p_job_id and status='RUNNING' and worker_id=p_worker_id;
  return found;
end $$;

create or replace function public.research_fail_job(p_job_id uuid,p_worker_id text,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_attempts integer;
begin
  select attempts+1 into v_attempts from public.research_jobs where id=p_job_id for update;
  if v_attempts is null then return false; end if;
  if v_attempts>=6 then
    update public.research_jobs set status='DEAD_LETTER',attempts=v_attempts,last_error=p_error,dead_letter_at=now(),worker_id=null,lease_expires_at=null,updated_at=now() where id=p_job_id;
  else
    update public.research_jobs set status='RETRYING',attempts=v_attempts,last_error=p_error,next_retry_at=now()+make_interval(secs=>least(900,(power(2,v_attempts)*10)::integer)),worker_id=null,lease_expires_at=null,updated_at=now() where id=p_job_id;
  end if;
  return true;
end $$;

create or replace function public.research_sweep_jobs()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  update public.research_jobs set status='QUEUED',worker_id=null,lease_expires_at=null,updated_at=now() where status='RUNNING' and lease_expires_at is not null and lease_expires_at<=now() and dead_letter_at is null;
  get diagnostics v_count=row_count; return v_count;
end $$;

revoke all on function public.research_claim_job(text,integer) from public,anon,authenticated;
revoke all on function public.research_heartbeat_job(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.research_release_job(uuid,text,jsonb,integer,jsonb) from public,anon,authenticated;
revoke all on function public.research_complete_job(uuid,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.research_fail_job(uuid,text,text) from public,anon,authenticated;
revoke all on function public.research_sweep_jobs() from public,anon,authenticated;
commit;
