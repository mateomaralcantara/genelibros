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

-- ---------- Motor de precios (20261119) ----------
grant select on public.pricing_catalog to anon;
do $$
declare n int; v numeric;
begin
  -- Público: ve los precios activos.
  set local role anon;
  select count(*) into n from public.pricing_catalog where kind = 'SUBSCRIPTION';
  if n <> 4 then raise exception 'Precios públicos no visibles: %', n; end if;
  reset role;

  -- Cliente y editor: no pueden cambiar precios (0 filas).
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  update public.pricing_catalog set price_usd = 1 where code = 'BOOK_ONE_CLICK';
  perform set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);
  update public.pricing_catalog set price_usd = 1 where code = 'BOOK_ONE_CLICK';
  select price_usd into v from public.pricing_catalog where code = 'BOOK_ONE_CLICK';
  if v <> 15 then raise exception 'Un no-admin cambió un precio: %', v; end if;

  -- Admin: cambia el precio y queda auditado.
  perform set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
  update public.pricing_catalog set price_usd = 19 where code = 'BOOK_ONE_CLICK';
  select price_usd into v from public.pricing_catalog where code = 'BOOK_ONE_CLICK';
  if v <> 19 then raise exception 'El admin no pudo cambiar el precio'; end if;
  select count(*) into n from public.pricing_changes where item_key = 'BOOK_ONE_CLICK' and changed_by = '66666666-6666-6666-6666-666666666666';
  if n <> 1 then raise exception 'Cambio de precio sin auditoría'; end if;
  reset role;
end $$;
select 'PRICING OK';

-- ---------- Cobro: transferencia y PayPal (20261120) ----------
insert into auth.users(id) values ('88888888-8888-8888-8888-888888888888') on conflict do nothing;
insert into public.profiles(user_id, email, has_access) values ('88888888-8888-8888-8888-888888888888', 'c@x.com', false) on conflict do nothing;
do $$
declare v_pay uuid; v_pay2 uuid; v_pp uuid; n int; b int; acc boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);

  -- El cliente pide un paquete por transferencia: el importe sale del catálogo.
  v_pay := public.client_create_transfer_order('CREDITS_275');
  v_pay2 := public.client_create_transfer_order('CREDITS_275');
  if v_pay <> v_pay2 then raise exception 'Se duplicó el pedido pendiente'; end if;
  select count(*) into n from public.payment_orders where id = v_pay and amount = 25 and currency = 'USD' and credits = 275 and status = 'PENDING';
  if n <> 1 then raise exception 'Pedido de transferencia incorrecto'; end if;
  begin
    perform public.client_create_transfer_order('EDITORIAL_GUIA');
    raise exception 'Se pudo comprar un nivel editorial por catálogo';
  exception when raise_exception then
    if sqlerrm like 'Se pudo%' then raise; end if;
  end;
  perform public.client_report_transfer(v_pay, 'REF-123');

  -- El cliente no puede marcarlo pagado ni confirmarlo, ni entregarse créditos.
  update public.payment_orders set status = 'PAID' where id = v_pay;
  begin
    perform public.admin_confirm_transfer(v_pay, 'REF-123');
    raise exception 'El cliente confirmó su propia transferencia';
  exception when insufficient_privilege then null; end;
  begin
    perform public.fulfill_payment_order(v_pay);
    raise exception 'El cliente ejecutó la entrega';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.credit_ledger(user_id, delta, reason) values ('88888888-8888-8888-8888-888888888888', 1000, 'x');
    raise exception 'El cliente se regaló créditos';
  exception when insufficient_privilege then null; end;
  select status into strict n from (select 1) x, lateral (select case when status = 'PENDING' then 1 else 0 end as status from public.payment_orders where id = v_pay) y;
  if n <> 1 then raise exception 'El cliente cambió el estado del pago'; end if;

  -- El admin confirma (dos veces): una transacción, créditos una vez, acceso activado.
  perform set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
  perform public.admin_confirm_transfer(v_pay, 'BANCO-998877');
  perform public.admin_confirm_transfer(v_pay, 'BANCO-998877');
  select count(*) into n from public.payment_transactions where payment_order_id = v_pay;
  if n <> 1 then raise exception 'Transacciones duplicadas: %', n; end if;
  select coalesce(sum(delta), 0) into b from public.credit_ledger where user_id = '88888888-8888-8888-8888-888888888888';
  if b <> 275 then raise exception 'Créditos entregados: %', b; end if;
  select has_access into acc from public.profiles where user_id = '88888888-8888-8888-8888-888888888888';
  if acc is not true then raise exception 'El pago no activó el acceso'; end if;

  -- El cliente ve su saldo.
  perform set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
  select balance into b from public.credit_balances where user_id = '88888888-8888-8888-8888-888888888888';
  if b <> 275 then raise exception 'Saldo visible: %', b; end if;
  reset role;

  -- PayPal (servidor): importe distinto se rechaza; el correcto entrega una sola vez.
  insert into public.payment_orders(user_id, purpose, amount, currency, provider, idempotency_key, catalog_code, credits)
  values ('88888888-8888-8888-8888-888888888888', 'CREDITS', 10, 'USD', 'PAYPAL', 'PAYPAL:test', 'CREDITS_100', 100)
  returning id into v_pp;
  begin
    perform public.record_provider_payment(v_pp, 'PAYPAL', 'CAP-1', 1, 'USD');
    raise exception 'Se aceptó un importe distinto';
  exception when raise_exception then
    if sqlerrm like 'Se aceptó%' then raise; end if;
  end;
  perform public.record_provider_payment(v_pp, 'PAYPAL', 'CAP-1', 10, 'USD');
  perform public.record_provider_payment(v_pp, 'PAYPAL', 'CAP-1', 10, 'USD');
  select coalesce(sum(delta), 0) into b from public.credit_ledger where user_id = '88888888-8888-8888-8888-888888888888';
  if b <> 375 then raise exception 'Créditos tras PayPal: %', b; end if;

  -- Un usuario sigue sin poder activarse el acceso por su cuenta.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  begin
    update public.profiles set has_access = true where user_id = '44444444-4444-4444-4444-444444444444';
    raise exception 'El usuario se activó el acceso';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'CHECKOUT OK';

-- ---------- Plan gratis (20261121) ----------
do $$
declare n int; v int;
begin
  -- Público: ve el plan gratis en el catálogo.
  set local role anon;
  select count(*) into n from public.pricing_catalog where code = 'FREE_PLAN' and kind = 'FREE' and price_usd = 0 and (limits->>'max_words')::int = 5000;
  if n <> 1 then raise exception 'Plan gratis no visible'; end if;
  reset role;

  -- El usuario no puede sumarse ni borrarse palabras.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
  begin
    perform public.free_plan_record('88888888-8888-8888-8888-888888888888', -100000);
    raise exception 'El usuario ejecutó free_plan_record';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.free_plan_usage(user_id, words_used) values ('88888888-8888-8888-8888-888888888888', 0);
    raise exception 'El usuario escribió su consumo';
  exception when insufficient_privilege then null; end;
  reset role;

  -- El servidor suma el consumo (acumulativo, sin negativos).
  v := public.free_plan_record('88888888-8888-8888-8888-888888888888', 1200);
  v := public.free_plan_record('88888888-8888-8888-8888-888888888888', 900);
  v := public.free_plan_record('88888888-8888-8888-8888-888888888888', -50);
  if v <> 2100 then raise exception 'Consumo del plan gratis: %', v; end if;

  -- El usuario ve solo su consumo.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);
  select count(*) into n from public.free_plan_usage where words_used = 2100;
  if n <> 1 then raise exception 'El usuario no ve su consumo'; end if;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from public.free_plan_usage;
  if n <> 0 then raise exception 'Un usuario ve el consumo de otro'; end if;
  reset role;
end $$;
select 'FREE PLAN OK';
