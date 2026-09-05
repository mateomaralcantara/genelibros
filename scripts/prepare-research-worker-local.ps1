param([string]$ProjectRoot = "C:\Users\martin\Desktop\VSC\BestS\geneBestSeller")
$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot
$EnvFile = Join-Path $ProjectRoot ".env.local"
if (-not (Test-Path $EnvFile)) { New-Item -ItemType File -Path $EnvFile -Force | Out-Null }
$Content = Get-Content $EnvFile -Raw
if ($Content -match '(?m)^RESEARCH_WORKER_SECRET=(.+)$') {
    $Existing = $Matches[1].Trim().Trim('"').Trim("'")
    if ($Existing) { Write-Host "[OK] RESEARCH_WORKER_SECRET ya configurado." -ForegroundColor Green; exit 0 }
}
$Bytes = New-Object byte[] 48
$Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $Rng.GetBytes($Bytes) } finally { $Rng.Dispose() }
$Secret = [Convert]::ToBase64String($Bytes)
if ($Content -match '(?m)^RESEARCH_WORKER_SECRET=.*$') {
    $Content = [Regex]::Replace($Content,'(?m)^RESEARCH_WORKER_SECRET=.*$',"RESEARCH_WORKER_SECRET=$Secret")
} else {
    if ($Content -and -not $Content.EndsWith("`n")) { $Content += "`r`n" }
    $Content += "RESEARCH_WORKER_SECRET=$Secret`r`n"
}
[IO.File]::WriteAllText($EnvFile,$Content,[Text.UTF8Encoding]::new($false))
Write-Host "[OK] RESEARCH_WORKER_SECRET local generada." -ForegroundColor Green
Write-Host "[OK] El valor NO se imprime." -ForegroundColor Green
