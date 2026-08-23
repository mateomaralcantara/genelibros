create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_type text not null check (job_type in ('GENERATE_CHAPTER','GENERATE_PROPOSAL','GENERATE_INTRODUCTION')),
  chapter_number integer,
  status text not null default 'QUEUED'
    check (status in ('QUEUED','GENERATING','ASSEMBLING','COMPLETED','ERROR','CANCELLED')),
  target_words integer not null default 3000,
  model text not null default 'gemini-2.5-flash',
  progress_percent integer not null default 0,
  current_step text,
  result_text text,
  error_message text,
  retry_count integer not null default 0,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists generation_jobs_project_idx on public.generation_jobs(project_id, created_at desc);
create index if not exists generation_jobs_status_idx on public.generation_jobs(status, created_at asc);

alter table public.generation_jobs enable row level security;

drop policy if exists "users can read own jobs" on public.generation_jobs;
create policy "users can read own jobs"
on public.generation_jobs for select using (auth.uid() = user_id);

drop policy if exists "users can create own jobs" on public.generation_jobs;
create policy "users can create own jobs"
on public.generation_jobs for insert with check (auth.uid() = user_id);

drop policy if exists "users can cancel own jobs" on public.generation_jobs;
create policy "users can cancel own jobs"
on public.generation_jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
