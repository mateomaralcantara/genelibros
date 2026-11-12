-- ============================================================
-- GENELIBROS — Límite de uso por usuario (rate limit)
--
-- Cuenta las llamadas de cada usuario a los endpoints que cuestan
-- dinero (Gemini, investigación web) en ventanas de 1 hora y 1 día.
-- Lo usa el servidor (service role) a través de consume_api_quota().
-- Los usuarios no pueden leer ni escribir esta tabla directamente.
--
-- Ejecutar una vez en Supabase → SQL Editor (es idempotente).
-- ============================================================

create table if not exists public.api_rate_limits (
  user_id uuid not null,
  bucket text not null,
  window_kind text not null check (window_kind in ('hour', 'day')),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, bucket, window_kind, window_start)
);

create index if not exists idx_api_rate_limits_window_start
  on public.api_rate_limits (window_start);

-- RLS activo y sin políticas: solo service_role (que salta RLS) accede.
alter table public.api_rate_limits enable row level security;

create or replace function public.consume_api_quota(
  p_user_id uuid,
  p_bucket text,
  p_hourly_limit integer,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hour_start timestamptz := date_trunc('hour', now());
  v_day_start  timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_hour_count integer;
  v_day_count  integer;
begin
  -- Limpieza ocasional de ventanas viejas (~1% de las llamadas).
  if random() < 0.01 then
    delete from public.api_rate_limits where window_start < now() - interval '3 days';
  end if;

  -- Ventana por hora: incrementa solo si no se ha alcanzado el límite.
  if coalesce(p_hourly_limit, 0) > 0 then
    insert into public.api_rate_limits as r (user_id, bucket, window_kind, window_start, count)
    values (p_user_id, p_bucket, 'hour', v_hour_start, 1)
    on conflict (user_id, bucket, window_kind, window_start)
    do update set count = r.count + 1
    where r.count < p_hourly_limit
    returning r.count into v_hour_count;

    if v_hour_count is null then
      return jsonb_build_object(
        'allowed', false,
        'scope', 'hour',
        'limit', p_hourly_limit,
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_hour_start + interval '1 hour' - now())))::integer)
      );
    end if;
  end if;

  -- Ventana por día.
  if coalesce(p_daily_limit, 0) > 0 then
    insert into public.api_rate_limits as r (user_id, bucket, window_kind, window_start, count)
    values (p_user_id, p_bucket, 'day', v_day_start, 1)
    on conflict (user_id, bucket, window_kind, window_start)
    do update set count = r.count + 1
    where r.count < p_daily_limit
    returning r.count into v_day_count;

    if v_day_count is null then
      -- Devolver la unidad consumida en la ventana horaria.
      if v_hour_count is not null then
        update public.api_rate_limits
        set count = greatest(0, count - 1)
        where user_id = p_user_id and bucket = p_bucket
          and window_kind = 'hour' and window_start = v_hour_start;
      end if;

      return jsonb_build_object(
        'allowed', false,
        'scope', 'day',
        'limit', p_daily_limit,
        'retry_after_seconds', greatest(1, ceil(extract(epoch from (v_day_start + interval '1 day' - now())))::integer)
      );
    end if;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'hour_count', v_hour_count,
    'day_count', v_day_count
  );
end;
$$;

revoke all on function public.consume_api_quota(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_quota(uuid, text, integer, integer) to service_role;
