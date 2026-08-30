param(
    [string]$Message = "feat: Genelibros 11B-11D.5.1"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Run([string]$Name, [scriptblock]$Cmd) {
    Write-Host ""
    Write-Host "=== $Name ===" -ForegroundColor Cyan

    & $Cmd

    if ($LASTEXITCODE -ne 0) {
        throw "FALLO: $Name"
    }

    Write-Host "OK: $Name" -ForegroundColor Green
}

# ------------------------------------------------------------
# NODE 22
# ------------------------------------------------------------

$Node22 = Join-Path $Root ".tools\node22"

if (Test-Path $Node22) {
    $env:Path = "$Node22;$env:Path"
}

if ((node --version) -ne "v22.23.2") {
    throw "Se requiere Node v22.23.2"
}

Write-Host "Node: $(node --version)" -ForegroundColor Green


# ------------------------------------------------------------
# SEGURIDAD
# ------------------------------------------------------------

$TrackedSensitive =
    git ls-files |
    Where-Object {
        $_ -match '\.env\.local' -or
        $_ -match '\.hardening-backups' -or
        $_ -match '^\.tools/'
    }

if ($TrackedSensitive) {
    throw "Hay archivos sensibles rastreados por Git."
}

$Ignored = git status --ignored --short

if (-not ($Ignored -match '\.env\.local')) {
    throw ".env.local no está protegido."
}

if (-not ($Ignored -match '\.hardening-backups')) {
    throw ".hardening-backups no está protegido."
}

Write-Host "Seguridad Git: OK" -ForegroundColor Green


# ------------------------------------------------------------
# VALIDACIONES
# ------------------------------------------------------------

$Package =
    Get-Content ".\package.json" -Raw |
    ConvertFrom-Json

$Scripts =
    @($Package.scripts.PSObject.Properties.Name)

$Tests = @(
    "refinery:11b:test",
    "refinery:11b2:test",
    "refinery:11b3:test",
    "deep-work:11c:test",
    "research:11d:test"
)

foreach ($Test in $Tests) {
    if ($Scripts -contains $Test) {
        Run "npm run $Test" {
            npm run $Test
        }
    }
}

Run "TYPECHECK" {
    npm run typecheck
}

Run "BUILD" {
    npm run build
}

Run "GIT DIFF CHECK" {
    git diff --check
}


# ------------------------------------------------------------
# BRANCH
# ------------------------------------------------------------

$Current =
    (git branch --show-current).Trim()

if ($Current -ne "main") {
    throw "Debes iniciar desde main. Actual: $Current"
}

$Stamp =
    Get-Date -Format "yyyyMMdd-HHmmss"

$Branch =
    "release/genelibros-$Stamp"

Run "CREAR BRANCH $Branch" {
    git switch -c $Branch
}


# ------------------------------------------------------------
# STAGING CONTROLADO
# NO git add .
# ------------------------------------------------------------

$Paths = @(
    ".gitignore",
    "package.json",
    "GENELIBROS-RELEASE.ps1",
    "RUN-VERCEL-NODE22.ps1",

    "api/deep-work-apply.ts",
    "api/deep-work-jobs.ts",
    "api/deep-work-worker.ts",
    "api/manuscript-audit-jobs.ts",
    "api/manuscript-audit.ts",
    "api/refinement-apply.ts",
    "api/refinement-jobs.ts",
    "api/refinement-worker.ts",
    "api/refinery-worker.ts",
    "api/research-jobs.ts",
    "api/research-worker.ts",

    "src/lib/brain/agent-registry.ts",

    "src/lib/refinery",
    "src/lib/refinery-execution",
    "src/lib/deep-work",
    "src/lib/research-intelligence",

    "src/server/refinery-runtime.ts",
    "src/server/refinery-execution-runtime.ts",
    "src/server/deep-work-runtime.ts",
    "src/server/research-intelligence-runtime.ts",

    "sql/refinery-11b-schema.sql",
    "sql/refinery-11b-verify.sql",
    "sql/refinery-11b2-durable-worker.sql",
    "sql/refinery-11b2-verify.sql",
    "sql/refinery-11b3-execution-engine.sql",
    "sql/refinery-11b3-verify.sql",
    "sql/deep-work-11c-engine.sql",
    "sql/deep-work-11c-verify.sql",
    "sql/research-11d-engine.sql",
    "sql/research-11d-verify.sql",

    "scripts/refinery-11b-tests.mjs",
    "scripts/refinery-11b2-tests.mjs",
    "scripts/refinery-11b3-tests.mjs",
    "scripts/deep-work-11c-tests.mjs",
    "scripts/research-11d-tests.mjs",

    "scripts/run-refinery-worker-local.mjs",
    "scripts/run-refinement-worker-local.mjs",
    "scripts/run-deep-work-worker-local.mjs",
    "scripts/run-research-worker-local.mjs",

    "scripts/prepare-refinery-worker-local.ps1",
    "scripts/prepare-deep-worker-local.ps1",
    "scripts/prepare-research-worker-local.ps1"
)

foreach ($Path in $Paths) {
    if (Test-Path $Path) {
        git add -- $Path
    }
}


# ------------------------------------------------------------
# VERIFICACIÓN FINAL DEL STAGING
# ------------------------------------------------------------

$Staged =
    @(git diff --cached --name-only)

if ($Staged.Count -eq 0) {
    throw "No hay archivos para publicar."
}

$Forbidden =
    $Staged |
    Where-Object {
        $_ -match '\.env' -or
        $_ -match '\.hardening-backups' -or
        $_ -match '^\.tools/' -or
        $_ -match 'node_modules'
    }

if ($Forbidden) {
    git reset
    throw "Archivo prohibido detectado: $($Forbidden -join ', ')"
}

Write-Host ""
Write-Host "ARCHIVOS DEL RELEASE:" -ForegroundColor Yellow

$Staged |
    ForEach-Object {
        Write-Host " + $_"
    }

Run "STAGED DIFF CHECK" {
    git diff --cached --check
}


# ------------------------------------------------------------
# COMMIT
# ------------------------------------------------------------

Run "COMMIT" {
    git commit -m $Message
}

$Commit =
    (git rev-parse HEAD).Trim()


# ------------------------------------------------------------
# PUSH
# ------------------------------------------------------------

Run "PUSH GITHUB" {
    git push -u origin $Branch
}


# ------------------------------------------------------------
# FIN
# ------------------------------------------------------------

Write-Host ""
Write-Host "==============================================" -ForegroundColor Green
Write-Host " GENELIBROS RELEASE COMPLETADO" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Green

Write-Host ""
Write-Host "Branch : $Branch"
Write-Host "Commit : $Commit"
Write-Host ""
Write-Host "GitHub: OK" -ForegroundColor Green
Write-Host "Vercel Production: NO TOCADA" -ForegroundColor Yellow
Write-Host ""
Write-Host "Si Vercel está conectado a GitHub,"
Write-Host "la rama podrá generar un Preview Deployment."
Write-Host ""
