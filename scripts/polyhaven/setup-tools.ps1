<#
.SYNOPSIS
  Installs the two pinned conversion tools (KTX-Software / toktx, OpenImageIO / oiiotool)
  that `npx tsx scripts/polyhaven/cli.ts ingest` needs, into the exact locations
  config/polyhaven.json already points at. Windows only - the pinned versions in
  scripts/polyhaven/TOOL_VERSIONS.md are Windows builds.

.USAGE
  Open PowerShell IN THE REPO ROOT (the PolyForm folder) and run:
    powershell -ExecutionPolicy Bypass -File scripts\polyhaven\setup-tools.ps1

  Re-run any time - it skips work that's already done.
#>

$ErrorActionPreference = 'Stop'
$repoRoot   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$toolsDir   = Join-Path $repoRoot '.polyhaven\tools'
$ktxDir     = Join-Path $toolsDir 'ktx-4.4.2'
$oiioDir    = Join-Path $toolsDir 'oiio-3.1.17.0'
$configPath = Join-Path $repoRoot 'config\polyhaven.json'

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
Write-Host "== PolyForm / Poly Haven tool setup ==" -ForegroundColor Cyan

# --- 1. KTX-Software (toktx) -------------------------------------------------
$toktxExe = Join-Path $ktxDir 'bin\toktx.exe'
if (Test-Path $toktxExe) {
    Write-Host "[toktx] already installed at $toktxExe" -ForegroundColor Green
} else {
    Write-Host "[toktx] downloading KTX-Software 4.4.2..."
    $ktxInstaller = Join-Path $env:TEMP 'KTX-Software-4.4.2-Windows-x64.exe'
    $ktxUrl = 'https://github.com/KhronosGroup/KTX-Software/releases/download/v4.4.2/KTX-Software-4.4.2-Windows-x64.exe'
    Invoke-WebRequest -Uri $ktxUrl -OutFile $ktxInstaller

    $expectedSha = '1f323b0fec19794f5e6c0425a61d4b1da396872a10be862d105f4f4b2d2957fe'
    $actualSha = (Get-FileHash $ktxInstaller -Algorithm SHA256).Hash.ToLower()
    if ($actualSha -ne $expectedSha) {
        throw "toktx installer hash mismatch (expected $expectedSha, got $actualSha). The release asset may have changed - check https://github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2 and update this script."
    }

    Write-Host "[toktx] hash verified, installing silently into $ktxDir..."
    New-Item -ItemType Directory -Force -Path $ktxDir | Out-Null
    # NSIS silent install; /D must be the last argument and unquoted.
    Start-Process -FilePath $ktxInstaller -ArgumentList "/S /D=$ktxDir" -Wait
    if (-not (Test-Path $toktxExe)) { throw "toktx.exe not found at $toktxExe after install - check $ktxDir for the actual layout." }
    Write-Host "[toktx] installed." -ForegroundColor Green
}
& $toktxExe --version

# --- 2. OpenImageIO (oiiotool) -----------------------------------------------
$oiioVenvPython = Join-Path $oiioDir 'Scripts\python.exe'
$oiiotoolExe = Get-ChildItem -Path $oiioDir -Filter 'oiiotool.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1

if ($oiiotoolExe) {
    Write-Host "[oiiotool] already installed at $($oiiotoolExe.FullName)" -ForegroundColor Green
} else {
    Write-Host "[oiiotool] looking for Python 3.12..."
    $py312 = $null
    try { & py -3.12 --version | Out-Null; $py312 = 'py -3.12' } catch { }
    if (-not $py312) { throw "Python 3.12 wasn't found (tried 'py -3.12'). Install it from https://www.python.org/downloads/ (check 'Add to PATH') and re-run this script." }

    Write-Host "[oiiotool] creating virtual environment at $oiioDir..."
    Invoke-Expression "$py312 -m venv `"$oiioDir`""

    Write-Host "[oiiotool] installing openimageio==3.1.17.0 (this downloads a prebuilt wheel, no compiling)..."
    & $oiioVenvPython -m pip install --upgrade pip | Out-Null
    & $oiioVenvPython -m pip install "openimageio==3.1.17.0"

    $oiiotoolExe = Get-ChildItem -Path $oiioDir -Filter 'oiiotool.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $oiiotoolExe) { throw "oiiotool.exe wasn't found anywhere under $oiioDir after install - inspect that folder manually." }
    Write-Host "[oiiotool] installed at $($oiiotoolExe.FullName)" -ForegroundColor Green
}
& $oiiotoolExe.FullName --version

# --- 3. Make sure config/polyhaven.json actually points at what we just installed ---
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$relativeToktx   = $toktxExe -replace [regex]::Escape($repoRoot + '\'), '' -replace '\\', '/'
$relativeOiiotool = $oiiotoolExe.FullName -replace [regex]::Escape($repoRoot + '\'), '' -replace '\\', '/'
$changed = $false
if ($config.tools.toktxPath -ne $relativeToktx)     { $config.tools.toktxPath = $relativeToktx; $changed = $true }
if ($config.tools.oiiotoolPath -ne $relativeOiiotool) { $config.tools.oiiotoolPath = $relativeOiiotool; $changed = $true }
if ($changed) {
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
    Write-Host "[config] updated config/polyhaven.json tool paths to match this machine." -ForegroundColor Yellow
} else {
    Write-Host "[config] tool paths already match config/polyhaven.json." -ForegroundColor Green
}

Write-Host "`n== Done. Both tools are installed and verified. ==" -ForegroundColor Cyan
Write-Host "Next, from the repo root, run:"
Write-Host "  npx tsx scripts/polyhaven/cli.ts discover --config config/polyhaven.json"
Write-Host "  npx tsx scripts/polyhaven/cli.ts plan --release <release-name> --out plan.json"
Write-Host "  npx tsx scripts/polyhaven/cli.ts ingest --plan plan.json --resume"
Write-Host "  npx tsx scripts/polyhaven/cli.ts validate --release <release-name>"
