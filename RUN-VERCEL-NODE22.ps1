$ErrorActionPreference = "Stop"

$Root = "C:\Users\martin\Desktop\VSC\BestS\geneBestSeller"
$Node = Join-Path $Root ".tools\node22"

if (-not (Test-Path (Join-Path $Node "node.exe"))) {
    throw "Node 22 portable no está instalado."
}

$env:Path = "$Node;$env:Path"

Set-Location $Root

Write-Host ""
Write-Host "=== GENELIBROS NODE 22 ===" -ForegroundColor Cyan
Write-Host "Node: $(node --version)"
Write-Host ""

Set-ExecutionPolicy `
    -Scope Process `
    -ExecutionPolicy Bypass `
    -Force

& ".\RUN-VERCEL-11B.ps1"
