-- GENELIBROS 11B.3 — VERIFICACIÓN

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'manuscript_refinement_jobs',
    'manuscript_chapter_versions',
    'manuscript_refinement_applies'
  )
order by table_name;

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'refinery_claim_refinement_job',
    'refinery_heartbeat_refinement_job',
    'refinery_release_refinement_job',
    'refinery_complete_refinement_job',
    'refinery_fail_refinement_job',
    'refinery_create_chapter_version',
    'refinery_apply_chapter_version',
    'refinery_rollback_chapter_apply'
  )
order by routine_name;

select indexname
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'manuscript_refinement_jobs',
    'manuscript_chapter_versions',
    'manuscript_refinement_applies'
  )
order by tablename, indexname;
