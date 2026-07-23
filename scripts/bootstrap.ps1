param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $projectRoot ".tools"
$mambaRoot = Join-Path $projectRoot ".mamba"
$environmentPrefix = Join-Path $projectRoot ".venv"
$micromambaExecutable = Join-Path $toolsDirectory "micromamba.exe"
$archivePath = Join-Path $toolsDirectory "micromamba-win-64.tar.bz2"
$extractDirectory = Join-Path $toolsDirectory "micromamba-package"
$environmentFile = Join-Path $projectRoot "environment.yml"
$packageLock = Join-Path $projectRoot "package-lock.json"

New-Item -ItemType Directory -Force -Path $toolsDirectory | Out-Null

if (-not (Test-Path $micromambaExecutable)) {
    Write-Host "Downloading portable Micromamba..."
    curl.exe `
        --fail `
        --location `
        --show-error `
        --silent `
        "https://micro.mamba.pm/api/micromamba/win-64/latest" `
        --output $archivePath

    New-Item -ItemType Directory -Force -Path $extractDirectory | Out-Null
    tar.exe -xjf $archivePath -C $extractDirectory

    $downloadedExecutable = Get-ChildItem `
        -Path $extractDirectory `
        -Filter "micromamba.exe" `
        -File `
        -Recurse |
        Select-Object -First 1

    if (-not $downloadedExecutable) {
        throw "The Micromamba archive did not contain micromamba.exe."
    }

    Copy-Item $downloadedExecutable.FullName $micromambaExecutable
}

$env:MAMBA_ROOT_PREFIX = $mambaRoot

if (-not (Test-Path $environmentPrefix)) {
    Write-Host "Creating project environment..."
    & $micromambaExecutable create `
        --yes `
        --prefix $environmentPrefix `
        --file $environmentFile

    if ($LASTEXITCODE -ne 0) {
        throw "Micromamba failed to create the project environment."
    }
}

$installCommand = if (Test-Path $packageLock) { "ci" } else { "install" }

Write-Host "Installing npm dependencies with npm $installCommand..."
& $micromambaExecutable run `
    --prefix $environmentPrefix `
    npm $installCommand

if ($LASTEXITCODE -ne 0) {
    throw "npm dependency installation failed."
}

Write-Host "Environment versions:"
& $micromambaExecutable run --prefix $environmentPrefix node --version
& $micromambaExecutable run --prefix $environmentPrefix npm --version
& $micromambaExecutable run --prefix $environmentPrefix npx tsc --version
& $micromambaExecutable run --prefix $environmentPrefix npx vitest --version
