-- Prueba de humo: lo que hace el código contra la forma final del esquema.
-- Solo para supabase/test (Postgres de pruebas). No ejecutar en producción.

insert into auth.users(id) values ('11111111-1111-1111-1111-111111111111') on conflict do nothing;
insert into projects(id,user_id,title) values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Libro') on conflict do nothing;
-- cola OS4 (api/os4-jobs.ts)
insert into generation_jobs(user_id,project_id,job_type,status,priority,payload,idempotency_key,lease_expires_at,heartbeat_at)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','OS4_FULL_BOOK','WAITING_APPROVAL',5,'{}','k1',now(),now());
-- cola de capítulos (src/lib/jobsClient.ts)
insert into generation_jobs(user_id,project_id,job_type,chapter_number,status,target_words,progress_percent,current_step)
values ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','GENERATE_CHAPTER',1,'QUEUED',3000,0,'En cola');
-- worker de investigación: upsert por (job_id, source_key)
insert into research_jobs(id,user_id,project_id,topic,status,idempotency_key) values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','tema','QUEUED','k-research') on conflict do nothing;
insert into research_sources(job_id,user_id,project_id,source_key,url,title,source_class,credibility_score)
values ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','s1','https://x','X','A',8)
on conflict (job_id,source_key) do update set credibility_score = excluded.credibility_score;
-- planes (elite-research)
update subscription_plans set plan_limits='{}'::jsonb, billing='{}'::jsonb where false;
select 'SMOKE OK';
