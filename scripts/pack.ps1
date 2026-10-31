# Pack .qplugin: manifest.json (zip root) + dist/ static assets.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/pack.ps1 [-Version 0.4.0]
#
# Uses the bundled bsdtar (`tar -a` -> zip by extension): forward-slash entry
# names on every PowerShell version. Compress-Archive writes backslash entries
# (breaks cross-platform install); .NET ZipFile is unreliable on PS 5.1.
param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Version defaults to manifest.json's version: a hand-passed value drifts from
# the manifest (package name vs inner version mismatch breaks update checks).
if (-not $Version) {
    $Version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
    if (-not $Version) { Write-Error "manifest.json has no version field" }
}

if (-not (Test-Path "dist/index.html")) {
    Write-Error "dist/index.html not found - run 'npm run build' first"
}

$stage = Join-Path $env:TEMP "qplugin-stage-server-manager"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

# Stage content: manifest + dist + l10n (if present) from project root.
# Fail loudly instead of silently skipping (manifest is mandatory).
$staged = @()
foreach ($item in @('manifest.json', 'dist', 'l10n')) {
    $src = Join-Path $root $item
    if (Test-Path $src) {
        Copy-Item $src $stage -Recurse -Force
        $staged += $item
    } elseif ($item -eq 'manifest.json') {
        Write-Error "manifest.json not found in $root"
    }
}

# Sign the staged content (ADR-050 chain with a local root key). Signs exactly
# what goes into the zip; the launcher (debug build) needs
# QOMICEX_DEV_ROOT_PUBLIC_KEY set accordingly.
node (Join-Path $PSScriptRoot "sign-local.mjs") --stage $stage
if ($LASTEXITCODE -ne 0) { Write-Error "sign-local.mjs failed with exit code $LASTEXITCODE" }

foreach ($sig in @('signature.json', 'signature.cert.json')) {
    $src = Join-Path (Join-Path $root 'build') $sig
    if (Test-Path $src) {
        Copy-Item $src $stage -Force
        $staged += $sig
    }
}

$outDir = Join-Path $root "release"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$out = Join-Path $outDir "top.qomicex.server-manager-$Version.qplugin"
if (Test-Path $out) { Remove-Item $out -Force }

# Use the absolute path: Git-Bash's GNU tar may shadow bsdtar on PATH and it
# cannot write zip archives at all.
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path $tarExe)) { Write-Error "bsdtar not found at $tarExe" }

# bsdtar -a picks the format from the suffix: '.qplugin' is unknown and falls
# back to plain tar, so write a '.zip' first and rename afterwards.
$tmpZip = Join-Path $outDir "pack-tmp.zip"
if (Test-Path $tmpZip) { Remove-Item $tmpZip -Force }

Push-Location $stage
try {
    # Feed exactly what staging produced (avoids arg-vs-fs drift)
    & $tarExe -a -cf $tmpZip @staged
    if ($LASTEXITCODE -ne 0) { Write-Error "tar failed with exit code $LASTEXITCODE (staged: $($staged -join ', '))" }
} finally {
    Pop-Location
}
Move-Item $tmpZip $out -Force
Remove-Item $stage -Recurse -Force

Write-Host "Packed: $out"
