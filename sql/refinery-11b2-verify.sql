select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('manuscript_audit_jobs', 'manuscript_evaluations')
order by table_name;

select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'manuscript_audit_jobs'
order by ordinal_position;

select
  routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'refinery_claim_audit_job',
    'refinery_heartbeat_audit_job',
    'refinery_release_audit_job',
    'refinery_complete_audit_job',
    'refinery_fail_audit_job',
    'refinery_sweep_audit_jobs'
  )
order by routine_name;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('manuscript_audit_jobs', 'manuscript_evaluations')
  and (
    indexname like 'idx_manuscript_audit_jobs_%'
    or indexname = 'idx_manuscript_evaluations_job_id'
  )
order by tablename, indexname;

select
  policyname,
  cmd,
  roles,
  qual
from pg_policies
where schemaname = 'public'
  and tablename = 'manuscript_audit_jobs';

select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'manuscript_evaluations'
  and column_name = 'job_id';
