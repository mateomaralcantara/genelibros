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

-- ---------- Seguridad (RLS) de las tablas base ----------
-- En Supabase los roles tienen estos permisos por defecto; aquí se conceden a mano.
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into auth.users(id) values ('44444444-4444-4444-4444-444444444444') on conflict do nothing;

do $$
declare n int;
begin
  -- Usuaria A crea su libro y un capítulo.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into public.projects(id, user_id, title) values ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Libro de A');
  insert into public.sections(project_id, type, chapter_number, title) values ('55555555-5555-5555-5555-555555555555', 'CHAPTER', 1, 'Capítulo de A');

  -- Usuario B no ve nada de A...
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select count(*) into n from public.projects where id = '55555555-5555-5555-5555-555555555555';
  if n <> 0 then raise exception 'RLS: B ve el libro de A'; end if;
  select count(*) into n from public.sections where project_id = '55555555-5555-5555-5555-555555555555';
  if n <> 0 then raise exception 'RLS: B ve los capítulos de A'; end if;

  -- ...ni puede escribir en su libro.
  begin
    insert into public.sections(project_id, type, chapter_number, title) values ('55555555-5555-5555-5555-555555555555', 'CHAPTER', 2, 'Intruso');
    raise exception 'RLS: B pudo crear un capítulo en el libro de A';
  exception when insufficient_privilege then null;
  end;

  -- B crea su perfil intentando aprobarse: queda en false.
  insert into public.profiles(user_id, email, has_access) values ('44444444-4444-4444-4444-444444444444', 'b@x.com', false);
  begin
    update public.profiles set has_access = true where user_id = '44444444-4444-4444-4444-444444444444';
    raise exception 'B pudo aprobarse a sí mismo';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;
select 'RLS OK';
