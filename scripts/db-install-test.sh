#!/usr/bin/env bash
# Instala el esquema completo en una base Postgres VACÍA siguiendo
# supabase/install-order.txt y ejecuta la prueba de humo.
# Uso: DATABASE_URL=postgres://... scripts/db-install-test.sh
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL (base de pruebas vacía, nunca producción)}"
run() { echo "→ $1"; psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$1"; }

run supabase/test/00_supabase_stub.sql
grep -vE '^\s*(#|$)' supabase/install-order.txt | while read -r file; do run "$file"; done
run supabase/test/99_smoke.sql

# La reconciliación debe ser idempotente.
run supabase/migrations/20261115_reconcile_shared_tables.sql
echo "✅ Esquema instalado y prueba de humo OK"
