param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

Write-Output "Checking local BetterDesk gate prerequisites..."
& node scripts/local-gate.js --preflight-only
if ($LASTEXITCODE -ne 0) {
    throw "Prerequisite check failed. Install the missing tools before enabling local hooks."
}

& git config --local core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
    throw "Could not configure the local Git hooks path."
}

Write-Output "Local hooks enabled at .githooks."
Write-Output "Both pre-commit and pre-push run the complete local gate."
