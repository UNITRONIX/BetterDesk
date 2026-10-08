#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if command -v node >/dev/null 2>&1; then
    exec node scripts/local-gate.js "$@"
elif command -v node.exe >/dev/null 2>&1; then
    exec node.exe scripts/local-gate.js "$@"
elif command -v powershell.exe >/dev/null 2>&1; then
    exec powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
        -File scripts/local-gate.ps1 "$@"
else
    printf '%s\n' "BLOCKED: Node.js or PowerShell is not available to run the local gate." >&2
    exit 1
fi
