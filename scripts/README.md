# scripts/

Scripts de Node (y algunos de PowerShell) para el build, las verificaciones y la operación de GeneLibros. **Ninguno llama a la IA salvo los que lo dicen explícitamente** (`run-*`, `extend-chapter`).

## Lo que se ejecuta solo

| Script | Cuándo |
|---|---|
| `prepare-production-runtime.mjs` | Build de Vercel (`vercel.json`). Aplica los parches deterministas `patch-*` listados dentro |
| `genelibros-final-release-gate.mjs` | Cada push y PR (`npm run genelibros:final:verify`). Ejecuta las pruebas `*-tests.mjs`, `api-runtime-load-test.mjs`, `npm run test:unit`, el typecheck y el build |
| `api-runtime-load-test.mjs` | Dentro del gate (`npm run test:api-load`): carga cada función de `api/` como Vercel |
| `production-smoke-monitor.mjs` | Cada 15 min desde `.github/workflows/production-monitor.yml` |

## Grupos

| Prefijo | Qué son |
|---|---|
| `patch-*.mjs` | Parches deterministas e idempotentes que el build aplica sobre `src/` (deep-work, research, pdf-parse) |
| `*-tests.mjs` | Verificaciones de contrato (0 LLM) de cada módulo; varias forman parte del gate |
| `deep-production-*`, `run-deep-*` | Producción de capítulos/libros con Deep Work (ejecución local explícita) |
| `research-*` | Preflight, presupuesto, reanudación y curación de investigaciones |
| `run-*-local.mjs`, `prepare-*-local.ps1` | Levantar workers y `vercel dev` en local con `.env.local` |
| `inspect-*`, `recover-*`, `export-*` | Diagnóstico y recuperación de trabajos concretos |
| `*.template.txt` | Plantillas de prompts usadas por los parches de deep-work |

## Herramientas de administración

Se ejecutan a mano desde la raíz del proyecto con `.env.local`:

| Script | Uso |
|---|---|
| `list-projects.mjs` | Lista proyectos de Supabase |
| `supervisar-usuarios.mjs` | Informe de actividad de usuarios |
| `set-chapter-targets.mjs <projectId> <palabras>` | Fija el objetivo de palabras de todos los capítulos |
| `extend-chapter.mjs` | Alarga un capítulo hasta su objetivo (**llama a Gemini**) |
| `inspect-research-dossier.mjs`, `inspect-research-evidence.mjs`, `inspect-research-document-url.mjs` | Inspeccionar investigaciones |
| `reassess-research-dossier-v2.mjs`, `research-resume-official-docs.mjs` | Reevaluar o completar investigaciones |
| `healthcheck.mjs` | Informe de arquitectura del código en `.health/` |

## archive/

Scripts de **un solo uso que ya cumplieron su función**: parches aplicados (`fix-*`, `patch-*-v53…v57`, `patch-os4-*`), auditorías y diagnósticos puntuales. Nada los referencia y no se ejecutan; se conservan como referencia histórica. Si uno vuelve a hacer falta, muévelo de nuevo a `scripts/`.
