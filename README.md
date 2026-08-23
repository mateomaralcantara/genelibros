# BestSeller App.tsx — fix títulos reales sin prompt leakage

Este parche corrige el problema donde el sistema dejó de mostrar los títulos reales y mostraba solo títulos genéricos.

## Qué hace

- Extrae títulos reales desde líneas como: `CAPÍTULO 3: “Colombia Alcántara: la entrevista como escenario de autoridad”`.
- Funciona aunque el prompt venga con saltos de línea o en un solo bloque largo.
- Evita meter el prompt largo en `chapter_title`.
- Limpia títulos contaminados con `Actúa como`, `Objetivo general`, `Formato final`, etc.
- Usa el máximo capítulo detectado en el esquema si no hay un número explícito mejor.
- Mantiene el blindaje de `projectsRef.current`.

## Instalación

```powershell
cd "C:\Users\martin\Desktop\VSC\BestS\geneBestSeller"

Copy-Item -Force ".\App.tsx" ".\App.tsx.bak_before_outline_titles_fix"
Copy-Item -Force "RUTA_DONDE_DESCOMPRIMISTE\App.tsx" ".\App.tsx"

npm run dev
```

## Verificación rápida

```powershell
node ".\scripts\audit-app-outline-titles.mjs"
```

## Nota

Este parche no limpia libros viejos ya guardados en Supabase. Para ver los títulos corregidos, crea un libro nuevo o regenera/actualiza el outline del proyecto contaminado.
