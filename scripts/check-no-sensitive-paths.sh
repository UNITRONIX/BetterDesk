#!/usr/bin/env bash
# Fail if operator-specific infrastructure fingerprints appear in tracked sources.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RG_BIN="${BETTERDESK_RG_BIN:-}"
if [[ -z "$RG_BIN" ]]; then
  RG_BIN="$(command -v rg 2>/dev/null || command -v rg.exe 2>/dev/null || true)"
fi
if [[ -z "$RG_BIN" ]]; then
  echo "ERROR: ripgrep (rg or rg.exe) is required" >&2
  exit 1
fi

SCAN_PATHS=(
  docs/
  bridges/
  betterdesk-agent/
  betterdesk-agent-client/
  betterdesk-server/
  web-nodejs/
  sdks/
  scripts/
  .github/
)

PATTERNS=(
  '192\.168\.0\.110'
  '/home/unitronix'
  'unitronix@192\.168'
)

FAIL=0
for pat in "${PATTERNS[@]}"; do
  if matches=$("$RG_BIN" -n "$pat" "${SCAN_PATHS[@]}" \
    --glob '!docs/private/**' \
    --glob '!scripts/check-no-sensitive-paths.sh' \
    --glob '!*.plan.md' 2>/dev/null); then
    echo "ERROR: sensitive pattern '$pat' found:" >&2
    echo "$matches" >&2
    FAIL=1
  fi
done

if [[ $FAIL -ne 0 ]]; then
  exit 1
fi

echo "OK: no blocked sensitive path patterns"
