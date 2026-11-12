# Base de datos (Supabase)

## Dónde está cada cosa

| Ruta | Qué es |
|---|---|
| `supabase/install-order.txt` | **Orden único** para instalar el esquema en una base nueva |
| `supabase/migrations/` | Migraciones fechadas (cuotas, protección de `has_access`, vista de consumo, reconciliación) |
| `sql/*.sql` | Esquemas de cada módulo (OS4, refinery, deep-work, research, elite). Se quedan aquí porque varias pruebas de `scripts/` los leen por su ruta |
| `sql/*-verify.sql` | Consultas de solo lectura para comprobar que un módulo quedó instalado |
| `sql/os4-10b-scheduler-template.sql` | Plantilla del cron del worker OS4 (hay que rellenar URL y secreto; no forma parte de la instalación automática) |
| `device_session_gate.sql` | Sesión por dispositivo (1 cuenta = 1 dispositivo) |
| `supabase/rls-audit.sql` | Auditoría RLS de solo lectura |
| `supabase/test/` | Simulación de Supabase y prueba de humo para el test de instalación. **No ejecutar en producción** |

## Instalar en una base nueva

1. Crea en Supabase las tablas base de la app (`projects`, `sections`, `section_versions`, `master_documents`, `profiles`, `access_requests`, `user_settings`). *Aún no están versionadas en el repo.*
2. En **SQL Editor**, ejecuta uno a uno los archivos de `supabase/install-order.txt`, **en ese orden**.
3. Comprueba con `supabase/rls-audit.sql` que todas las tablas tienen RLS.

El orden importa: varias tablas (`generation_jobs`, `research_sources`, `subscription_plans`) se definen en más de un archivo con columnas distintas, y con `create table if not exists` gana el primero. `20261115_reconcile_shared_tables.sql` añade las columnas que falten y quita dos restricciones que bloqueaban la cola OS4, así que el resultado es el mismo empiece por donde empiece.

## Actualizar una base existente (producción)

Ejecuta las migraciones nuevas de `supabase/migrations/` que aún no hayas aplicado. Todas son **idempotentes**: ejecutarlas dos veces no hace daño.

`20261115_reconcile_shared_tables.sql` solo **añade** columnas que falten y elimina, si existen, `generation_jobs_job_type_check` y `generation_jobs_status_check`. Nunca borra datos.

## Prueba automática

`.github/workflows/database-schema.yml` monta un Postgres 16 vacío en cada PR que toque SQL y ejecuta `scripts/db-install-test.sh`:

1. `supabase/test/00_supabase_stub.sql` simula Supabase (roles, `auth.uid()`, tablas base mínimas).
2. Instala todo según `install-order.txt`.
3. `supabase/test/99_smoke.sql` hace lo mismo que el código: encolar un trabajo OS4 y uno de capítulo, y el `upsert` de fuentes del worker de investigación.
4. Ejecuta de nuevo la reconciliación para comprobar que es idempotente.

En local, contra una base **de pruebas** vacía:

```bash
DATABASE_URL=postgres://usuario:clave@localhost:5432/prueba bash scripts/db-install-test.sh
```
