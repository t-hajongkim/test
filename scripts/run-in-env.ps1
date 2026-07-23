param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Command,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CommandArguments
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$micromambaExecutable = Join-Path $projectRoot ".tools\micromamba.exe"
$environmentPrefix = Join-Path $projectRoot ".venv"
$env:MAMBA_ROOT_PREFIX = Join-Path $projectRoot ".mamba"

if (-not (Test-Path $micromambaExecutable)) {
    throw "Micromamba is not installed. Run scripts\bootstrap.ps1 first."
}

if (-not (Test-Path $environmentPrefix)) {
    throw "The project environment does not exist. Run scripts\bootstrap.ps1 first."
}

& $micromambaExecutable run `
    --prefix $environmentPrefix `
    $Command `
    @CommandArguments

exit $LASTEXITCODE
