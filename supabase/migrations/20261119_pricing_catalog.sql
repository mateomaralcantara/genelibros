-- ============================================================
-- LIBROSELLER — Motor de precios (Pricing Engine): catálogo en US$
--
-- Todos los precios viven AQUÍ (datos), no en el código. El administrador
-- los cambia desde el panel ("Precios"). Los valores de abajo son la carga
-- inicial definida por el autor (noviembre 2026); "on conflict do nothing"
-- garantiza que volver a ejecutar la migración NO pisa los cambios hechos
-- desde el panel.
--
-- Tipos de producto:
--   BOOK            A. Libro con un clic (pago único)
--   CREDIT_PACK     B. Paquetes de créditos
--   SUBSCRIPTION    C. Suscripciones mensuales (créditos incluidos)
--   EDITORIAL_TIER  D. Rangos del servicio editorial por complejidad
--   CREDIT_COST     Consumo de créditos por operación
-- Y pricing_settings guarda los parámetros del cotizador editorial.
--
-- Requiere 20261118_roles_editorial_payments.sql (has_role). Idempotente.
-- ============================================================

create table if not exists public.pricing_catalog (
  code text primary key,
  kind text not null check (kind in ('BOOK', 'CREDIT_PACK', 'SUBSCRIPTION', 'EDITORIAL_TIER', 'CREDIT_COST')),
  name text not null,
  description text,
  price_usd numeric(12,2) check (price_usd is null or price_usd >= 0),       -- precio (o "desde" en EDITORIAL_TIER)
  max_price_usd numeric(12,2) check (max_price_usd is null or max_price_usd >= 0), -- "hasta" (EDITORIAL_TIER)
  credits integer check (credits is null or credits >= 0),                   -- créditos que da o que cuesta
  billing_interval text check (billing_interval in ('month', 'year')),
  features jsonb not null default '[]'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists pricing_catalog_kind_idx on public.pricing_catalog (kind, sort_order);

create table if not exists public.pricing_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Historial de cambios de precios (auditoría).
create table if not exists public.pricing_changes (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  item_key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create or replace function public.log_pricing_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  v_key := coalesce(to_jsonb(new)->>'code', to_jsonb(new)->>'key');
  insert into public.pricing_changes(table_name, item_key, old_value, new_value, changed_by)
  values (tg_table_name, v_key, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end;
$$;
drop trigger if exists trg_pricing_catalog_change on public.pricing_catalog;
create trigger trg_pricing_catalog_change before insert or update on public.pricing_catalog
  for each row execute function public.log_pricing_change();
drop trigger if exists trg_pricing_settings_change on public.pricing_settings;
create trigger trg_pricing_settings_change before insert or update on public.pricing_settings
  for each row execute function public.log_pricing_change();

alter table public.pricing_catalog enable row level security;
alter table public.pricing_settings enable row level security;
alter table public.pricing_changes enable row level security;

-- Los precios activos son públicos (páginas de precios); solo admin escribe.
drop policy if exists pricing_catalog_read on public.pricing_catalog;
create policy pricing_catalog_read on public.pricing_catalog for select to anon, authenticated
  using (active or public.has_role(array['admin']));
drop policy if exists pricing_catalog_admin on public.pricing_catalog;
create policy pricing_catalog_admin on public.pricing_catalog for all to authenticated
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

drop policy if exists pricing_settings_read on public.pricing_settings;
create policy pricing_settings_read on public.pricing_settings for select to authenticated using (public.is_staff());
drop policy if exists pricing_settings_admin on public.pricing_settings;
create policy pricing_settings_admin on public.pricing_settings for all to authenticated
  using (public.has_role(array['admin'])) with check (public.has_role(array['admin']));

drop policy if exists pricing_changes_read on public.pricing_changes;
create policy pricing_changes_read on public.pricing_changes for select to authenticated using (public.has_role(array['admin']));

-- ---------------------------------------------------------------
-- Carga inicial (US$). No pisa cambios hechos desde el panel.
-- ---------------------------------------------------------------
insert into public.pricing_catalog (code, kind, name, description, price_usd, max_price_usd, credits, billing_interval, features, limits, sort_order) values
-- A. Libro con un clic
('BOOK_ONE_CLICK', 'BOOK', 'Libro con un clic', 'Genera tu libro completo y descárgalo, sin suscripción.', 15, null, 150, null,
 '["Generación automatizada con GeneSeller","Estructura de capítulos","Desarrollo del manuscrito","Portada básica","Exportación PDF y DOCX","Corrección automática básica"]',
 '{"books":1}', 10),
-- B. Créditos (1 crédito ≈ US$0.10; bonificación por volumen)
('CREDITS_100',  'CREDIT_PACK', 'Paquete Inicial',     '100 créditos.',                   10, null, 100,  null, '[]', '{"bonus_percent":0}',  20),
('CREDITS_275',  'CREDIT_PACK', 'Paquete Autor',       '275 créditos (+10 % de regalo).',  25, null, 275,  null, '[]', '{"bonus_percent":10}', 21),
('CREDITS_600',  'CREDIT_PACK', 'Paquete Profesional', '600 créditos (+20 % de regalo).',  50, null, 600,  null, '[]', '{"bonus_percent":20}', 22),
('CREDITS_1300', 'CREDIT_PACK', 'Paquete Editorial',   '1.300 créditos (+30 % de regalo).', 100, null, 1300, null, '[]', '{"bonus_percent":30}', 23),
-- C. Suscripciones mensuales
('SUB_AUTOR_INICIAL', 'SUBSCRIPTION', 'Autor Inicial', 'Para crear y administrar tus primeros libros.', 25, null, 300, 'month',
 '["300 créditos al mes","2 proyectos activos","Exportación PDF y DOCX","Edición con EditorSeller"]', '{"active_projects":2,"seats":1}', 30),
('SUB_AUTOR_PROFESIONAL', 'SUBSCRIPTION', 'Autor Profesional', 'Producción frecuente y edición avanzada.', 59, null, 800, 'month',
 '["800 créditos al mes","5 proyectos activos","Edición avanzada","Investigación documentada","Soporte prioritario"]', '{"active_projects":5,"seats":1}', 31),
('SUB_AUTOR_PREMIUM', 'SUBSCRIPTION', 'Autor Premium', 'Mayor volumen y herramientas especializadas.', 99, null, 1500, 'month',
 '["1.500 créditos al mes","15 proyectos activos","Todas las herramientas profesionales","Auditoría de manuscrito","Soporte prioritario"]', '{"active_projects":15,"seats":1}', 32),
('SUB_EDITORIAL', 'SUBSCRIPTION', 'Editorial', 'Varios autores y proyectos simultáneos.', 200, null, 3500, 'month',
 '["3.500 créditos al mes","Proyectos ilimitados","Hasta 5 autores","Gestión de proyectos","Soporte dedicado"]', '{"active_projects":null,"seats":5}', 33),
-- D. Servicio editorial por complejidad (desde – hasta)
('EDITORIAL_GUIA', 'EDITORIAL_TIER', 'Guía o ebook corto', 'Hasta ~15.000 palabras. Complejidad baja.', 100, 300, null, null,
 '["Entrevista con el autor","Estructuración","Redacción profesional","Corrección de estilo"]', '{"complexity":"BAJA"}', 40),
('EDITORIAL_MEDIA', 'EDITORIAL_TIER', 'Autobiografía o motivacional', 'Basado en entrevistas. Complejidad media.', 300, 800, null, null,
 '["Entrevistas con el autor","Estructuración","Redacción profesional","Corrección de estilo","Diseño y diagramación"]', '{"complexity":"MEDIA"}', 41),
('EDITORIAL_EMPRESARIAL', 'EDITORIAL_TIER', 'Libro empresarial', 'Complejidad media-alta.', 600, 1200, null, null,
 '["Entrevistas","Investigación de apoyo","Redacción profesional","Corrección de estilo","Diseño y diagramación"]', '{"complexity":"MEDIA_ALTA"}', 42),
('EDITORIAL_DOCUMENTADO', 'EDITORIAL_TIER', 'Histórico o documentado', 'Investigación documental. Complejidad alta.', 900, 1600, null, null,
 '["Investigación documental","Fuentes y referencias","Redacción profesional","Verificación de referencias","Diseño y diagramación"]', '{"complexity":"ALTA"}', 43),
('EDITORIAL_ESPECIALIZADO', 'EDITORIAL_TIER', 'Científico, académico o técnico', 'Complejidad muy alta.', 1200, 2000, null, null,
 '["Investigación especializada","Fuentes y referencias académicas","Redacción técnica","Revisión experta","Diseño y diagramación"]', '{"complexity":"MUY_ALTA"}', 44),
-- Consumo de créditos por operación
('COST_OUTLINE',        'CREDIT_COST', 'Crear esquema e índice', null, null, null, 10,  null, '[]', '{"unit":"operación"}', 50),
('COST_CHAPTER',        'CREDIT_COST', 'Crear capítulo',          null, null, null, 25,  null, '[]', '{"unit":"capítulo"}', 51),
('COST_FULL_BOOK',      'CREDIT_COST', 'Generar libro completo',  null, null, null, 150, null, '[]', '{"unit":"libro"}', 52),
('COST_RESEARCH',       'CREDIT_COST', 'Investigar y documentar', null, null, null, 40,  null, '[]', '{"unit":"capítulo"}', 53),
('COST_REWRITE',        'CREDIT_COST', 'Reescribir capítulo',     null, null, null, 20,  null, '[]', '{"unit":"capítulo"}', 54),
('COST_PROOFREAD_1K',   'CREDIT_COST', 'Corregir manuscrito',     null, null, null, 3,   null, '[]', '{"unit":"1.000 palabras"}', 55),
('COST_TRANSLATE_1K',   'CREDIT_COST', 'Traducir libro',          null, null, null, 8,   null, '[]', '{"unit":"1.000 palabras"}', 56),
('COST_COVER',          'CREDIT_COST', 'Crear portada',           null, null, null, 30,  null, '[]', '{"unit":"portada"}', 57)
on conflict (code) do nothing;

insert into public.pricing_settings (key, value) values
('editorial_quote', '{
  "currency": "USD",
  "min_usd": 100,
  "max_usd": 2000,
  "base_by_complexity": {"BAJA": 80, "MEDIA": 150, "MEDIA_ALTA": 250, "ALTA": 350, "MUY_ALTA": 500},
  "per_1000_words_by_complexity": {"BAJA": 8, "MEDIA": 12, "MEDIA_ALTA": 16, "ALTA": 20, "MUY_ALTA": 26},
  "per_interview": 25,
  "research": {"NINGUNA": 0, "BASICA": 100, "AMPLIA": 300},
  "design_layout": 120,
  "cover_design": 80,
  "per_revision_round": 40,
  "rush_multiplier": 1.25
}')
on conflict (key) do nothing;
