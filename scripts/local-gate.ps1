param(
    [switch]$DryRun,
    [switch]$PreflightOnly,
    [string]$ReportDir
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

$arguments = @("scripts/local-gate.js")
if ($DryRun) { $arguments += "--dry-run" }
if ($PreflightOnly) { $arguments += "--preflight-only" }
if ($ReportDir) {
    $arguments += "--report-dir"
    $arguments += $ReportDir
}

& node @arguments
exit $LASTEXITCODE
