#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

printf '%s\n' "Checking local BetterDesk gate prerequisites..."
if command -v node >/dev/null 2>&1; then
    node scripts/local-gate.js --preflight-only
elif command -v node.exe >/dev/null 2>&1; then
    node.exe scripts/local-gate.js --preflight-only
elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
        -File scripts/local-gate.ps1 -PreflightOnly
else
    printf '%s\n' "BLOCKED: Node.js or PowerShell is not available." >&2
    exit 1
fi
git config --local core.hooksPath .githooks
printf '%s\n' "Local hooks enabled at .githooks."
