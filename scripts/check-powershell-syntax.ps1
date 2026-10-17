param(
    [string[]]$Path = @(
        "betterdesk.ps1",
        "build-betterdesk.ps1",
        "scripts/check-powershell-syntax.ps1",
        "scripts/check-wiki-staleness.ps1",
        "scripts/local-gate.ps1",
        "scripts/setup-local-gates.ps1",
        "scripts/sync-wiki.ps1"
    )
)

$ErrorActionPreference = "Stop"
$failures = @()

foreach ($file in $Path) {
    $resolved = Join-Path (Split-Path -Parent $PSScriptRoot) $file
    if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
        $failures += "$file is missing"
        continue
    }

    $tokens = $null
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Resolve-Path -LiteralPath $resolved),
        [ref]$tokens,
        [ref]$errors
    ) | Out-Null

    if ($errors.Count -gt 0) {
        $messages = $errors | ForEach-Object { $_.Message }
        $failures += "$file failed to parse: $($messages -join '; ')"
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "PowerShell installer syntax checks passed."
