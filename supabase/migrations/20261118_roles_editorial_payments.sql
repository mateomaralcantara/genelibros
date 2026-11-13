-- ============================================================
-- LIBROSELLER — Fase 1 del modelo comercial
--   · Roles (admin / editor)
--   · Modalidad D: libro elaborado por el equipo editorial
--   · Núcleo de pagos desacoplado del proveedor (órdenes y transacciones)
--
-- Principios:
--   - Sin precios en el código: los importes los fija el equipo en cada
--     propuesta o desde el panel administrativo.
--   - El cliente nunca cambia estados administrativos: no tiene políticas de
--     UPDATE; solo puede crear su solicitud y aprobar/comentar mediante RPC.
--   - Un pago solo cuenta como confirmado por el proveedor (webhook) o por un
--     administrador que verificó el ingreso; nunca por una redirección.
--   - Todo cambio queda en editorial_order_events (auditoría).
--
-- Idempotente. Requiere 00000000_base_tables.sql.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------
create table if not exists public.app_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'editor')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.app_roles enable row level security;

-- security definer: las políticas pueden consultarla sin recursión de RLS.
create or replace function public.has_role(p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_roles where user_id = auth.uid() and role = any(p_roles));
$$;
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(array['admin', 'editor']);
$$;

drop policy if exists app_roles_read on public.app_roles;
create policy app_roles_read on public.app_roles for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists app_roles_admin_write on public.app_roles;
create policy app_roles_admin_write on public.app_roles for all to authenticated
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

-- El equipo necesita ver nombre/email de clientes y editores en el panel.
drop policy if exists profiles_staff_read on public.profiles;
create policy profiles_staff_read on public.profiles for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------
-- 2. Modalidad D — encargos editoriales
-- ---------------------------------------------------------------
create table if not exists public.editorial_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'RECIBIDA' check (status in (
    'RECIBIDA', 'EN_EVALUACION', 'PROPUESTA_ENVIADA', 'PENDIENTE_APROBACION',
    'CONTRATADO', 'INVESTIGACION', 'ESTRUCTURACION', 'REDACCION', 'CORRECCION',
    'REVISION_CLIENTE', 'AJUSTES', 'DISENO', 'APROBACION_FINAL', 'ENTREGADO', 'CANCELADO')),
  -- Formulario inicial del cliente
  contact_name text,
  contact_email text,
  contact_phone text,
  working_title text,
  idea text not null,
  purpose text,
  audience text,
  genre text,
  details jsonb not null default '{}'::jsonb,   -- extensión, tono, plazos deseados, referencias...
  -- Gestión editorial (solo equipo)
  assigned_to uuid references auth.users(id),
  proposal_terms text,
  proposal_amount numeric(12,2),
  proposal_currency text,
  proposal_sent_at timestamptz,
  client_approved_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists editorial_orders_user_idx on public.editorial_orders (user_id, created_at desc);
create index if not exists editorial_orders_status_idx on public.editorial_orders (status, updated_at desc);

create table if not exists public.editorial_order_stages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.editorial_orders(id) on delete cascade,
  stage text not null,
  assignee uuid references auth.users(id),
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,                -- internas del equipo
  updated_at timestamptz not null default now(),
  unique (order_id, stage)
);

create table if not exists public.editorial_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.editorial_orders(id) on delete cascade,
  actor_id uuid,
  kind text not null check (kind in ('STATUS', 'COMMENT', 'ASSIGNMENT', 'PROPOSAL', 'APPROVAL', 'CHANGE_REQUEST', 'PAYMENT', 'FILE')),
  from_status text,
  to_status text,
  body text,
  visible_to_client boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists editorial_order_events_order_idx on public.editorial_order_events (order_id, created_at);

create table if not exists public.editorial_deliverables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.editorial_orders(id) on delete cascade,
  stage text,
  file_path text not null,   -- ruta en el bucket privado editorial-files: <order_id>/<archivo>
  file_name text not null,
  description text,
  visible_to_client boolean not null default false,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

alter table public.editorial_orders enable row level security;
alter table public.editorial_order_stages enable row level security;
alter table public.editorial_order_events enable row level security;
alter table public.editorial_deliverables enable row level security;

-- Cliente: crea su solicitud (sin campos administrativos) y ve las suyas.
drop policy if exists editorial_orders_client_insert on public.editorial_orders;
create policy editorial_orders_client_insert on public.editorial_orders for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'RECIBIDA' and assigned_to is null
    and proposal_amount is null and proposal_currency is null and proposal_terms is null
    and proposal_sent_at is null and client_approved_at is null and delivered_at is null);
drop policy if exists editorial_orders_read on public.editorial_orders;
create policy editorial_orders_read on public.editorial_orders for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
-- Equipo: gestiona todo. El cliente NO tiene UPDATE/DELETE.
drop policy if exists editorial_orders_staff_update on public.editorial_orders;
create policy editorial_orders_staff_update on public.editorial_orders for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists editorial_stages_read on public.editorial_order_stages;
create policy editorial_stages_read on public.editorial_order_stages for select to authenticated
  using (public.is_staff() or exists (select 1 from public.editorial_orders o where o.id = order_id and o.user_id = auth.uid()));
drop policy if exists editorial_stages_staff_write on public.editorial_order_stages;
create policy editorial_stages_staff_write on public.editorial_order_stages for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists editorial_events_read on public.editorial_order_events;
create policy editorial_events_read on public.editorial_order_events for select to authenticated
  using (public.is_staff() or (visible_to_client and exists (
    select 1 from public.editorial_orders o where o.id = order_id and o.user_id = auth.uid())));
drop policy if exists editorial_events_staff_insert on public.editorial_order_events;
create policy editorial_events_staff_insert on public.editorial_order_events for insert to authenticated
  with check (public.is_staff() and actor_id = auth.uid());

drop policy if exists editorial_deliverables_read on public.editorial_deliverables;
create policy editorial_deliverables_read on public.editorial_deliverables for select to authenticated
  using (public.is_staff() or (visible_to_client and exists (
    select 1 from public.editorial_orders o where o.id = order_id and o.user_id = auth.uid())));
drop policy if exists editorial_deliverables_staff_write on public.editorial_deliverables;
create policy editorial_deliverables_staff_write on public.editorial_deliverables for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Auditoría automática de cambios del equipo en el encargo.
create or replace function public.log_editorial_order_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into public.editorial_order_events(order_id, actor_id, kind, from_status, to_status)
    values (new.id, auth.uid(), 'STATUS', old.status, new.status);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.editorial_order_events(order_id, actor_id, kind, body, visible_to_client)
    values (new.id, auth.uid(), 'ASSIGNMENT', coalesce(new.assigned_to::text, 'sin asignar'), false);
  end if;
  if (new.proposal_amount, new.proposal_currency, new.proposal_terms)
     is distinct from (old.proposal_amount, old.proposal_currency, old.proposal_terms) then
    insert into public.editorial_order_events(order_id, actor_id, kind, body)
    values (new.id, auth.uid(), 'PROPOSAL', 'Propuesta actualizada');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_log_editorial_order_change on public.editorial_orders;
create trigger trg_log_editorial_order_change before update on public.editorial_orders
  for each row execute function public.log_editorial_order_change();

-- Cliente: comentar su encargo.
create or replace function public.editorial_add_client_comment(p_order_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.editorial_orders where id = p_order_id and user_id = auth.uid()) then
    raise exception 'Encargo no encontrado' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Comentario vacío'; end if;
  insert into public.editorial_order_events(order_id, actor_id, kind, body)
  values (p_order_id, auth.uid(), 'COMMENT', left(p_body, 5000));
end;
$$;

-- Cliente: aprobar la propuesta enviada (no marca nada como pagado).
create or replace function public.editorial_client_approve_proposal(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.editorial_orders;
begin
  select * into v from public.editorial_orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception 'Encargo no encontrado' using errcode = '42501'; end if;
  if v.status not in ('PROPUESTA_ENVIADA', 'PENDIENTE_APROBACION') or v.proposal_amount is null then
    raise exception 'No hay una propuesta pendiente de aprobación';
  end if;
  update public.editorial_orders
     set status = 'PENDIENTE_APROBACION', client_approved_at = now()
   where id = p_order_id;
  insert into public.editorial_order_events(order_id, actor_id, kind, body)
  values (p_order_id, auth.uid(), 'APPROVAL', 'El cliente aprobó la propuesta. Pendiente de confirmación de pago.');
end;
$$;

-- Cliente: pedir ajustes cuando el manuscrito está en su revisión.
create or replace function public.editorial_client_request_changes(p_order_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.editorial_orders;
begin
  select * into v from public.editorial_orders where id = p_order_id and user_id = auth.uid() for update;
  if not found then raise exception 'Encargo no encontrado' using errcode = '42501'; end if;
  if v.status <> 'REVISION_CLIENTE' then raise exception 'El encargo no está en revisión del cliente'; end if;
  update public.editorial_orders set status = 'AJUSTES' where id = p_order_id;
  insert into public.editorial_order_events(order_id, actor_id, kind, body)
  values (p_order_id, auth.uid(), 'CHANGE_REQUEST', left(coalesce(p_body, ''), 5000));
end;
$$;

revoke all on function public.editorial_add_client_comment(uuid, text) from public, anon;
revoke all on function public.editorial_client_approve_proposal(uuid) from public, anon;
revoke all on function public.editorial_client_request_changes(uuid, text) from public, anon;
grant execute on function public.editorial_add_client_comment(uuid, text) to authenticated;
grant execute on function public.editorial_client_approve_proposal(uuid) to authenticated;
grant execute on function public.editorial_client_request_changes(uuid, text) to authenticated;

-- ---------------------------------------------------------------
-- 3. Núcleo de pagos (independiente del proveedor)
-- ---------------------------------------------------------------
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purpose text not null check (purpose in ('EDITORIAL_ORDER', 'BOOK', 'SUBSCRIPTION', 'CREDITS')),
  reference_id uuid,                     -- p. ej. editorial_orders.id
  kind text not null default 'ONE_TIME' check (kind in ('ONE_TIME', 'RECURRING')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')),
  provider text,                         -- MANUAL_TRANSFER, PAYPAL, AZUL, TOKE...
  provider_order_id text,
  idempotency_key text not null unique,  -- evita órdenes duplicadas
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payment_orders_user_idx on public.payment_orders (user_id, created_at desc);
create index if not exists payment_orders_reference_idx on public.payment_orders (purpose, reference_id);

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_order_id uuid not null references public.payment_orders(id) on delete restrict,
  provider text not null,
  provider_transaction_id text not null, -- id del proveedor o referencia bancaria
  kind text not null check (kind in ('CHARGE', 'REFUND')),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null,
  status text not null check (status in ('SUCCEEDED', 'FAILED', 'PENDING')),
  raw jsonb not null default '{}'::jsonb,
  recorded_by uuid,                      -- admin que verificó (pagos manuales)
  created_at timestamptz not null default now(),
  unique (provider, provider_transaction_id, kind)  -- un mismo cobro no se registra dos veces
);

alter table public.payment_orders enable row level security;
alter table public.payment_transactions enable row level security;
drop policy if exists payment_orders_read on public.payment_orders;
create policy payment_orders_read on public.payment_orders for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
drop policy if exists payment_transactions_read on public.payment_transactions;
create policy payment_transactions_read on public.payment_transactions for select to authenticated
  using (public.is_staff() or exists (select 1 from public.payment_orders o where o.id = payment_order_id and o.user_id = auth.uid()));
-- Sin políticas de escritura: solo el servidor (service_role) o las RPC de abajo.

/**
 * Admin: registrar un pago recibido por transferencia y verificado a mano.
 * Idempotente por (MANUAL_TRANSFER, referencia bancaria). Si el pago es de un
 * encargo editorial aprobado por el cliente, lo pasa a CONTRATADO.
 */
create or replace function public.admin_record_manual_payment(
  p_order_id uuid, p_amount numeric, p_currency text, p_bank_reference text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order public.editorial_orders; v_payment_id uuid; v_key text;
begin
  if not public.has_role(array['admin']) then raise exception 'Solo un administrador' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) <= 0 or coalesce(btrim(p_currency), '') = '' or coalesce(btrim(p_bank_reference), '') = '' then
    raise exception 'Importe, moneda y referencia bancaria son obligatorios';
  end if;
  select * into v_order from public.editorial_orders where id = p_order_id for update;
  if not found then raise exception 'Encargo no encontrado'; end if;
  if v_order.client_approved_at is null then raise exception 'El cliente aún no aprobó la propuesta'; end if;

  v_key := 'EDITORIAL_ORDER:' || p_order_id::text;
  insert into public.payment_orders(user_id, purpose, reference_id, kind, amount, currency, status, provider, idempotency_key)
  values (v_order.user_id, 'EDITORIAL_ORDER', p_order_id, 'ONE_TIME', p_amount, upper(p_currency), 'PENDING', 'MANUAL_TRANSFER', v_key)
  on conflict (idempotency_key) do nothing;
  select id into v_payment_id from public.payment_orders where idempotency_key = v_key;

  insert into public.payment_transactions(payment_order_id, provider, provider_transaction_id, kind, amount, currency, status, recorded_by, raw)
  values (v_payment_id, 'MANUAL_TRANSFER', btrim(p_bank_reference), 'CHARGE', p_amount, upper(p_currency), 'SUCCEEDED', auth.uid(),
          jsonb_build_object('note', p_note))
  on conflict (provider, provider_transaction_id, kind) do nothing;

  update public.payment_orders set status = 'PAID', paid_at = coalesce(paid_at, now()), updated_at = now()
   where id = v_payment_id;
  if v_order.status in ('PROPUESTA_ENVIADA', 'PENDIENTE_APROBACION') then
    update public.editorial_orders set status = 'CONTRATADO' where id = p_order_id;
  end if;
  insert into public.editorial_order_events(order_id, actor_id, kind, body)
  values (p_order_id, auth.uid(), 'PAYMENT', 'Pago confirmado por el equipo.');
  return v_payment_id;
end;
$$;
revoke all on function public.admin_record_manual_payment(uuid, numeric, text, text, text) from public, anon;
grant execute on function public.admin_record_manual_payment(uuid, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------
-- 4. Archivos privados de los encargos (Supabase Storage)
-- ---------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Storage no disponible (base de pruebas): se omite el bucket.';
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('editorial-files', 'editorial-files', false)
  on conflict (id) do update set public = false;

  execute 'drop policy if exists editorial_files_staff_all on storage.objects';
  execute $p$create policy editorial_files_staff_all on storage.objects for all to authenticated
    using (bucket_id = 'editorial-files' and public.is_staff())
    with check (bucket_id = 'editorial-files' and public.is_staff())$p$;
  execute 'drop policy if exists editorial_files_client_read on storage.objects';
  execute $p$create policy editorial_files_client_read on storage.objects for select to authenticated
    using (bucket_id = 'editorial-files' and exists (
      select 1 from public.editorial_deliverables d
      join public.editorial_orders o on o.id = d.order_id
      where d.file_path = storage.objects.name and d.visible_to_client and o.user_id = auth.uid()))$p$;
end;
$$;
