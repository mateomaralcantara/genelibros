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
  -- Una sola propuesta por libro (20261117_dedupe_singleton_sections.sql).
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  insert into public.sections(project_id, type, chapter_number, content) values ('55555555-5555-5555-5555-555555555555', 'PROPOSAL', null, 'Propuesta');
  begin
    insert into public.sections(project_id, type, chapter_number, content) values ('55555555-5555-5555-5555-555555555555', 'PROPOSAL', null, 'Otra propuesta');
    raise exception 'Se pudo crear una segunda propuesta en el mismo libro';
  exception when unique_violation then null;
  end;
  reset role;
end $$;
select 'RLS OK';

-- ---------- Modalidad D: encargo editorial y pago (20261118) ----------
insert into auth.users(id) values ('66666666-6666-6666-6666-666666666666'), ('77777777-7777-7777-7777-777777777777') on conflict do nothing;
insert into public.app_roles(user_id, role) values
  ('66666666-6666-6666-6666-666666666666', 'admin'),
  ('77777777-7777-7777-7777-777777777777', 'editor') on conflict do nothing;

do $$
declare v_order uuid; n int; v_status text;
begin
  -- Cliente A crea su solicitud.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  insert into public.editorial_orders(user_id, idea, working_title) values ('11111111-1111-1111-1111-111111111111', 'Mi historia familiar', 'Raíces') returning id into v_order;

  -- No puede crearla ya contratada ni con precio.
  begin
    insert into public.editorial_orders(user_id, idea, status) values ('11111111-1111-1111-1111-111111111111', 'x', 'CONTRATADO');
    raise exception 'El cliente creó un encargo con estado administrativo';
  exception when insufficient_privilege then null; end;

  -- No puede cambiar el estado (sin política UPDATE: 0 filas).
  update public.editorial_orders set status = 'ENTREGADO' where id = v_order;
  select status into v_status from public.editorial_orders where id = v_order;
  if v_status <> 'RECIBIDA' then raise exception 'El cliente cambió el estado de su encargo'; end if;

  -- No puede aprobar sin propuesta.
  begin
    perform public.editorial_client_approve_proposal(v_order);
    raise exception 'Se aprobó un encargo sin propuesta';
  exception when raise_exception then
    if sqlerrm like 'Se aprobó%' then raise; end if;
  end;

  -- Otro usuario no ve el encargo.
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select count(*) into n from public.editorial_orders where id = v_order;
  if n <> 0 then raise exception 'B ve el encargo de A'; end if;

  -- Editor: evalúa y envía propuesta (queda en el historial).
  perform set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
  update public.editorial_orders set status = 'EN_EVALUACION', assigned_to = '77777777-7777-7777-7777-777777777777' where id = v_order;
  update public.editorial_orders set status = 'PROPUESTA_ENVIADA', proposal_amount = 100, proposal_currency = 'DOP',
         proposal_terms = 'Condiciones de prueba', proposal_sent_at = now() where id = v_order;
  select count(*) into n from public.editorial_order_events where order_id = v_order and kind = 'STATUS';
  if n <> 2 then raise exception 'Faltan eventos de estado: %', n; end if;

  -- El editor no puede confirmar pagos.
  begin
    perform public.admin_record_manual_payment(v_order, 100, 'DOP', 'REF-1');
    raise exception 'Un editor confirmó un pago';
  exception when insufficient_privilege then null; end;

  -- Cliente aprueba la propuesta (no queda pagado).
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  perform public.editorial_client_approve_proposal(v_order);
  select count(*) into n from public.payment_orders where reference_id = v_order and status = 'PAID';
  if n <> 0 then raise exception 'Aprobar marcó el pedido como pagado'; end if;
  -- El cliente no ve la asignación interna.
  select count(*) into n from public.editorial_order_events where order_id = v_order and kind = 'ASSIGNMENT';
  if n <> 0 then raise exception 'El cliente ve eventos internos'; end if;

  -- Admin confirma el pago verificado (dos veces = idempotente).
  perform set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
  perform public.admin_record_manual_payment(v_order, 100, 'DOP', 'REF-1');
  perform public.admin_record_manual_payment(v_order, 100, 'DOP', 'REF-1');
  select count(*) into n from public.payment_transactions t join public.payment_orders o on o.id = t.payment_order_id where o.reference_id = v_order;
  if n <> 1 then raise exception 'Pago duplicado: % transacciones', n; end if;
  select status into v_status from public.editorial_orders where id = v_order;
  if v_status <> 'CONTRATADO' then raise exception 'El encargo no pasó a CONTRATADO: %', v_status; end if;

  -- El cliente ve su pago, no puede crear pagos.
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from public.payment_orders where reference_id = v_order and status = 'PAID';
  if n <> 1 then raise exception 'El cliente no ve su pago'; end if;
  begin
    insert into public.payment_orders(user_id, purpose, amount, currency, idempotency_key) values ('11111111-1111-1111-1111-111111111111', 'BOOK', 1, 'DOP', 'x');
    raise exception 'El cliente creó un pago';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'EDITORIAL OK';
