-- ============================================================
-- GENELIBROS — Plan gratis
--
-- Cualquier usuario registrado (sin pago ni aprobación) puede:
--   lanzar su encargo (prompt), obtener el título general y los títulos
--   de los capítulos (expediente + índice), hasta un tope de palabras.
-- Para propuesta, introducción, capítulos y el resto de herramientas
-- debe pasar a un plan de pago.
--
-- El tope y lo que incluye se editan en Panel del equipo → Precios
-- (fila FREE_PLAN: limits.max_words). El servidor lleva la cuenta de
-- palabras en free_plan_usage; el usuario solo puede leer la suya.
--
-- Requiere 20261119. Idempotente.
-- ============================================================

-- 1. Nueva categoría FREE en el catálogo.
alter table public.pricing_catalog drop constraint if exists pricing_catalog_kind_check;
alter table public.pricing_catalog add constraint pricing_catalog_kind_check
  check (kind in ('FREE', 'BOOK', 'CREDIT_PACK', 'SUBSCRIPTION', 'EDITORIAL_TIER', 'CREDIT_COST'));

insert into public.pricing_catalog (code, kind, name, description, price_usd, max_price_usd, credits, billing_interval, features, limits, sort_order) values
('FREE_PLAN', 'FREE', 'Plan gratis', 'Empieza tu libro sin pagar.', 0, null, null, null,
 '["Lanza tu idea o usa el planificador de prompt","Título general del libro","Títulos de todos los capítulos","Hasta 5.000 palabras"]',
 '{"max_words":5000}', 0)
on conflict (code) do nothing;

-- 2. Consumo del plan gratis (lo escribe solo el servidor).
create table if not exists public.free_plan_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  words_used integer not null default 0 check (words_used >= 0),
  generations integer not null default 0 check (generations >= 0),
  updated_at timestamptz not null default now()
);
alter table public.free_plan_usage enable row level security;
drop policy if exists free_plan_usage_read on public.free_plan_usage;
create policy free_plan_usage_read on public.free_plan_usage for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

create or replace function public.free_plan_record(p_user_id uuid, p_words integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.free_plan_usage(user_id, words_used, generations, updated_at)
  values (p_user_id, greatest(coalesce(p_words, 0), 0), 1, now())
  on conflict (user_id) do update
    set words_used = public.free_plan_usage.words_used + greatest(coalesce(p_words, 0), 0),
        generations = public.free_plan_usage.generations + 1,
        updated_at = now()
  returning words_used into v;
  return v;
end;
$$;
revoke all on function public.free_plan_record(uuid, integer) from public, anon, authenticated;
grant execute on function public.free_plan_record(uuid, integer) to service_role;

notify pgrst, 'reload schema';
