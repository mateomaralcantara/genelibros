-- ============================================================
-- GENELIBROS — Auditoría de seguridad RLS (solo lectura)
--
-- Ejecutar en Supabase → SQL Editor. No modifica nada.
-- Lista cada tabla de public con:
--   rls      → si Row Level Security está activado
--   policies → reglas definidas (comando: condición)
--   alerta   → problemas detectados
-- ============================================================

with tables as (
  select c.oid, c.relname as table_name, c.relrowsecurity as rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
pol as (
  select tablename,
         string_agg(
           cmd || ' [' || array_to_string(roles, ',') || ']: ' ||
           coalesce(qual, 'true') ||
           coalesce(' / check: ' || with_check, ''),
           E'\n' order by cmd, policyname
         ) as policies,
         bool_or(coalesce(qual, 'true') = 'true' and cmd in ('SELECT', 'ALL')
                 and tablename not in ('subscription_plans')) as open_read,
         bool_or(coalesce(qual, 'true') = 'true' and cmd in ('UPDATE', 'DELETE', 'ALL')) as open_write
  from pg_policies
  where schemaname = 'public'
  group by tablename
)
select
  t.table_name,
  t.rls,
  coalesce(p.policies, '(sin políticas)') as policies,
  case
    when not t.rls then '🔴 RLS DESACTIVADO: cualquiera con la anon key puede leer/escribir'
    when p.open_write then '🔴 Política de escritura sin condición (true)'
    when p.open_read then '🟠 Lectura sin condición (true): cada usuario ve las filas de todos'
    when p.policies is null then '🟢 Bloqueada para usuarios (solo servidor)'
    else '🟢 Revisar que las condiciones usen auth.uid()'
  end as alerta
from tables t
left join pol p on p.tablename = t.table_name
order by (not t.rls) desc, p.open_write desc nulls last, t.table_name;
