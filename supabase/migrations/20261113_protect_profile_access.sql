-- ============================================================
-- GENELIBROS — Proteger profiles.has_access
--
-- La app permite al usuario crear y editar su propia fila de profiles
-- (email, nombre, teléfono). Sin esta protección, ese mismo permiso le
-- dejaría cambiar has_access = true desde la consola del navegador y
-- aprobarse a sí mismo.
--
-- Este trigger hace que, para peticiones de usuarios (roles anon y
-- authenticated de Supabase):
--   - al crear su perfil, has_access siempre queda en false;
--   - no puedan cambiar has_access en una fila existente.
-- El administrador (Table Editor / SQL Editor) y el servidor
-- (service_role) pueden seguir aprobando usuarios con normalidad.
--
-- Ejecutar una vez en Supabase → SQL Editor (es idempotente).
-- ============================================================

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

do $$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'La tabla public.profiles no existe: no se instala el trigger.';
    return;
  end if;

  execute 'drop trigger if exists trg_protect_profile_has_access on public.profiles';
  execute 'create trigger trg_protect_profile_has_access
             before insert or update on public.profiles
             for each row execute function public.protect_profile_has_access()';
end;
$$;
