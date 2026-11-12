-- ============================================================
-- GENELIBROS — Vista de consumo diario por usuario
--
-- Resume api_rate_limits: cuántas llamadas hizo cada usuario cada día
-- y a qué (composer, os4, research, audit, jobs). Sirve como panel de
-- costes: quién gasta más y si alguien se acerca al límite.
--
-- Guarda 90 días de historial (antes la limpieza borraba todo a los 3 días).
-- Solo la ve el administrador (SQL / Table Editor) y el servidor.
-- Ejecutar una vez en Supabase → SQL Editor (es idempotente).
--
-- Consultas útiles:
--   select * from api_usage_daily where day = current_date;
--   select email, sum(calls) from api_usage_daily
--     where day > current_date - 30 group by email order by 2 desc;
-- ============================================================

-- 1) Conservar 90 días de ventanas diarias.
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
  -- Limpieza ocasional (~1% de las llamadas): ventanas por hora tras 3 días,
  -- ventanas por día tras 90 (historial para api_usage_daily).
  if random() < 0.01 then
    delete from public.api_rate_limits
    where (window_kind = 'hour' and window_start < now() - interval '3 days')
       or (window_kind = 'day'  and window_start < now() - interval '90 days');
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

-- 2) Vista de consumo.
create or replace view public.api_usage_daily
with (security_invoker = true)
as
select
  (r.window_start at time zone 'utc')::date as day,
  r.user_id,
  p.email,
  r.bucket,
  r.count as calls
from public.api_rate_limits r
left join public.profiles p on p.user_id = r.user_id
where r.window_kind = 'day';

revoke all on public.api_usage_daily from public, anon, authenticated;
grant select on public.api_usage_daily to service_role;

comment on view public.api_usage_daily is
  'Consumo diario por usuario y tipo de llamada (solo administrador). Historial de 90 días.';
