#!/usr/bin/env bash
# Fail when the repository reintroduces a security regression fixed on
# 2026-11-13 (see docs/security/AUDIT_2026-11-13.md).
#
# Checks:
#   1. No credentials written into systemd units by the installers (H3).
#   2. No committed unit file carries a secret (H3).
#   3. Templates escape data embedded in inline <script> (M11).
#
# Only repository source paths are scanned; build caches, vendored dependency
# trees and archived *_old projects are ignored so the gate stays fast.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

FAILED=0
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
pass() { printf 'PASS  %s\n' "$*"; }

# Paths owned by the project (never caches, never node_modules).
SCAN_SCRIPTS=(betterdesk.sh betterdesk.ps1 install.sh docker-entrypoint.sh)

# 1. Installers must not emit a credential as a systemd Environment= line.
#    Non-secret keys (`Environment=DB_TYPE=…`) remain allowed.
UNIT_SECRET_LINE='^[[:space:]]*Environment=(DATABASE_URL|DB_URL|DEFAULT_ADMIN_PASSWORD|SESSION_SECRET|UPDATE_GITHUB_TOKEN|SMTP_PASS)=.'
UNIT_HITS=""
for f in "${SCAN_SCRIPTS[@]}"; do
    [ -f "$f" ] || continue
    hit="$(grep -nE "$UNIT_SECRET_LINE" "$f" 2>/dev/null || true)"
    [ -n "$hit" ] && UNIT_HITS="${UNIT_HITS}${f}:${hit}"$'\n'
done
if [ -n "$UNIT_HITS" ]; then
    fail "credential written into a systemd unit:"
    printf '%s' "$UNIT_HITS"
else
    pass "installers keep credentials out of systemd units"
fi

# 2. Any .service file inside the repo tree must be credential-free.
UNIT_LEAK=""
for unit in $(ls -1 *.service 2>/dev/null; ls -1 scripts/*.service 2>/dev/null; ls -1 contrib/*/*.service 2>/dev/null); do
    [ -f "$unit" ] || continue
    if grep -qE 'DATABASE_URL|DEFAULT_ADMIN_PASSWORD|SESSION_SECRET|UPDATE_GITHUB_TOKEN' "$unit" 2>/dev/null; then
        UNIT_LEAK="${UNIT_LEAK}${unit}"$'\n'
    fi
done
if [ -n "$UNIT_LEAK" ]; then
    fail "secret-bearing unit committed:"
    printf '%s' "$UNIT_LEAK"
else
    pass "committed unit files are credential-free"
fi

# 3. Inline <script> data must go through the escaping helper (M11).
JSON_SINK="$(grep -rn --include='*.ejs' -E '<%-[[:space:]]*JSON\.stringify\(|\$\{JSON\.stringify\(' web-nodejs/views 2>/dev/null || true)"
if [ -n "$JSON_SINK" ]; then
    fail "unescaped JSON.stringify in a template script sink:"
    printf '%s\n' "$JSON_SINK"
else
    pass "templates escape inline script data (safeJsonScript)"
fi

printf '\n'
if [ "$FAILED" -eq 0 ]; then
    echo "RESULT: PASS"
    exit 0
fi
echo "RESULT: FAIL"
exit 1
