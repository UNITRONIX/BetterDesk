# BetterDesk — Project Structure

Current layout of the BetterDesk monorepo (Go server + Node.js console). Legacy Flask / `hbbs-patch` trees were removed in the 2.x → 3.x era.

## Top-level layout

```
BetterDesk/
├── betterdesk-server/          # Go signal + relay + HTTP API (single binary)
├── web-nodejs/                 # Express server: API, sockets, serves the console
├── web-ui/                     # The console's pages (Svelte 5, SvelteKit single-page app)
├── rdclient-desktop/           # Tauri v2 operator desktop shell (RdClient)
├── sdks/
│   ├── nodejs/                 # CDAP Node.js SDK (betterdesk-cdap)
│   └── python/                 # CDAP Python SDK
├── bridges/                    # Reference CDAP bridges (modbus, snmp, rest-webhook)
├── docker/                     # Entrypoints, supervisord, helpers
├── docs/                       # Architecture, setup, security, wiki
├── scripts/                    # Version bump, toolchain, wiki sync
├── contrib/                    # Community contrib (e.g. FreeBSD rc.d)
├── .github/                    # CI, Dependabot, CodeQL
├── Dockerfile                  # All-in-one image (Go server + Node console)
├── Dockerfile.server           # Go server image
├── Dockerfile.console          # Node console image
├── betterdesk.sh / .ps1        # Native install / update
├── betterdesk-docker.sh        # Docker-oriented installer
├── CHANGELOG.md
└── VERSION
```

**Client Generator:** The console builds BetterDesk-Client template bundles and stores them
under the console data module. The withdrawn `betterdesk-support-agent/`,
`betterdesk-agent/`, and `betterdesk-agent-client/` source trees are not part of the
Docker images or the panel update path.

## Core components

### `betterdesk-server/`
Clean-room Go implementation replacing RustDesk `hbbs`+`hbbr`: UDP/TCP/WS signal, relay, REST API, JWT/RBAC, SQLite/PostgreSQL, CDAP gateway, MeshCentral compat. Pure Go (no CGO). Module: `go.mod` (toolchain pinned).

### `web-nodejs/`
Node.js server of the management panel: the JSON API for devices, users, policies, updates and the remote viewer, i18n (26 locales), sockets. Talks to the Go API and serves the console build from `web-ui/` at the root. Runtime: Node.js **22+** (Docker/CI/installers target **24 LTS**).

### `web-ui/`
The console's pages: Svelte 5 and SvelteKit as a single-page app, built with Vite into `web-ui/build`. See `web-ui/README.md`.

### `rdclient-desktop/`
Tauri 2 **operator** desktop shell that hosts the panel remote UI. Vendored `wry` patch + documented glib/`RUSTSEC` ignore until GTK stack migration.

### `sdks/` + `bridges/`
CDAP client libraries and sample industrial/IoT bridges. SNMP bridge uses official **`pysnmp` 7.x** (not the legacy `pysnmplib` fork).

### Docker / install
- Console images: pinned `node:22.23.2-alpine3.24` temporarily for Node.js 24 cleanup-hook stability; CI/client tooling may still use Node 24. Go build image: `golang:1.26-alpine`; server runtime: `alpine:3.22+`
- Compose files at repo root (`docker-compose*.yml`)
- Updates: panel Settings → Updates (`updateService.js`) or `betterdesk.sh` / `betterdesk.ps1`

## Documentation hub (`docs/`)

| Area | Path |
|------|------|
| Branching / versioning | `docs/important/branching-and-versioning.md` |
| Update flow | `docs/important/betterdesk-update-flow.md` |
| Docker | `docs/docker/` |
| Security audits | `docs/security/` |
| Wiki mirror | `docs/wiki/` |
| Dependency upgrade backlog | `docs/development/DEPENDENCY_UPGRADE_BACKLOG.md` |

## Historical note

Older docs and installers may still mention Flask consoles, `hbbs-patch/`, or a `deprecated/ban_enforcer.py` tree. Those components are **not** in this repository anymore. Use Go server + `web-nodejs` only.

## For contributors

1. Work on **`dev`** by default (see branching docs).
2. Run `web-nodejs` → `npm test`; `betterdesk-server` → `go test ./...` (+ `govulncheck`).
3. Keep locale keys in sync across all `web-nodejs/lang/*.json` files.

---

Last updated: 2026-07-31 (runtime EOL + dependency audit)
