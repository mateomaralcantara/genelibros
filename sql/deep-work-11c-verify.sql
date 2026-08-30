select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('deep_work_jobs','deep_work_artifacts','deep_work_apply_history')
order by table_name;

select routine_name
from information_schema.routines
where routine_schema='public'
  and routine_name in (
    'deep_claim_work_job','deep_heartbeat_work_job','deep_release_work_job',
    'deep_complete_work_job','deep_fail_work_job','deep_sweep_work_jobs',
    'deep_create_artifact','deep_apply_chapter_candidate','deep_rollback_chapter_candidate'
  )
order by routine_name;
