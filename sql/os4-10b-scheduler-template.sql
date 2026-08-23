-- ============================================================
-- BESTSELLER OS4 10B — SCHEDULER SUPABASE CRON
-- EJECUTAR DESPUÉS DE:
-- 1) desplegar /api/os4-worker en Vercel
-- 2) crear OS4_WORKER_SECRET en Vercel
--
-- IMPORTANTE:
-- Reemplaza exactamente:
--   https://TU-DOMINIO.com/api/os4-worker
--   CAMBIA_ESTE_SECRETO_LARGO
-- por valores reales.
--
-- Supabase Vault mantiene el secreto cifrado.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Si ya creaste secretos con estos nombres, no vuelvas a ejecutar
-- estas dos líneas sin antes revisar Vault.
select vault.create_secret(
  'https://TU-DOMINIO.com/api/os4-worker',
  'os4_worker_url'
);

select vault.create_secret(
  'CAMBIA_ESTE_SECRETO_LARGO',
  'os4_worker_secret'
);

-- El nombre del job es estable; cron.schedule con el mismo nombre
-- actualiza/reemplaza la programación en Supabase Cron.
select cron.schedule(
  'bestseller-os4-durable-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'os4_worker_url'
      order by created_at desc
      limit 1
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-os4-worker-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'os4_worker_secret'
        order by created_at desc
        limit 1
      )
    ),
    body := jsonb_build_object(
      'source', 'supabase-cron',
      'scheduled_at', now()
    ),
    timeout_milliseconds := 10000
  ) as request_id;
  $$
);

-- VERIFICACIÓN:
select jobid, jobname, schedule, active
from cron.job
where jobname = 'bestseller-os4-durable-worker';
