-- ============================================================
-- GENELIBROS — Cobro de productos del catálogo: PayPal y transferencia
--
-- * El importe SIEMPRE sale del catálogo (pricing_catalog) o de la
--   propuesta del encargo editorial, nunca del navegador.
-- * Un pedido solo pasa a PAID cuando:
--     - PayPal: el servidor captura la orden y PayPal responde COMPLETED
--       (o llega el webhook firmado PAYMENT.CAPTURE.COMPLETED), o
--     - transferencia: un administrador la verifica.
-- * Al pagarse se "entrega" una sola vez (fulfilled_at): créditos en el
--   monedero, acceso a la app (profiles.has_access) o encargo CONTRATADO.
--
-- Requiere 20261118 y 20261119. Idempotente.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Columnas nuevas en payment_orders
-- ---------------------------------------------------------------
alter table public.payment_orders add column if not exists catalog_code text references public.pricing_catalog(code);
alter table public.payment_orders add column if not exists credits integer;
alter table public.payment_orders add column if not exists transfer_reference text;  -- la que informa el cliente
alter table public.payment_orders add column if not exists fulfilled_at timestamptz;
create index if not exists payment_orders_pending_idx on public.payment_orders (status, provider, created_at desc);

-- ---------------------------------------------------------------
-- 2. Monedero de créditos (libro de movimientos)
-- ---------------------------------------------------------------
create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  delta integer not null check (delta <> 0),
  reason text not null,
  payment_order_id uuid references public.payment_orders(id),
  created_at timestamptz not null default now()
);
-- Un pago entrega créditos una sola vez.
create unique index if not exists credit_ledger_payment_uniq on public.credit_ledger (payment_order_id) where payment_order_id is not null;
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

alter table public.credit_ledger enable row level security;
drop policy if exists credit_ledger_read on public.credit_ledger;
create policy credit_ledger_read on public.credit_ledger for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
-- Sin escritura directa: solo funciones del servidor.

create or replace view public.credit_balances with (security_invoker = true) as
  select user_id, sum(delta)::integer as balance from public.credit_ledger group by user_id;
grant select on public.credit_balances to authenticated;

-- ---------------------------------------------------------------
-- 3. Métodos de pago (configurables por el admin)
-- ---------------------------------------------------------------
insert into public.pricing_settings(key, value) values ('payment_methods', '{
  "paypal_enabled": false,
  "transfer_enabled": true,
  "transfer_instructions": "Escribe aquí los datos de tu cuenta: banco, tipo de cuenta, número, titular, cédula/RNC y el correo o WhatsApp donde el cliente envía el comprobante."
}')
on conflict (key) do nothing;

-- Cualquier usuario autenticado puede leer los métodos de pago (no el resto de ajustes).
drop policy if exists pricing_settings_payment_methods_read on public.pricing_settings;
create policy pricing_settings_payment_methods_read on public.pricing_settings for select to authenticated
  using (key = 'payment_methods');

-- ---------------------------------------------------------------
-- 4. Permitir que la entrega de un pago active has_access
--    (el trigger de 20261113 lo bloquea para usuarios; las funciones
--    de entrega marcan app.payment_fulfillment = on durante la transacción).
-- ---------------------------------------------------------------
create or replace function public.protect_profile_has_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
begin
  if coalesce(current_setting('app.payment_fulfillment', true), '') = 'on' then
    return new;
  end if;
  if v_role in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.has_access := false;
    elsif new.has_access is distinct from old.has_access then
      raise exception 'has_access solo puede cambiarlo un administrador'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 5. Entrega de un pedido pagado (una sola vez)
-- ---------------------------------------------------------------
create or replace function public.fulfill_payment_order(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.payment_orders;
begin
  select * into v from public.payment_orders where id = p_payment_id for update;
  if not found or v.status <> 'PAID' or v.fulfilled_at is not null then return; end if;

  perform set_config('app.payment_fulfillment', 'on', true);

  if v.purpose in ('BOOK', 'CREDITS', 'SUBSCRIPTION') then
    if coalesce(v.credits, 0) > 0 then
      insert into public.credit_ledger(user_id, delta, reason, payment_order_id)
      values (v.user_id, v.credits, 'Compra ' || coalesce(v.catalog_code, v.purpose), v.id)
      on conflict do nothing;
    end if;
    update public.profiles set has_access = true where user_id = v.user_id and has_access is distinct from true;
  elsif v.purpose = 'EDITORIAL_ORDER' and v.reference_id is not null then
    update public.editorial_orders set status = 'CONTRATADO'
     where id = v.reference_id and status in ('PROPUESTA_ENVIADA', 'PENDIENTE_APROBACION');
    insert into public.editorial_order_events(order_id, actor_id, kind, body)
    values (v.reference_id, auth.uid(), 'PAYMENT', 'Pago confirmado (' || coalesce(v.provider, '') || ').');
  end if;

  perform set_config('app.payment_fulfillment', 'off', true);
  update public.payment_orders set fulfilled_at = now(), updated_at = now() where id = v.id;
end;
$$;
revoke all on function public.fulfill_payment_order(uuid) from public, anon, authenticated;
grant execute on function public.fulfill_payment_order(uuid) to service_role;

/**
 * Servidor (PayPal): registrar un cobro confirmado por el proveedor.
 * Idempotente por (PAYPAL, id de captura). Comprueba importe y moneda.
 */
create or replace function public.record_provider_payment(
  p_payment_id uuid, p_provider text, p_transaction_id text, p_amount numeric, p_currency text, p_raw jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v public.payment_orders;
begin
  select * into v from public.payment_orders where id = p_payment_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v.provider is distinct from p_provider then raise exception 'Proveedor distinto al del pedido'; end if;
  if round(p_amount, 2) <> round(v.amount, 2) or upper(p_currency) <> upper(v.currency) then
    raise exception 'El importe cobrado no coincide con el pedido';
  end if;
  insert into public.payment_transactions(payment_order_id, provider, provider_transaction_id, kind, amount, currency, status, raw)
  values (v.id, p_provider, p_transaction_id, 'CHARGE', p_amount, upper(p_currency), 'SUCCEEDED', coalesce(p_raw, '{}'::jsonb))
  on conflict (provider, provider_transaction_id, kind) do nothing;
  if v.status = 'PENDING' then
    update public.payment_orders set status = 'PAID', paid_at = now(), updated_at = now() where id = v.id;
  end if;
  perform public.fulfill_payment_order(v.id);
  return 'PAID';
end;
$$;
revoke all on function public.record_provider_payment(uuid, text, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_payment(uuid, text, text, numeric, text, jsonb) to service_role;

-- ---------------------------------------------------------------
-- 6. Cliente: pedir pago por transferencia de un producto del catálogo
-- ---------------------------------------------------------------
create or replace function public.client_create_transfer_order(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.pricing_catalog; v_id uuid; v_purpose text; v_methods jsonb;
begin
  if auth.uid() is null then raise exception 'Inicia sesión' using errcode = '42501'; end if;
  select value into v_methods from public.pricing_settings where key = 'payment_methods';
  if coalesce((v_methods ->> 'transfer_enabled')::boolean, false) is not true then
    raise exception 'El pago por transferencia no está disponible';
  end if;
  select * into c from public.pricing_catalog where code = p_code and active;
  if not found or c.price_usd is null or c.price_usd <= 0 or c.kind not in ('BOOK', 'CREDIT_PACK', 'SUBSCRIPTION') then
    raise exception 'Producto no disponible';
  end if;
  v_purpose := case c.kind when 'BOOK' then 'BOOK' when 'CREDIT_PACK' then 'CREDITS' else 'SUBSCRIPTION' end;

  -- Reutiliza un pedido pendiente del mismo producto (evita duplicados).
  select id into v_id from public.payment_orders
   where user_id = auth.uid() and catalog_code = c.code and status = 'PENDING' and provider = 'MANUAL_TRANSFER'
   order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.payment_orders(user_id, purpose, kind, amount, currency, status, provider, idempotency_key, catalog_code, credits)
  values (auth.uid(), v_purpose, 'ONE_TIME', c.price_usd, 'USD', 'PENDING', 'MANUAL_TRANSFER',
          'TRANSFER:' || gen_random_uuid()::text, c.code, c.credits)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.client_create_transfer_order(text) from public, anon;
grant execute on function public.client_create_transfer_order(text) to authenticated;

/** Cliente: informar la referencia/comprobante de su transferencia. No marca nada como pagado. */
create or replace function public.client_report_transfer(p_payment_id uuid, p_reference text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(btrim(p_reference), '') = '' then raise exception 'Escribe la referencia de la transferencia'; end if;
  update public.payment_orders set transfer_reference = left(btrim(p_reference), 200), updated_at = now()
   where id = p_payment_id and user_id = auth.uid() and status = 'PENDING' and provider = 'MANUAL_TRANSFER';
  if not found then raise exception 'Pedido no encontrado o ya procesado'; end if;
end;
$$;
revoke all on function public.client_report_transfer(uuid, text) from public, anon;
grant execute on function public.client_report_transfer(uuid, text) to authenticated;

/** Cliente: cancelar su propio pedido pendiente. */
create or replace function public.client_cancel_payment_order(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.payment_orders set status = 'CANCELLED', updated_at = now()
   where id = p_payment_id and user_id = auth.uid() and status = 'PENDING';
end;
$$;
revoke all on function public.client_cancel_payment_order(uuid) from public, anon;
grant execute on function public.client_cancel_payment_order(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 7. Admin: confirmar (o rechazar) una transferencia de un pedido del catálogo
-- ---------------------------------------------------------------
create or replace function public.admin_confirm_transfer(p_payment_id uuid, p_bank_reference text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.payment_orders;
begin
  if not public.has_role(array['admin']) then raise exception 'Solo un administrador' using errcode = '42501'; end if;
  if coalesce(btrim(p_bank_reference), '') = '' then raise exception 'La referencia bancaria es obligatoria'; end if;
  select * into v from public.payment_orders where id = p_payment_id for update;
  if not found or v.provider <> 'MANUAL_TRANSFER' then raise exception 'Pedido no encontrado'; end if;
  if v.status not in ('PENDING', 'PAID') then raise exception 'El pedido está %', v.status; end if;

  insert into public.payment_transactions(payment_order_id, provider, provider_transaction_id, kind, amount, currency, status, recorded_by, raw)
  values (v.id, 'MANUAL_TRANSFER', btrim(p_bank_reference), 'CHARGE', v.amount, v.currency, 'SUCCEEDED', auth.uid(),
          jsonb_build_object('note', p_note))
  on conflict (provider, provider_transaction_id, kind) do nothing;
  update public.payment_orders set status = 'PAID', paid_at = coalesce(paid_at, now()), updated_at = now()
   where id = v.id and status = 'PENDING';
  perform public.fulfill_payment_order(v.id);
end;
$$;
revoke all on function public.admin_confirm_transfer(uuid, text, text) from public, anon;
grant execute on function public.admin_confirm_transfer(uuid, text, text) to authenticated;

create or replace function public.admin_reject_payment_order(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(array['admin']) then raise exception 'Solo un administrador' using errcode = '42501'; end if;
  update public.payment_orders set status = 'FAILED', updated_at = now() where id = p_payment_id and status = 'PENDING';
end;
$$;
revoke all on function public.admin_reject_payment_order(uuid) from public, anon;
grant execute on function public.admin_reject_payment_order(uuid) to authenticated;

-- La entrega desde funciones de admin necesita poder llamar a fulfill (owner = postgres, security definer: ok).

notify pgrst, 'reload schema';
