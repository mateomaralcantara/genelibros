-- ============================================================
-- GENELIBROS — Reconciliar tablas definidas en varios archivos
--
-- generation_jobs, research_sources y subscription_plans se crean con
-- "create table if not exists" en más de un archivo de sql/ y
-- supabase/migrations/, con columnas DISTINTAS. Gana el primero que se
-- ejecute y los demás se ignoran, así que según el orden en que se montó
-- la base faltaban columnas que el código usa (o sobraban restricciones
-- que lo bloquean).
--
-- Esta migración deja cualquier base en la forma que el código espera:
--   - Solo AÑADE columnas que falten (nunca borra datos ni columnas).
--   - Quita dos CHECK de 20260525_generation_jobs.sql que impedían a la
--     cola OS4 guardar job_type = 'OS4_FULL_BOOK' y estados como RUNNING.
--   - Crea el índice único que research-worker necesita para upsert.
--
-- Idempotente: se puede ejecutar varias veces. Ver supabase/README.md.
-- ============================================================

-- ---------- generation_jobs ----------
do $$
begin
  if to_regclass('public.generation_jobs') is null then
    raise notice 'generation_jobs no existe todavía: nada que reconciliar.';
    return;
  end if;

  alter table public.generation_jobs
    -- Cola OS4 / elite-market-10 (lo que usan api/os4-jobs.ts y api/os4-worker.ts)
    add column if not exists priority integer not null default 5,
    add column if not exists payload jsonb not null default '{}'::jsonb,
    add column if not exists result jsonb not null default '{}'::jsonb,
    add column if not exists error text,
    add column if not exists attempts integer not null default 0,
    add column if not exists max_attempts integer not null default 3,
    add column if not exists locked_at timestamptz,
    add column if not exists locked_by text,
    add column if not exists started_at timestamptz,
    add column if not exists completed_at timestamptz,
    add column if not exists updated_at timestamptz not null default now(),
    -- elite-research-schema.sql
    add column if not exists worker text,
    add column if not exists background boolean not null default true,
    -- os4-10b-durable-worker.sql
    add column if not exists lease_expires_at timestamptz,
    add column if not exists heartbeat_at timestamptz,
    add column if not exists next_retry_at timestamptz,
    add column if not exists idempotency_key text,
    add column if not exists checkpoint jsonb not null default '{}'::jsonb,
    add column if not exists last_error text,
    add column if not exists dead_letter_at timestamptz,
    add column if not exists execution_count integer not null default 0,
    add column if not exists workflow_version text,
    -- 20260525_generation_jobs.sql (cola de capítulos: src/lib/jobsClient.ts, worker/)
    add column if not exists chapter_number integer,
    add column if not exists target_words integer not null default 3000,
    add column if not exists model text,
    add column if not exists progress_percent integer not null default 0,
    add column if not exists current_step text,
    add column if not exists result_text text,
    add column if not exists error_message text,
    add column if not exists retry_count integer not null default 0,
    add column if not exists finished_at timestamptz;

  -- Estas restricciones solo admitían los 3 tipos y 6 estados de la cola de
  -- capítulos y rechazaban los de OS4 (OS4_FULL_BOOK, RUNNING, WAITING_APPROVAL...).
  alter table public.generation_jobs drop constraint if exists generation_jobs_job_type_check;
  alter table public.generation_jobs drop constraint if exists generation_jobs_status_check;
end;
$$;

-- ---------- research_sources ----------
-- research-worker (research-11d-engine.sql) necesita job_id, source_key,
-- source_class, credibility_score... La versión de elite-research-schema.sql
-- no los tenía.
do $$
begin
  if to_regclass('public.research_sources') is null then
    raise notice 'research_sources no existe todavía: nada que reconciliar.';
    return;
  end if;

  alter table public.research_sources
    add column if not exists job_id uuid,
    add column if not exists user_id uuid,
    add column if not exists source_key text,
    add column if not exists retrieved_at timestamptz not null default now(),
    add column if not exists source_class text,
    add column if not exists credibility_score numeric(5,2) not null default 0,
    add column if not exists excerpt text,
    -- versión de elite-research-schema.sql
    add column if not exists source_type text,
    add column if not exists extracted_text text,
    add column if not exists summary text,
    add column if not exists reliability_score numeric,
    add column if not exists metadata jsonb not null default '{}'::jsonb;

  if to_regclass('public.research_jobs') is not null
     and not exists (
       select 1 from pg_constraint
       where conrelid = 'public.research_sources'::regclass
         and contype = 'f'
         and conkey = array[(select attnum from pg_attribute
                             where attrelid = 'public.research_sources'::regclass
                               and attname = 'job_id')]::int2[]
     ) then
    alter table public.research_sources
      add constraint research_sources_job_id_fkey
      foreign key (job_id) references public.research_jobs(id) on delete cascade;
  end if;
end;
$$;

-- upsert(..., { onConflict: "job_id,source_key" }) en research-worker necesita
-- un índice único sobre esas columnas (research-11d ya lo crea con unique()).
do $$
begin
  if to_regclass('public.research_sources') is null then return; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'research_sources'
      and indexdef ilike 'CREATE UNIQUE INDEX%(job_id, source_key)%'
  ) then
    create unique index research_sources_job_source_key_uidx
      on public.research_sources (job_id, source_key);
  end if;
end;
$$;

-- ---------- subscription_plans ----------
do $$
begin
  if to_regclass('public.subscription_plans') is null then
    raise notice 'subscription_plans no existe todavía: nada que reconciliar.';
    return;
  end if;

  alter table public.subscription_plans
    -- elite-market-10-schema.sql
    add column if not exists description text,
    add column if not exists max_words_per_chapter integer not null default 3000,
    add column if not exists allow_research boolean not null default false,
    add column if not exists allow_fact_check boolean not null default false,
    add column if not exists allow_exports boolean not null default false,
    add column if not exists export_formats text[] not null default '{}',
    add column if not exists rate_limit_per_hour integer not null default 20,
    -- elite-research-schema.sql
    add column if not exists plan_limits jsonb not null default '{}'::jsonb,
    add column if not exists billing jsonb not null default '{}'::jsonb,
    add column if not exists checkout_url text,
    add column if not exists payment_provider text default 'stripe_or_local';
end;
$$;
