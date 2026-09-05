-- ============================================================
-- GENELIBROS 11B — VERIFICACIÓN
-- ============================================================

select
  table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'manuscript_evaluations';

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'manuscript_evaluations'
order by ordinal_position;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'manuscript_evaluations'
order by indexname;

select
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename = 'manuscript_evaluations';
