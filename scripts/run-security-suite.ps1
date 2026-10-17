# BetterDesk unified security suite (local only).
# Run before publishing a release to GitHub.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root 'web-nodejs'))) {
    throw "Cannot locate repo root from $PSScriptRoot"
}

Write-Host "== BetterDesk security suite ==" -ForegroundColor Cyan
Write-Host "Root: $Root"

Push-Location (Join-Path $Root 'web-nodejs')
try {
    Write-Host "`n-- Node: tests/security --" -ForegroundColor Yellow
    npm run test:security
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

Push-Location (Join-Path $Root 'betterdesk-server')
try {
    Write-Host "`n-- Go: relay / sessiongrant / crypto connection security --" -ForegroundColor Yellow
    go test ./relay/ ./sessiongrant/ ./crypto/ ./auth/ -count=1 -run 'ConnectionSecurity|AuthorizationRegistry|SignIdPk|IssueAndVerify|VerifyRejects|JWT'
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

Write-Host "`nSecurity suite PASSED." -ForegroundColor Green
exit 0
