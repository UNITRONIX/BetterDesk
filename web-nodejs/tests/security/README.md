# Security suite (Node)

Defensive Jest modules for the BetterDesk console and RustDesk Client API.

| Module | Covers |
|--------|--------|
| `01-sql-injection` | SQLi payloads, identifier hygiene |
| `02-xss` | Output encoding |
| `03-auth-bypass` | Unauthenticated API + RBAC |
| `04-brute-force` | Login rate limit |
| `05-csrf-cors-ssrf` | CSRF, CORS allowlist, SSRF |
| `06-rustdesk-client-api` | Client API auth, heartbeat spoof, server-key |
| `07-connection-ws` | WS Origin / CSWSH, BD Bearer |
| `08-path-redirect` | Path traversal, open redirect |
| `09-deps-audit` | Min versions for axios / proxy-addr / brace-expansion / multer |

**Run:** `npm run test:security` from `web-nodejs/`.

**Version / inventory:** `suite.manifest.js` (v1.2.0) — bump when adding modules.

See [docs/security/SECURITY_TEST_SUITE.md](../../../docs/security/SECURITY_TEST_SUITE.md).
