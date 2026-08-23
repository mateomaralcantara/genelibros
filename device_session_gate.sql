-- device_session_gate.sql
-- ✅ 1 cuenta = 1 dispositivo activo
-- ✅ 30 minutos sin actividad = sesión vencida
-- ✅ Nuevo dispositivo puede cerrar la sesión anterior y entrar
-- Ejecutar en Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_label text,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_sessions_user_active
on public.device_sessions (user_id, revoked_at, last_seen_at desc);

create index if not exists idx_device_sessions_user_device
on public.device_sessions (user_id, device_id);

alter table public.device_sessions enable row level security;

drop policy if exists "device_sessions_select_own" on public.device_sessions;
create policy "device_sessions_select_own"
on public.device_sessions
for select
using (auth.uid() = user_id);

-- No abrimos insert/update/delete al cliente.
-- Todo se maneja por RPC security definer.

create or replace function public.claim_device_session(
  p_device_id text,
  p_device_label text default null,
  p_user_agent text default null
)
returns table (
  session_id uuid,
  device_id text,
  device_label text,
  last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id uuid;
begin
  if v_user_id is null then
    raise exception 'No autenticado.';
  end if;

  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'device_id inválido.';
  end if;

  update public.device_sessions
  set revoked_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and revoked_at is null;

  insert into public.device_sessions (
    user_id,
    device_id,
    device_label,
    user_agent,
    last_seen_at,
    revoked_at,
    created_at,
    updated_at
  )
  values (
    v_user_id,
    trim(p_device_id),
    nullif(trim(coalesce(p_device_label, '')), ''),
    nullif(trim(coalesce(p_user_agent, '')), ''),
    now(),
    null,
    now(),
    now()
  )
  returning id into v_session_id;

  return query
  select
    ds.id,
    ds.device_id,
    ds.device_label,
    ds.last_seen_at
  from public.device_sessions ds
  where ds.id = v_session_id;
end;
$$;

grant execute on function public.claim_device_session(text, text, text) to authenticated;

create or replace function public.touch_device_session(
  p_device_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated int := 0;
begin
  if v_user_id is null then
    return false;
  end if;

  update public.device_sessions
  set last_seen_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and device_id = trim(p_device_id)
    and revoked_at is null
    and last_seen_at > now() - interval '30 minutes';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.touch_device_session(text) to authenticated;

create or replace function public.revoke_my_device_session(
  p_device_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated int := 0;
begin
  if v_user_id is null then
    return false;
  end if;

  update public.device_sessions
  set revoked_at = now(),
      updated_at = now()
  where user_id = v_user_id
    and device_id = trim(p_device_id)
    and revoked_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.revoke_my_device_session(text) to authenticated;

create or replace function public.get_active_device_session(
  p_device_id text
)
returns table (
  has_other_active_device boolean,
  active_device_label text,
  active_last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'No autenticado.';
  end if;

  return query
  select
    exists (
      select 1
      from public.device_sessions ds
      where ds.user_id = v_user_id
        and ds.revoked_at is null
        and ds.last_seen_at > now() - interval '30 minutes'
        and ds.device_id <> trim(p_device_id)
    ) as has_other_active_device,
    (
      select ds.device_label
      from public.device_sessions ds
      where ds.user_id = v_user_id
        and ds.revoked_at is null
        and ds.last_seen_at > now() - interval '30 minutes'
        and ds.device_id <> trim(p_device_id)
      order by ds.last_seen_at desc
      limit 1
    ) as active_device_label,
    (
      select ds.last_seen_at
      from public.device_sessions ds
      where ds.user_id = v_user_id
        and ds.revoked_at is null
        and ds.last_seen_at > now() - interval '30 minutes'
        and ds.device_id <> trim(p_device_id)
      order by ds.last_seen_at desc
      limit 1
    ) as active_last_seen_at;
end;
$$;

grant execute on function public.get_active_device_session(text) to authenticated;
