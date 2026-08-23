param(
  [string]$Root = ".",
  [string]$Out = ".scan"
)

New-Item -ItemType Directory -Force $Out | Out-Null

$files = Get-ChildItem -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx $Root |
  Where-Object { $_.FullName -notmatch "\\node_modules\\|\\dist\\|\\build\\|\\\.next\\|\\\.scan\\" }

function DumpMatches($name, $pattern, $contextBefore=3, $contextAfter=3) {
  $path = Join-Path $Out $name
  Select-String -Path $files.FullName -Pattern $pattern -AllMatches -CaseSensitive:$false -Context $contextBefore,$contextAfter |
    ForEach-Object {
      $ctxPre  = ($_.Context.PreContext  -join "`n")
      $ctxPost = ($_.Context.PostContext -join "`n")
      @(
        "FILE: $($_.Path)"
        "LINE: $($_.LineNumber)"
        "MATCH: $($_.Line.Trim())"
        "---- PRE ----"
        $ctxPre
        "---- POST ----"
        $ctxPost
        "==============================="
        ""
      ) -join "`n"
    } | Set-Content -Encoding UTF8 $path
}

# 1) ¿Quién está seteando activeProjectId?
DumpMatches "01_activeProjectId_setters.txt" "setActiveProjectId\(" 5 5

# 2) ¿Dónde está el botón “Crear nuevo” y qué hace?
DumpMatches "02_onCreateNew.txt" "onCreateNew|Crear Nuevo Libro|create new" 6 6

# 3) Auto-selección sospechosa (el clásico “si activeProjectId es null, elige el primero”)
DumpMatches "03_autoselect_sospechoso.txt" "if\s*\(\s*!activeProjectId.*setActiveProjectId|!activeProjectId.*list\?\.\[0\]\?\.id" 8 8

# 4) Render condicional: ¿cuándo muestra Dashboard vs Chat?
DumpMatches "04_render_switch.txt" "activeProject\s*\?|GenerationDashboard|ChatInterface|viewMode" 6 6

# 5) Detectar <button> dentro de <button> (regex simple pero efectiva)
$nestedBtnReport = Join-Path $Out "05_nested_buttons.txt"
"" | Set-Content -Encoding UTF8 $nestedBtnReport

$nestedRegex = [regex]::new("<button\b[\s\S]*?<button\b", "IgnoreCase")
foreach ($f in $files) {
  $raw = Get-Content $f.FullName -Raw
  if ($nestedRegex.IsMatch($raw)) {
    Add-Content $nestedBtnReport "NESTED <button> FOUND: $($f.FullName)"
  }
}

Write-Host ""
Write-Host "Listo. Revisa los reportes en: $Out"
Write-Host "Claves:"
Write-Host " - 03_autoselect_sospechoso.txt (por qué no limpia el dashboard)"
Write-Host " - 05_nested_buttons.txt (qué archivos tienen button dentro de button)"
