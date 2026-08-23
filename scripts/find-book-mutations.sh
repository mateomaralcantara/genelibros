#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
OUTDIR="${2:-.scan}"
mkdir -p "$OUTDIR"

# Excluye carpetas típicas de build
RG_BASE=(rg -n --no-heading --hidden --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/.next/**' --glob '!**/build/**')

echo "==> Escaneando repo en: $ROOT"
echo "==> Reportes en: $OUTDIR"
echo

# 1) Mutaciones del estado (donde cambian libros/capítulos en memoria)
"${RG_BASE[@]}" -S \
  "setProjects\(|updateProjectById\(|processResponse\(|mergeProjectState\(|normalizeProjectState\(|buildMasterFromState\(|setSectionProgress\(|handleGenerateSection\(|handleGenerateRemaining\(" \
  "$ROOT" | tee "$OUTDIR/01_state_mutations.txt" >/dev/null

# 2) Edición manual / guardado (inputs, textarea, onChange, onSave, etc.)
"${RG_BASE[@]}" -S \
  "onChange|textarea|contentEditable|setState\(|setMessages\(|save|guardar|edit|editar|REVISE_SECTION|REBUILD_MASTER" \
  "$ROOT" | tee "$OUTDIR/02_editing_ui.txt" >/dev/null

# 3) Persistencia local (localStorage) — típico si “no es Supabase”
"${RG_BASE[@]}" -S \
  "localStorage\.setItem|localStorage\.getItem|localStorage\.removeItem|STORAGE_KEY|serializeProjectForStorage|loadProjectsFromStorage" \
  "$ROOT" | tee "$OUTDIR/03_localstorage.txt" >/dev/null

# 4) Supabase: dónde se configura y dónde hace CRUD real
"${RG_BASE[@]}" -S \
  "createClient\(|supabaseUrl|SUPABASE_URL|anon|ANON_KEY|SUPABASE_ANON_KEY|from\(|insert\(|update\(|upsert\(|delete\(|rpc\(|storage\.from\(|auth\." \
  "$ROOT" | tee "$OUTDIR/04_supabase_crud.txt" >/dev/null

# 5) Borrado de libros/capítulos (lo que realmente elimina)
"${RG_BASE[@]}" -S \
  "removeItem\(|clear\(|delete\(|filter\(\(p\)\s*=>\s*p\.id\s*!==|splice\(|setProjects\(\(prev\)\s*=>\s*prev\.filter" \
  "$ROOT" | tee "$OUTDIR/05_deletes.txt" >/dev/null

# 6) Señales específicas de capítulos/secciones
"${RG_BASE[@]}" -S \
  "chapters|chapter_number|chapterNum|proposal|introduction|generation_progress|GENERATE_CHAPTER|GENERATE_PROPOSAL|GENERATE_INTRODUCTION" \
  "$ROOT" | tee "$OUTDIR/06_chapters_sections.txt" >/dev/null

echo
echo "==> RESUMEN rápido"
echo "-- Archivos que parecen tocar Supabase:"
"${RG_BASE[@]}" -l -S "createClient\(|from\(|insert\(|update\(|upsert\(|delete\(" "$ROOT" || true
echo
echo "-- Archivos que mutan proyectos/capítulos:"
"${RG_BASE[@]}" -l -S "setProjects\(|updateProjectById\(|mergeProjectState\(|processResponse\(" "$ROOT" || true
echo
echo "Listo. Abre los reportes en $OUTDIR/*.txt"
