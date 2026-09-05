param([string]$ProjectRoot = (Get-Location).Path)
$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot
$EnvFile = Join-Path $ProjectRoot ".env.local"
if (-not (Test-Path $EnvFile)) { New-Item -ItemType File -Path $EnvFile -Force | Out-Null }
$content = Get-Content $EnvFile -Raw
if ($content -match '(?m)^DEEP_WORKER_SECRET=(.+)$' -and $Matches[1].Trim()) {
  Write-Host "[OK] DEEP_WORKER_SECRET ya configurado." -ForegroundColor Green
  exit 0
}
$Bytes = New-Object byte[] 48
$Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
$Secret = [Convert]::ToBase64String($Bytes)
if ($content.Length -gt 0 -and -not $content.EndsWith("`n")) { Add-Content -LiteralPath $EnvFile -Value "" }
Add-Content -LiteralPath $EnvFile -Value "DEEP_WORKER_SECRET=$Secret"
Write-Host "[OK] DEEP_WORKER_SECRET local generada y guardada en .env.local." -ForegroundColor Green
Write-Host "[INFO] No compartas ni imprimas su valor." -ForegroundColor Yellow
