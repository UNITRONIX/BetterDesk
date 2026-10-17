# BetterDesk Security Test Suite

**Suite version:** see `web-nodejs/tests/security/suite.manifest.js` (`version` field; currently **1.2.0**).

Repeatable, versionable, defensive regression tests for release gates.
Attack-shaped inputs are used only to assert that controls **reject** or
**neutralize** them. Tests bind to **127.0.0.1 / in-process** harnesses only —
never point this suite at remote or production hosts.

## Why it exists

Before publishing a BetterDesk version to GitHub, run this suite to re-check:

- SQL injection / identifier hygiene
- XSS output encoding
- Authorization bypass / RBAC
- Login brute-force rate limiting
- CSRF, CORS allowlist, SSRF guards
- RustDesk Client API (session leak, heartbeat spoofing, server-key exposure)
- WebSocket / connection CSWSH and BD Bearer-only rules
- Path traversal / open redirects
- Go relay tickets, session grants, server IdPk signing (impersonation)

## Layout

```text
web-nodejs/tests/security/
  suite.manifest.js          # version + module inventory (bump when adding modules)
  payloads.js                # shared attack-shaped payloads
  helpers.js                 # local Express / WS helpers
  01-sql-injection.test.js
  02-xss.test.js
  03-auth-bypass.test.js
  04-brute-force.test.js
  05-csrf-cors-ssrf.test.js
  06-rustdesk-client-api.test.js
  07-connection-ws.test.js
  08-path-redirect.test.js
  09-deps-audit.test.js
  README.md                  # short how-to for contributors

betterdesk-server/relay/connection_security_test.go
  # unauthorized UUID, third-party claim, grant/key impersonation

docs/security/SECURITY_TEST_SUITE.md   # this file
scripts/run-security-suite.ps1         # Windows runner (Node + Go)
scripts/run-security-suite.sh          # Unix runner (Node + Go)
```

## How to run

From repo root:

```bash
# Windows
pwsh ./scripts/run-security-suite.ps1

# Unix
./scripts/run-security-suite.sh
```

From `web-nodejs/` only (Jest modules):

```bash
npm run test:security
```

Go connection package (from `betterdesk-server/`):

```bash
go test ./relay/ ./sessiongrant/ ./crypto/ -count=1 -run 'ConnectionSecurity|Authorization|SessionGrant|SignIdPk'
```

Full local Node+Go gate:

```bash
npm run test:security:full   # in web-nodejs/ — invokes script relative to repo
```

## Extending the suite

1. Add payloads to `payloads.js` if reusable.
2. Add `NN-topic.test.js` under `tests/security/` (next free number).
3. Register the module in `suite.manifest.js` and **bump `version`**.
4. For Go transport findings, add `TestConnectionSecurity_*` in
   `betterdesk-server/relay/connection_security_test.go` (or a sibling `*_security_test.go`).
5. Keep tests **local-only** (loopback / in-process). Do not hardcode WAN URLs.

## CI / pre-release

Recommended GitHub Actions step (or pre-release checklist):

```yaml
- name: Security suite
  run: pwsh ./scripts/run-security-suite.ps1
  # or: bash ./scripts/run-security-suite.sh
```

Also listed in [PRE_RELEASE_CHECKLIST.md](../PRE_RELEASE_CHECKLIST.md) when that file is updated for a release.

## Related docs

- [AUDIT_PRODUCTION_2026-04-10.md](./AUDIT_PRODUCTION_2026-04-10.md)
- [PR-346-transport-threat-model.md](./PR-346-transport-threat-model.md)
- [SECURITY.md](../../SECURITY.md) (reporting process)
