-- ============================================================
-- GENELIBROS — profiles.has_access por defecto false
--
-- En producción la columna tenía DEFAULT true, aunque el código asume
-- lo contrario ("la DB lo deja en false y solo el admin lo cambia").
-- Los perfiles que crea la app ya entran en false (política de insert y
-- trigger de 20261113), pero cualquier perfil creado por otra vía
-- (trigger de registro, script, panel de Supabase) quedaba aprobado.
--
-- Solo cambia el valor por defecto: los usuarios existentes conservan
-- su has_access actual. Idempotente.
-- ============================================================

alter table if exists public.profiles alter column has_access set default false;
