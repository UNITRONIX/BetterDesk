#!/usr/bin/env bash
# BetterDesk unified security suite (local only).
# Run before publishing a release to GitHub.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "== BetterDesk security suite =="
echo "Root: $ROOT"

echo ""
echo "-- Node: tests/security --"
cd "$ROOT/web-nodejs"
npm run test:security

echo ""
echo "-- Go: relay / sessiongrant / crypto connection security --"
cd "$ROOT/betterdesk-server"
go test ./relay/ ./sessiongrant/ ./crypto/ ./auth/ -count=1 \
  -run 'ConnectionSecurity|AuthorizationRegistry|SignIdPk|IssueAndVerify|VerifyRejects|JWT'

echo ""
echo "Security suite PASSED."
