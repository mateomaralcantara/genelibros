param([string]$Root = ".")

$ErrorActionPreference = "Stop"

# ---------- helpers ----------
function Ensure-Dir([string]$p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

function Is-IgnoredPath([string]$path) {
  $p = $path.ToLower()
  return (
    $p -match "\\node_modules\\" -or
    $p -match "\\dist\\" -or
    $p -match "\\build\\" -or
    $p -match "\\.git\\" -or
    $p -match "\\.next\\" -or
    $p -match "\\.vercel\\" -or
    $p -match "\\coverage\\" -or
    $p -match "\\.health\\"
  )
}

# ---------- setup ----------
$RootPath = (Resolve-Path $Root).Path
$OutDir = Join-Path $RootPath ".trace"
Ensure-Dir $OutDir

$reportPath  = Join-Path $OutDir "book_format_report.md"
$summaryPath = Join-Path $OutDir "book_format_summary.txt"

$exts = @(".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".sql",".md")

$files = Get-ChildItem -Path $RootPath -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object {
    -not (Is-IgnoredPath $_.FullName) -and
    ($exts -contains $_.Extension.ToLower())
  }

if (-not $files -or $files.Count -eq 0) {
  throw "No encontré archivos (ts/tsx/js/sql/md). ¿Estás en la carpeta correcta?"
}

# ---------- categories (texto plano, no regex) ----------
$categories = @(
  @{
    Name = "PROMPTS / SYSTEM INSTRUCTION"
    Patterns = @(
      "SYSTEM_PROMPT",
      "DEV_SYSTEM_PROMPT",
      "systemInstruction",
      "generateContent",
      "@google/genai",
      "/api/composer",
      "api/composer.ts"
    )
  },
  @{
    Name = "MASTER BUILDER / DOCUMENTO MAESTRO"
    Patterns = @(
      "buildMasterFromState",
      "build_master_text",
      "master_documents",
      "master_document",
      "insertMasterSnapshot",
      "## Propuesta editorial",
      "## Introducción"
    )
  },
  @{
    Name = "OUTLINE / ESTRUCTURA"
    Patterns = @(
      "outline_12",
      "chapter_number",
      "chapterNumber",
      "target_words",
      "chapter_title",
      "objective",
      "key_points",
      "subheads_h2"
    )
  },
  @{
    Name = "SUPABASE / CONTENIDO REAL"
    Patterns = @(
      ".from('projects')",
      '.from("projects")',
      ".from('sections')",
      '.from("sections")',
      ".from('master_documents')",
      '.from("master_documents")',
      ".from('section_versions')",
      '.from("section_versions")',
      ".rpc('build_master_text'",
      '.rpc("build_master_text"',
      "build_master_text"
    )
  },
  @{
    Name = "UI RENDER"
    Patterns = @(
      "BookViewer",
      "GenerationDashboard",
      "TableOfContents",
      "master_document.text"
    )
  },
  @{
    Name = "MODO DEV vs PROD"
    Patterns = @(
      "import.meta.env.DEV",
      "VITE_GEMINI_API_KEY",
      "GEMINI_API_KEY",
      "fetch('/api/composer'",
      'fetch("/api/composer"',
      "GoogleGenAI"
    )
  }
)

$now = (Get-Date).ToString("s")
$NL = [Environment]::NewLine

# ---------- build report ----------
$md = @()
$md += "# Book Format Trace Report"
$md += ""
$md += ("Generated: " + $now)
$md += ("Root: " + $RootPath)
$md += ("Files scanned: " + $files.Count)
$md += ""

$sum = @()
$sum += ("Book Format Trace Summary (" + $now + ")")
$sum += ("Root: " + $RootPath)
$sum += ("Files scanned: " + $files.Count)
$sum += ""

$MAX_HITS_PER_CATEGORY = 120

foreach ($cat in $categories) {
  $md += ("## " + $cat.Name)
  $md += ""

  $hitCount = 0

  foreach ($pat in $cat.Patterns) {
    if ($hitCount -ge $MAX_HITS_PER_CATEGORY) { break }

    $hits = Select-String -Path $files.FullName -Pattern $pat -SimpleMatch -AllMatches -Context 2,2 -ErrorAction SilentlyContinue

    foreach ($h in $hits) {
      $hitCount++
      if ($hitCount -gt $MAX_HITS_PER_CATEGORY) { break }

      $md += ("### " + $h.Path)
      $md += ("- L" + $h.LineNumber + " | pattern: " + $pat)
      $md += '```'
      if ($h.Context.PreContext)  { $md += ($h.Context.PreContext -join $NL) }
      $md += $h.Line.TrimEnd()
      if ($h.Context.PostContext) { $md += ($h.Context.PostContext -join $NL) }
      $md += '```'
      $md += ""

      $sum += ($h.Path + ":" + $h.LineNumber + ": " + $h.Line.Trim())
    }
  }

  if ($hitCount -eq 0) {
    $md += "_Sin hallazgos._"
    $md += ""
  }

  $sum += ""
}

# ---------- write files ----------
$md  | Set-Content -Encoding UTF8 -Path $reportPath
$sum | Set-Content -Encoding UTF8 -Path $summaryPath

Write-Host "✅ OK. Reportes creados:"
Write-Host (" - " + $reportPath)
Write-Host (" - " + $summaryPath)