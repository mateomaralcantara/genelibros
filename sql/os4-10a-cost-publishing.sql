-- BestSeller OS4 Supreme — Fase 10A
-- Cost Engine + Publishing Director persistence
-- Idempotente.

begin;

alter table if exists public.os4_profiles
  add column if not exists publishing_plan jsonb;

-- Asegura que la columna de costo exista incluso si el schema OS4 se creó con una versión anterior.
alter table if exists public.os4_agent_runs
  add column if not exists estimated_cost_usd numeric not null default 0;

create index if not exists idx_os4_agent_runs_project_cost
  on public.os4_agent_runs(project_id, created_at desc, estimated_cost_usd);

commit;

-- Verificación segura
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'os4_profiles' and column_name = 'publishing_plan')
    or
    (table_name = 'os4_agent_runs' and column_name = 'estimated_cost_usd')
  )
order by table_name, column_name;
