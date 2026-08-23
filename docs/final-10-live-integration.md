# BestSeller AI — Integración Final 10/10

## Instalado

- api/research.ts
- api/export.ts
- /api/research con fetch, search provider opcional y extractHtml.
- COLLECT_SOURCES.
- EXTRACT_FACTS.
- VERIFY_FACTS.
- research_sources.
- research_facts.
- subscription_plans.
- usage_events.
- generation_jobs.
- pipeline_events.
- pricing.
- billing.
- stripe / checkout / payment.
- credits.
- usage_limit / plan_limits.
- quality gate conectado.
- FACT_CHECK_CHAPTER.
- export PDF/DOCX/EPUB.
- pipeline visible.

## Variables opcionales

RESEARCH_SEARCH_ENDPOINT=
RESEARCH_API_KEY=

Sin esas variables, /api/research funciona con URLs manuales.

## Comandos

npm test
npm run build
node scripts/market-perfection-score.mjs --full

## SQL

Ejecutar en Supabase:

sql/elite-research-schema.sql
