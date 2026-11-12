# GeneLibros

Aplicación web para escribir libros completos con IA: a partir de un encargo del autor genera la propuesta editorial, el índice, la introducción y los capítulos, con investigación de fuentes, auditoría del manuscrito y mejora profunda por capítulo.

Producción: **https://gene.libroseller.com**

## Arquitectura

| Capa | Tecnología | Dónde |
|---|---|---|
| Frontend | React 19 + Vite + Tailwind | `App.tsx`, `components/`, `src/lib/`, `src/data/` |
| API | Funciones serverless de Vercel (Node 22, ESM) | `api/` (puntos de entrada) y `src/server/` (lógica) |
| Datos y usuarios | Supabase (Postgres + Auth + RLS) | `supabase/migrations/`, `sql/` |
| IA | Google Gemini (solo desde el servidor en producción) | `api/composer.ts`, `src/server/*-runtime.ts` |
| Trabajos largos | Colas en Supabase + workers protegidos por secreto | `*-jobs` y `*-worker` |

```text
Navegador ──(sesión Supabase)──▶ api/composer, os4, research, *-jobs ──▶ Gemini
                                   │  1. requireUserOrWorker  (¿quién eres?)
                                   │  2. requireApprovedAccess (profiles.has_access)
                                   │  3. enforceQuota          (límite por usuario)
Cron / workers ──(x-worker-secret)─▶ api/*-worker  ──▶ procesan las colas
```

Rutas internas: `vercel.json` reescribe `/api/deep-work-*`, `/api/manuscript-audit*`, `/api/refinement-*`, `/api/refinery-worker` y `/api/research-jobs|worker` hacia los routers `api/deep-work.ts`, `api/refinery.ts` y `api/research-intelligence.ts`.

## Puesta en marcha local

Requisitos: **Node 22** y un proyecto de Supabase.

```bash
npm install
cp .env.example .env.local   # y rellena los valores
npm run dev                  # http://localhost:3000
```

En local (`npm run dev`) el navegador llama a Gemini directamente con `VITE_GEMINI_API_KEY`. **Esa variable solo debe existir en `.env.local`**: todo lo que empieza por `VITE_` acaba en el JavaScript que descarga el navegador. En producción las llamadas pasan por `/api/composer`, que usa `GEMINI_API_KEY` en el servidor.

## Variables de entorno

### Navegador (prefijo `VITE_`, públicas)
| Variable | Uso |
|---|---|
| `VITE_SUPABASE_URL` | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública *anon* de Supabase |
| `VITE_GEMINI_MODEL`, `VITE_GEMINI_FALLBACK_MODELS` | Modelos por defecto y de reserva (opcional) |
| `VITE_GEMINI_API_KEY` | **Solo `.env.local`**, nunca en Vercel |

### Servidor (Vercel → Settings → Environment Variables, Production y Preview)
| Variable | Obligatoria | Uso |
|---|---|---|
| `SUPABASE_URL` | Sí* | URL de Supabase (*o `VITE_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | Sí* | Validar sesiones (*o `VITE_SUPABASE_ANON_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Acceso de servidor: colas, cuotas, `has_access`. **Nunca con `VITE_`** |
| `GEMINI_API_KEY` | Sí | Clave de Gemini del servidor |
| `OS4_WORKER_SECRET` | Sí | Secreto de los workers (también lo aceptan refinery y deep-work) |
| `RESEARCH_WORKER_SECRET`, `DEEP_WORKER_SECRET`, `REFINERY_WORKER_SECRET` | No | Secretos específicos por worker |
| `RESEARCH_SEARCH_ENDPOINT`, `RESEARCH_API_KEY` | No | Proveedor de búsqueda web para `/api/research` |
| `OS4_PUBLIC_BASE_URL` | No | URL pública usada por el worker OS4 (por defecto `VERCEL_URL`) |
| `GEMINI_MODEL`, `*_MODEL`, `OS4_MODEL_PRICING_JSON` | No | Ajuste de modelos y precios |
| `DEEP_CREDIT_GUARD` | No | `0` desactiva el guardián de créditos de deep-work |

Genera los secretos con `openssl rand -hex 32` o, en PowerShell, `[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`.

### Seguridad y límites (opcionales)
| Variable | Por defecto | Uso |
|---|---|---|
| `RATE_LIMIT_COMPOSER_HOURLY` / `_DAILY` | 60 / 300 | Generación de texto por usuario |
| `RATE_LIMIT_OS4_HOURLY` / `_DAILY` | 60 / 300 | Agentes OS4 |
| `RATE_LIMIT_RESEARCH_HOURLY` / `_DAILY` | 20 / 100 | Investigación web |
| `RATE_LIMIT_AUDIT_HOURLY` / `_DAILY` | 10 / 40 | Auditoría de manuscrito |
| `RATE_LIMIT_JOBS_HOURLY` / `_DAILY` | 30 / 150 | Encolar trabajos largos |
| `RATE_LIMIT_FAIL_CLOSED` | `false` | `true`: rechaza (503) si la cuota no se puede comprobar |
| `ACCESS_GATE_DISABLED` | `false` | `true`: no exige `has_access` (solo emergencias) |
| `ACCESS_GATE_FAIL_CLOSED` | `false` | `true`: rechaza (503) si `has_access` no se puede comprobar |

Un valor `0` en un límite desactiva esa ventana.

## Base de datos (Supabase)

Ejecuta en **Supabase → SQL Editor**, en orden, los archivos de `supabase/migrations/` (son idempotentes):

| Migración | Qué hace |
|---|---|
| `20260525_generation_jobs.sql` | Cola de generación |
| `20261112_api_rate_limits.sql` | Tabla y función atómica del límite de uso |
| `20261113_protect_profile_access.sql` | Impide que un usuario se ponga `has_access = true` |
| `20261114_api_usage_daily_view.sql` | Vista `api_usage_daily` (consumo por usuario, 90 días) |

Los esquemas de los módulos (OS4, refinery, deep-work, research) están en `sql/`, junto a sus scripts `*-verify.sql`.

**Auditoría de seguridad:** `supabase/rls-audit.sql` (solo lectura) lista el estado RLS y las políticas de todas las tablas y marca las peligrosas.

### Aprobar a un usuario
Los usuarios nuevos entran con `has_access = false`. Para aprobarlos, desde el SQL Editor (o el Table Editor):

```sql
update profiles set has_access = true where email = 'persona@ejemplo.com';
```

### Consumo por usuario
```sql
select * from api_usage_daily where day = current_date order by calls desc;
select email, sum(calls) from api_usage_daily
where day > current_date - 30 group by email order by 2 desc;
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor local en el puerto 3000 |
| `npm run build` | Build de producción del frontend |
| `npm run typecheck` | Comprobación de tipos |
| `npm run test:unit` | Pruebas unitarias (Vitest): títulos, fusión de estado, respuestas de la IA, seguridad |
| `npm run test:api-load` | Carga cada función de `api/` como lo hace Vercel (detecta imports rotos) |
| `npm run genelibros:final:verify` | Verificación completa que ejecuta GitHub en cada PR |

Todas las pruebas son **0 LLM**: no llaman a Gemini ni a la red.

## Calidad y despliegue

- **Pull requests → `main`**. La rama está protegida: no se puede fusionar si falla el *Final release gate* (`.github/workflows/genelibros-final-release.yml`), que ejecuta los parches deterministas de producción, la prueba de carga de funciones, las pruebas unitarias, el typecheck y el build.
- **Vercel** despliega automáticamente cada fusión en `main`, y cada PR en una vista previa.
- **Monitor de producción** (`.github/workflows/production-monitor.yml`): cada 15 minutos llama sin sesión a todas las funciones. Una función sana responde 4xx; si alguna responde 5xx o no responde, abre una issue **"🚨 Producción: funciones caídas"** (GitHub avisa por email) y la cierra sola cuando se recupera. Se puede lanzar a mano desde *Actions → Production monitor → Run workflow*.

### Reglas para no romper producción
- El proyecto es `"type": "module"`: **los imports relativos del servidor deben terminar en `.js`** (`import x from "./archivo.js"`). La prueba de carga lo comprueba.
- Las funciones que gastan dinero deben pasar por `guardPaidRequest()` (`src/server/request-guard.ts`).
- Las descargas de URLs enviadas por usuarios deben usar `safeFetchText()` (`src/server/safe-fetch.ts`).
- Ninguna clave secreta lleva el prefijo `VITE_`.

## Estructura

```text
api/                 Funciones serverless (puntos de entrada de Vercel)
src/server/          Lógica de servidor: auth, guardia, cuotas, SSRF, runtimes, handlers
src/lib/             Lógica compartida del frontend (editor, clientes de API, Supabase)
src/data/repo.ts     Acceso a datos del navegador (proyectos, secciones, documentos)
components/          Componentes React
App.tsx              Aplicación principal
supabase/            Migraciones y auditoría RLS
sql/                 Esquemas de módulos y scripts de verificación
scripts/             Parches deterministas, verificaciones y herramientas
tests/unit/          Pruebas Vitest
worker/              Worker de generación para ejecutar fuera de Vercel
```
