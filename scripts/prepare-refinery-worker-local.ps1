$ErrorActionPreference = "Stop"

$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project

$EnvFile = Join-Path $Project ".env.local"

if (-not (Test-Path $EnvFile)) {
    New-Item -ItemType File -Path $EnvFile -Force | Out-Null
}

$Lines = @(Get-Content $EnvFile -ErrorAction SilentlyContinue)

function Get-ExistingValue {
    param([string]$Name)

    foreach ($Line in $Lines) {
        if ($Line -match "^\s*$([regex]::Escape($Name))\s*=(.*)$") {
            $Value = $Matches[1].Trim()

            if (
                ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
                ($Value.StartsWith("'") -and $Value.EndsWith("'"))
            ) {
                $Value = $Value.Substring(1, $Value.Length - 2)
            }

            if ($Value) {
                return $Value
            }
        }
    }

    return $null
}

$Secret = Get-ExistingValue "REFINERY_WORKER_SECRET"

if (-not $Secret) {
    $Secret = Get-ExistingValue "OS4_WORKER_SECRET"
}

if (-not $Secret) {
    $Bytes = [byte[]]::new(48)
    $Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $Rng.GetBytes($Bytes)
    }
    finally {
        $Rng.Dispose()
    }
    $Secret = [Convert]::ToBase64String($Bytes)

    Add-Content `
        -LiteralPath $EnvFile `
        -Value "REFINERY_WORKER_SECRET=$Secret" `
        -Encoding utf8

    Write-Host "[OK] REFINERY_WORKER_SECRET local generada." -ForegroundColor Green
}
else {
    Write-Host "[OK] Worker secret ya configurado." -ForegroundColor Green
}

git check-ignore --no-index ".env.local" *> $null

if ($LASTEXITCODE -ne 0) {
    throw ".env.local NO está protegido por .gitignore."
}

Write-Host "[OK] .env.local protegido por Git." -ForegroundColor Green
Write-Host "No se mostró ni copió el secreto." -ForegroundColor DarkGray
