# BetterDesk Console - Instrukcje dla Copilota

> Ten plik jest automatycznie dołączany do kontekstu rozmów z GitHub Copilot.
> Zawiera aktualne informacje o stanie projektu i wytyczne do dalszej pracy.

---

## 📊 Stan Projektu (aktualizacja: 2026-03-01)

### Wersja Skryptów ALL-IN-ONE (v2.4.0)

| Plik | Wersja | Platforma | Status |
|------|--------|-----------|--------|
| `betterdesk.sh` | v2.4.0 | Linux | ✅ ALL-IN-ONE + Node.js only + SSL config + PostgreSQL + Auto mode |
| `betterdesk.ps1` | v2.4.0 | Windows | ✅ ALL-IN-ONE + Node.js only + SSL config + PostgreSQL + Auto mode |
| `betterdesk-docker.sh` | v2.4.0 | Docker | ✅ Interaktywny ALL-IN-ONE + PostgreSQL + Migration |

### Konsole Webowe

| Typ | Folder | Status | Opis |
|-----|--------|--------|------|
| **Node.js** | `web-nodejs/` | ✅ Aktywna (jedyna) | Express.js, EJS, better-sqlite3, CSRF, TOTP 2FA |
| **Flask** | `archive/web-flask/` | 📦 Archived | Python, Jinja2 - przeniesiony do archiwum |

### Serwer BetterDesk (Go)

| Komponent | Folder | Status | Opis |
|-----------|--------|--------|------|
| **Go Server** | `betterdesk-server/` | ✅ Production-ready | Single binary replacing hbbs+hbbr, ~20K LOC Go |
| **Rust (archived)** | `archive/hbbs-patch-v2/` | 📦 Archived | Patched Rust binaries v2.1.3 - przeniesione do archiwum |

### Serwer Go — Binaries (NIE są w repozytorium, kompilowane lokalnie)

| Platforma | Plik | Status |
|-----------|------|--------|
| Linux x86_64 | `betterdesk-server-linux-amd64` | Kompiluj lokalnie: `go build` |
| Linux ARM64 | `betterdesk-server-linux-arm64` | Kompiluj lokalnie: `GOARCH=arm64 go build` |
| Windows x86_64 | `betterdesk-server.exe` | Kompiluj lokalnie: `GOOS=windows go build` |

---

## 🚀 Skrypty ALL-IN-ONE (v2.4.0)

### Nowe funkcje w v2.4.0

- ✅ **PostgreSQL support** - full PostgreSQL database support for Go server and Node.js console
- ✅ **SQLite → PostgreSQL migration** - built-in migration tool (menu option M/P)
- ✅ **Database type selection** - choose SQLite or PostgreSQL during installation
- ✅ **Docker PostgreSQL** - PostgreSQL container with health checks in docker-compose
- ✅ **Connection pooling** - pgxpool with configurable limits via DSN params
- ✅ **LISTEN/NOTIFY** - real-time event push between Go server instances

### Previous versions

#### v2.3.0
- ✅ **Flask removed** - Flask console deprecated, Node.js is now the only option
- ✅ **SSL certificate configuration** - new menu option C for SSL/TLS setup (Let's Encrypt, custom cert, self-signed)
- ✅ **Security audit fixes** - CSRF protection, session fixation prevention, timing-safe auth, WebSocket auth
- ✅ **TOTP 2FA** - Two-factor authentication with TOTP (otplib)
- ✅ **RustDesk Client API** - dedicated WAN-facing port (21121) with 7-layer security
- ✅ **Address book sync** - full AB storage with address_books table
- ✅ **Operator role** - separate admin/operator roles with different permissions
- ✅ **Desktop connect button** - connect to devices from browser (RustDesk URI handler)

#### v2.2.1
- ✅ Node.js .env config fixes, admin password fixes, systemd fixes

#### v2.2.0
- ✅ Node.js/Flask choice (Flask now deprecated)
- ✅ Migration between consoles
- ✅ Automatic Node.js installation

### Nowe funkcje w v2.1.2

- ✅ **Poprawka systemu banowania** - ban dotyczy tylko konkretnego urządzenia, nie wszystkich z tego samego IP
- ✅ **Poprawka migracji w trybie auto** - migracje bazy danych działają bez interakcji
- ✅ **Weryfikacja SHA256** - automatyczna weryfikacja sum kontrolnych binarek
- ✅ **Tryb automatyczny** - instalacja bez interakcji użytkownika (`--auto` / `-Auto`)
- ✅ **Konfigurowalne porty API** - zmienne środowiskowe `API_PORT`
- ✅ **Ulepszone usługi systemd** - lepsze konfiguracje z dokumentacją

### Funkcje wspólne dla wszystkich skryptów

1. 🚀 **New installation** - full installation from scratch (Node.js only)
2. ⬆️ **Update** - update existing installation
3. 🔧 **Repair** - automatic fix for common issues
4. ✅ **Validation** - check installation correctness
5. 💾 **Backup** - create backups
6. 🔐 **Password reset** - reset admin password
7. 🔨 **Build binaries** - compile from source
8. 📊 **Diagnostics** - detailed problem analysis
9. 🗑️ **Uninstall** - full removal
10. 🔒 **SSL config** - configure SSL/TLS certificates (NEW in v2.3.0)
11. 🔄 **Migrate** - migrate from existing RustDesk Docker (Docker script only)
12. 🔀 **Database migration** - migrate databases between Rust/Node.js/Go/PostgreSQL (NEW)

### Użycie

```bash
# Linux - tryb interaktywny
sudo ./betterdesk.sh

# Linux - tryb automatyczny
sudo ./betterdesk.sh --auto

# Linux - pomiń weryfikację SHA256
sudo ./betterdesk.sh --skip-verify

# Windows (PowerShell jako Administrator) - tryb interaktywny
.\betterdesk.ps1

# Windows - tryb automatyczny
.\betterdesk.ps1 -Auto

# Windows - pomiń weryfikację SHA256
.\betterdesk.ps1 -SkipVerify

# Docker
./betterdesk-docker.sh
```

---

## 🛠️ Konfiguracja portu API

### Zmienne środowiskowe

```bash
# Linux - niestandardowy port API
API_PORT=21120 sudo ./betterdesk.sh --auto

# Windows
$env:API_PORT = "21114"
.\betterdesk.ps1 -Auto
```

### Domyślne porty

| Port | Usługa | Opis |
|------|--------|------|
| 21120 | HTTP API (Linux) | BetterDesk HTTP API (domyślny Linux) |
| 21114 | HTTP API (Windows) | BetterDesk HTTP API (domyślny Windows) |
| 21115 | TCP | NAT type test |
| 21116 | TCP/UDP | ID Server (rejestracja klientów) |
| 21117 | TCP | Relay Server |
| 5000 | HTTP | Web Console (admin panel) |
| 21121 | TCP | RustDesk Client API (WAN-facing, dedicated) |

### Skrypt diagnostyczny (dev)
```bash
# Szczegółowa diagnostyka offline status
./dev_modules/diagnose_offline_status.sh
```

---

## 🏗️ Architektura

### Struktura Katalogów

```
Rustdesk-FreeConsole/
├── betterdesk-server/       # Go server (replacing hbbs+hbbr) — ~20K LOC
│   ├── main.go              # Entry point, flags, boot
│   ├── signal/              # Signal server (UDP/TCP/WS)
│   ├── relay/               # Relay server (TCP/WS)
│   ├── api/                 # HTTP REST API + auth handlers
│   ├── crypto/              # Ed25519 keys, NaCl secure TCP, addr codec
│   ├── db/                  # Database interface + SQLite impl (future: PostgreSQL)
│   ├── config/              # Configuration + constants
│   ├── codec/               # Wire protocol framing
│   ├── peer/                # Concurrent in-memory peer map
│   ├── security/            # IP/ID/CIDR blocklist
│   ├── auth/                # JWT, PBKDF2, roles, TOTP
│   ├── ratelimit/           # Bandwidth + conn + IP rate limit
│   ├── metrics/             # Prometheus exposition
│   ├── audit/               # Ring-buffer audit log
│   ├── events/              # Pub/sub event bus
│   ├── logging/             # Text/JSON structured logging
│   ├── admin/               # TCP management console
│   ├── reload/              # Hot-reload (SIGHUP)
│   ├── proto/               # Generated protobuf (rendezvous + message)
│   └── tools/               # Migration utilities
├── web-nodejs/              # Node.js web console (active)
├── web/                     # Flask web console (deprecated)
├── hbbs-patch-v2/           # Legacy Rust server binaries (v2.1.3)
│   ├── hbbs-linux-x86_64    # Signal server Linux (Rust)
│   ├── hbbr-linux-x86_64    # Relay server Linux (Rust)
│   ├── hbbs-windows-x86_64.exe  # Signal server Windows (Rust)
│   ├── hbbr-windows-x86_64.exe  # Relay server Windows (Rust)
│   └── src/                 # Rust source code modifications
├── docs/                    # Documentation (English)
├── dev_modules/             # Development & testing utilities
├── archive/                 # Archived files (not in git)
├── Dockerfile.*             # Docker images
├── docker-compose.yml       # Docker orchestration
└── migrations/              # Database migrations
```

### Porty

| Port | Usługa | Opis |
|------|--------|------|
| 21114 | HTTP API | BetterDesk Server REST API (Go/Rust) |
| 21115 | TCP | NAT type test + OnlineRequest |
| 21116 | TCP/UDP | Signal Server (client registration, punch hole) |
| 21117 | TCP | Relay Server (bidirectional stream) |
| 21118 | WS | WebSocket Signal (signal port + 2) |
| 21119 | WS | WebSocket Relay (relay port + 2) |
| 5000 | HTTP | Web Console (admin panel, LAN) |
| 21121 | TCP | RustDesk Client API (WAN-facing, Node.js) |

### Go Server — Architecture Flow

```
RustDesk Client
  ├── UDP (:21116) → signal/serveUDP → RegisterPeer, PunchHole, RequestRelay
  ├── TCP (:21116) → signal/serveTCP → NaCl KeyExchange → secure channel
  ├── WS  (:21118) → signal/serveWS → websocket signal
  ├── TCP (:21117) → relay/serveTCP → UUID pairing → io.Copy bidirectional
  ├── WS  (:21119) → relay/serveWS → websocket relay
  └── TCP (:21115) → signal/serveNAT → TestNatRequest, OnlineRequest

Console/Admin
  ├── HTTP (:21114) → api/server → JWT/API-key → REST handlers
  ├── TCP  (admin)  → admin/server → CLI management
  └── WS   (:21114) → events/bus → real-time push
```

---

## 🔧 Procedury Kompilacji

### Windows (wymagania)
- Rust 1.70+ (`rustup update`)
- Visual Studio Build Tools z C++ support
- Git

### Kompilacja Windows
```powershell
# 1. Pobierz źródła RustDesk
git clone --branch 1.1.14 https://github.com/rustdesk/rustdesk-server.git
cd rustdesk-server
git submodule update --init --recursive

# 2. Skopiuj modyfikacje BetterDesk
copy ..\hbbs-patch-v2\src\main.rs src\main.rs
copy ..\hbbs-patch-v2\src\http_api.rs src\http_api.rs

# 3. Kompiluj
cargo build --release

# 4. Binarki w: target\release\hbbs.exe, target\release\hbbr.exe
```

### Linux (wymagania)
```bash
sudo apt-get install -y build-essential libsqlite3-dev pkg-config libssl-dev git
```

---

## 🧪 Środowiska Testowe

### Serwer SSH (Linux tests)
- **Host:** `user@your-server-ip` (skonfiguruj własny serwer testowy)
- **Użycie:** Testowanie binarek Linux, sprawdzanie logów

### Windows (local)
- Testowanie binarek Windows bezpośrednio na maszynie deweloperskiej

---

## 📋 Aktualne Zadania

### ✅ Ukończone (2026-02-04)
1. [x] Usunięto stary folder `hbbs-patch` (v1)
2. [x] Skompilowano binarki Windows v2.0.0
3. [x] Przetestowano binarki na obu platformach
4. [x] Zaktualizowano CHECKSUMS.md
5. [x] Dodano --fix i --diagnose do install-improved.sh (v1.5.5)
6. [x] Dodano -Fix i -Diagnose do install-improved.ps1 (v1.5.1)
7. [x] Dodano obsługę hbbs-patch-v2 binarek Windows w instalatorze PS1
8. [x] Utworzono diagnose_offline_status.sh
9. [x] Zaktualizowano TROUBLESHOOTING_EN.md (Problem 3: Offline Status)

### ✅ Ukończone (2026-02-06)
10. [x] **Naprawiono Docker** - Dockerfile.hbbs/hbbr teraz kopiują binarki BetterDesk z hbbs-patch-v2/
11. [x] **Naprawiono "no such table: peer"** - obrazy Docker używają teraz zmodyfikowanych binarek
12. [x] **Naprawiono "pull access denied"** - dodano `pull_policy: never` w docker-compose.yml
13. [x] **Naprawiono DNS issues** - dodano fallback DNS w Dockerfile.console (AlmaLinux/CentOS)
14. [x] Zaktualizowano DOCKER_TROUBLESHOOTING.md z nowymi rozwiązaniami

### ✅ Ukończone (2026-02-07)
15. [x] **Stworzono build-betterdesk.sh** - interaktywny skrypt do kompilacji (Linux/macOS)
16. [x] **Stworzono build-betterdesk.ps1** - interaktywny skrypt do kompilacji (Windows)
17. [x] **Stworzono GitHub Actions workflow** - automatyczna kompilacja multi-platform (.github/workflows/build.yml)
18. [x] **Stworzono BUILD_GUIDE.md** - dokumentacja budowania ze źródeł
19. [x] **System statusu v3.0** - konfigurowalny timeout, nowe statusy (Online/Degraded/Critical/Offline)
20. [x] **Nowe endpointy API** - /api/config, /api/peers/stats, /api/server/stats
21. [x] **Dokumentacja v3.0** - STATUS_TRACKING_v3.md
22. [x] **Zmiana ID urządzenia** - moduł id_change.rs, endpoint POST /api/peers/:id/change-id
23. [x] **Dokumentacja ID Change** - docs/ID_CHANGE_FEATURE.md

### ✅ Ukończone (2026-02-11)
24. [x] **System i18n** - wielojęzyczność panelu web przez JSON
25. [x] **Moduł Flask i18n** - web/i18n.py z API endpoints
26. [x] **JavaScript i18n** - web/static/js/i18n.js client-side
27. [x] **Tłumaczenia EN/PL** - web/lang/en.json, web/lang/pl.json
28. [x] **Selector języka** - w sidebarze panelu
29. [x] **Dokumentacja i18n** - docs/CONTRIBUTING_TRANSLATIONS.md

### ✅ Ukończone (2026-02-17)
30. [x] **Security audit v2.3.0** - 3 Critical, 5 High, 8 Medium, 6 Low findings - all Critical/High fixed
31. [x] **CSRF protection** - double-submit cookie pattern with csrf-csrf
32. [x] **Session fixation prevention** - session regeneration after login
33. [x] **Timing-safe auth** - pre-computed dummy bcrypt hash for non-existent users
34. [x] **WebSocket auth** - session cookie required for upgrade
35. [x] **Trust proxy configurable** - TRUST_PROXY env var
36. [x] **RustDesk Client API** - dedicated WAN port 21121 with 7-layer security
37. [x] **TOTP 2FA** - two-factor authentication with otplib
38. [x] **Address book sync** - AB storage with address_books table
39. [x] **Operator role** - admin/operator role separation
40. [x] **Flask removed from scripts** - betterdesk.sh + betterdesk.ps1 updated
41. [x] **SSL certificate configuration** - new menu option in both scripts
42. [x] **README updated** - comprehensive update for v2.3.0
43. [x] **Web Remote Client fixed** - 5 Critical, 2 High, 3 Low bugs fixed (video_received ack, autoplay, modifier keys, Opus audio, timestamps, O(n²) buffer, seeking, mouse, cursor, i18n)

### 🔜 Do Zrobienia (priorytety)

#### Go Server — Security Fixes (Phase 1) ✅ COMPLETED 2026-02-28
1. [x] **H1**: Walidacja `new_id` w API `POST /api/peers/{id}/change-id` — `peerIDRegexp` validation added
2. [x] **H3**: Rate-limiting na `POST /api/auth/login/2fa` — `loginLimiter.Allow(clientIP)` + audit log
3. [x] **H4**: Short TTL (5min) dla partial 2FA token — `GenerateWithTTL()` method added to JWTManager
4. [x] **M1**: Escapowanie `%`/`_` w `ListPeersByTag` SQL LIKE pattern — `ESCAPE '\'` clause added
5. [x] **M4**: Rate-limiting na TCP signal connections — `limiter.Allow(host)` in `serveTCP()`
6. [x] **M6**: Walidacja klucza w config endpoints — `configKeyRegexp` (1-64 alnum, dots, hyphens)

#### Go Server — Protocol Fixes (Phase 2) ✅ COMPLETED 2026-02-28
7. [x] **M8**: `ConfigUpdate` w `TestNatResponse` (relay_servers, rendezvous_servers) — klienty ≥1.3.x
8. [x] **M2**: TTL/max-size dla `tcpPunchConns` sync.Map (DDoS protection) — 2min TTL + 10K cap
9. [x] **M3**: WebSocket origin validation (signal + relay) — `WS_ALLOWED_ORIGINS` env var
10. [x] **M7**: Relay idle timeout (io.Copy stale sessions) — `idleTimeoutConn` wrapper

#### Go Server — TLS Everywhere (Phase 3) ✅ COMPLETED 2026-02-28
11. [x] TLS wrapper for TCP signal (:21116) via `config.DualModeListener` (auto-detect plain/TLS)
12. [x] TLS wrapper for TCP relay (:21117) via `config.DualModeListener` (auto-detect plain/TLS)
13. [x] WSS (WebSocket Secure) for signal (:21118) and relay (:21119) via `ListenAndServeTLS`
14. [x] Fallback: accept both plain and TLS on same ports (first-byte 0x16 detection)
15. [x] Config: `--tls-signal`, `--tls-relay` flags + `TLS_SIGNAL=Y`, `TLS_RELAY=Y` env vars

#### Go Server — PostgreSQL Integration (Phase 4) ✅ COMPLETED 2026-02-28
16. [x] `db/postgres.go` — full `Database` interface implementation using `pgx/v5` (pgxpool, 25+ methods)
17. [x] `db/open.go` — detect `postgres://` DSN and dispatch to PostgreSQL driver
18. [x] Config: `DB_URL=postgres://user:pass@host:5432/betterdesk` env var support (already in LoadEnv)
19. [x] Connection pooling with `pgxpool` (configurable max conns via `pool_max_conns` DSN param)
20. [x] Replace `sync.RWMutex` with PostgreSQL row-level locking (tx + FOR UPDATE in ChangePeerID)
21. [x] `LISTEN/NOTIFY` for real-time event push between instances (ListenLoop, Notify, OnNotify)
22. [x] PostgreSQL schema with proper types (BOOLEAN, BYTEA, TIMESTAMPTZ, BIGSERIAL)
23. [ ] Integration tests for PostgreSQL backend (requires live PostgreSQL instance)

#### Go Server — Migration Tool (Phase 5) ✅ COMPLETED 2026-03-01
24. [x] `tools/migrate/` — SQLite → PostgreSQL migration binary (5 modes: rust2go, sqlite2pg, pg2sqlite, nodejs2go, backup)
25. [x] Support migrating from original RustDesk `db_v2.sqlite3` schema (`peer` table → `peers`) — auto-detection
26. [x] Support migrating from BetterDesk Go schema (full schema with users, api_keys, etc.) — sqlite2pg/pg2sqlite
27. [x] Support migrating Node.js console tables (peer → peers, users → users) — nodejs2go mode
28. [x] Preserve Ed25519 keys, UUIDs, ID history, bans, tags — full data preservation
29. [x] Reverse migration: PostgreSQL → SQLite (pg2sqlite mode)
30. [x] Integration with ALL-IN-ONE scripts (betterdesk.sh / betterdesk.ps1) — menu option M in both scripts

#### Node.js Console
31. [ ] Kompilacja binarek v3.0.0 z nowymi plikami źródłowymi (Rust legacy)
32. [ ] WebSocket real-time push dla statusu
33. [ ] Dodać testy jednostkowe dla HTTP API
34. [ ] Deploy v2.3.0 to production and test all new features

#### Node.js Console — Recent Changes (deployed 2026-02-28)
35. [x] **RustDesk Client API v2.0.0** — 3 phases: heartbeat/sysinfo/peers, audit/conn/file/alarm, groups/strategies
36. [x] **Security audit** — H-1 (rate limiter IP spoofing), H-2/H-3 (device verification), M-4/M-5/M-6 (validation)
37. [x] **Device detail panel** — Hardware tab (sysinfo), Metrics tab (live bars + history charts)
38. [x] **Copy ID fix** — selector `.device-id-copy` → `.copy-btn` with stopPropagation
39. [x] **22 new i18n keys** — EN + PL translations for device_detail section

#### Go Server — E2E Encryption Fix (Phase 6) ✅ COMPLETED 2026-03-01
40. [x] **E2E handshake**: Removed spurious `RelayResponse` confirmation from `startRelay()` (was breaking `secure_connection()` handshake)
41. [x] **SignIdPk NaCl format**: Fixed `sendRelayResponse` to use `SignIdPk()` NaCl combined format (64-byte sig + IdPk protobuf) instead of raw PK
42. [x] **PunchHoleResponse**: Fixed UDP PunchHoleRequest to send `PunchHoleResponse` (with pk field) instead of `PunchHoleSent`
43. [x] **TCP PunchHole fields**: Added relay_server, nat_type, socket_addr, pk, and is_local fields to TCP PunchHole forwarding
44. [x] **Relay confirmation removed**: Removed dead `confirmRelay()` from ws.go
45. [x] **Verified E2E**: Debug relay confirmed `Message.SignedId` + `Message.PublicKey` handshake between peers
46. [x] **Deployment path fix**: Discovered systemd ExecStart path mismatch (`/opt/betterdesk-go/` vs `/opt/rustdesk/`), all binaries now deployed to correct path

#### Go Server — TCP Signaling Fix (Phase 7) ✅ COMPLETED 2026-03-04
47. [x] **TCP PunchHoleRequest immediate response**: `handlePunchHoleRequestTCP` now sends immediate `PunchHoleResponse` with signed PK, socket_addr, relay_server, and NAT type — matching UDP handler behavior. Previously returned nil and waited for target, causing "Failed to secure tcp: deadline has elapsed" timeout for TCP signaling clients (logged-in users).
48. [x] **TCP ForceRelay handling**: Added `ForceRelay || AlwaysUseRelay` check to TCP path — returns relay-only PunchHoleResponse immediately, matching UDP's `sendRelayResponse` behavior.
49. [x] **TCP RequestRelay immediate response**: `handleRequestRelayTCP` now returns immediate `RelayResponse` with signed PK and relay server to TCP initiator — previously sent nothing and waited for target's RelayResponse.
50. [x] **WebSocket RequestRelay fix**: ws.go now uses `handleRequestRelayTCP` instead of UDP handler (`handleRequestRelay`) which was sending the response via UDP — unreachable by WebSocket clients.
51. [x] **Root cause**: RustDesk client uses TCP (not UDP) for signal messages when logged in (reliable token delivery). TCP handlers returned nil for online targets, forcing clients to wait for target responses that may never arrive (strict NAT, firewall, slow network). UDP handlers always sent immediate responses.

#### GitHub Issues Triage & Fixes (Phase 8) ✅ COMPLETED 2026-03-05
52. [x] **QR code fix (Issue #38)**: Inverted QR code colors in `keyService.js` — `dark: '#e6edf3'` → `'#000000'`, `light: '#0d1117'` → `'#ffffff'` for both `getServerConfigQR()` and `getPublicKeyQR()`
53. [x] **403 error page (Issue #38)**: Created `views/errors/403.ejs` — `requireAdmin` middleware was rendering non-existent template, causing crash → redirect to dashboard for operators
54. [x] **RustDesk Client API on Go server (Issue #38)**: Added `client_api_handlers.go` with RustDesk-compatible endpoints: `POST /api/login`, `GET /api/login-options`, `POST /api/logout`, `GET /api/currentUser`, `GET/POST /api/ab`. Fixes `_Map<String, dynamic>` Dart client error caused by sending login to Go server port 21114 which lacked `/api/login`
55. [x] **GetPeer live status (Issue #16)**: `handleGetPeer` now enriches response with `live_online` and `live_status` from in-memory peer map, matching `handleListPeers` behavior. Previously returned raw DB data without live status overlay
56. [x] **i18n: forbidden keys**: Added `errors.forbidden_title` and `errors.forbidden_message` to EN/PL/ZH translations
57. [x] **Chinese i18n verified (Issue #28)**: `zh.json` has 100% key coverage — no missing translations
58. [x] **Old Rust server removed from UI**: Settings page, serverBackend.js, settings.routes.js — all hbbsApi branching removed, hardcoded to BetterDesk Go server
59. [x] **Docker single-container**: New `Dockerfile` (multi-stage Go+Node.js+supervisord), `docker-compose.single.yml`, `docker/entrypoint.sh`, `docker/supervisord.conf`
60. [x] **DB auto-detection**: `dbAdapter.js` and `config.js` auto-detect PostgreSQL from `DATABASE_URL` prefix
61. [x] **Windows experimental labels**: Tier system in README, `.github/labels.yml`, PS1 banner

#### Go Server — Sysinfo/Heartbeat Endpoints (Phase 9) ✅ COMPLETED 2026-03-05
62. [x] **Hostname/Platform display (Issue #37)**: RustDesk client sends hostname/os/version via `POST /api/sysinfo` to signal_port-2 (21114). Go server was missing these endpoints — hostname/platform columns stayed empty.
63. [x] **UpdatePeerSysinfo DB method**: Added `UpdatePeerSysinfo(id, hostname, os, version)` to Database interface + SQLite + PostgreSQL implementations. Uses CASE WHEN to only overwrite with non-empty values.
64. [x] **POST /api/heartbeat**: Accepts `{id, cpu, memory, disk}`, verifies peer exists & not banned, updates status to ONLINE, requests sysinfo if hostname is empty. Response: `{modified_at, sysinfo: true/false}`.
65. [x] **POST /api/sysinfo**: Accepts full sysinfo payload, extracts hostname/platform/version, calls `UpdatePeerSysinfo()`. Response: plain text `"SYSINFO_UPDATED"` (activates PRO mode in client).
66. [x] **POST /api/sysinfo_ver**: Version check endpoint — returns SHA256 hash of stored sysinfo fields. Empty response triggers full sysinfo upload from client.
67. [x] **Auth middleware updated**: `/api/heartbeat`, `/api/sysinfo`, `/api/sysinfo_ver` added to public endpoint list (no auth required — client may not be logged in).
68. [x] **Audit logging**: Added `ActionSysinfoUpdated` and `ActionSysinfoError` audit actions with full details (hostname, os, version).

#### Node.js Console — Route Conflict Fix (Phase 10) ✅ COMPLETED 2026-03-08
69. [x] **Users page 401 error (Issue #42)**: Route conflict in `rustdesk-api.routes.js`: `GET /api/users` handler for RustDesk desktop client (Bearer token auth) was intercepting panel requests (session cookie auth), returning 401. Fixed by detecting absent Bearer token and calling `next('route')` to allow panel routes to handle the request.
70. [x] **Peers route conflict (Issue #42)**: Same fix applied to `GET /api/peers` — fallthrough to panel routes when no Bearer token present.

#### ALL-IN-ONE Scripts — Database Config Preservation (Phase 11) ✅ COMPLETED 2026-03-13
71. [x] **PostgreSQL→SQLite switch on UPDATE**: `betterdesk.sh` and `betterdesk.ps1` were overwriting `.env` with default SQLite config during UPDATE/REPAIR, losing PostgreSQL DSN. Added `preserve_database_config()` / `Preserve-DatabaseConfig` functions that read existing `.env` before reinstall.
72. [x] **betterdesk.sh fix**: Added `preserve_database_config()` after `detect_installation()` in `do_update()` and `do_repair()`. Reads `DB_TYPE` and `DATABASE_URL` from existing `.env`, sets `USE_POSTGRESQL` and `POSTGRESQL_URI` global vars.
73. [x] **betterdesk.ps1 fix**: Added `Preserve-DatabaseConfig` PowerShell function with same logic. Called in `Do-Update` and `Do-Repair` before any reinstallation.
74. [x] **Root cause**: `install_nodejs_console()` always created new `.env` based on `USE_POSTGRESQL` var which defaults to `false`. During UPDATE, this var was never set from existing config.

#### Docker Single-Container — Port 5000 Conflict Fix (Phase 13) ✅ COMPLETED 2026-03-15
75. [x] **Root cause (Issue #56)**: Go server `config.LoadEnv()` reads generic `PORT` env var for signal port. In Docker single-container, `PORT=5000` is intended for Node.js console but leaks into Go server, setting signal to :5000. Both processes fight for port 5000 → EADDRINUSE race condition.
76. [x] **config.go fix**: Added `SIGNAL_PORT` env var with higher priority than `PORT` — `SIGNAL_PORT` takes precedence, `PORT` only used as fallback.
77. [x] **supervisord.conf fix**: Added `SIGNAL_PORT="21116"` to Go server environment section.
78. [x] **entrypoint.sh fix**: Exports `SIGNAL_PORT=${SIGNAL_PORT:-21116}` before starting supervisord.
79. [x] **Dockerfile fix**: Added `ENV SIGNAL_PORT=21116` as default alongside `ENV PORT=5000`.
80. [x] **Multi-container NOT affected**: `docker-compose.yml` uses separate containers, no port conflict.

#### ALL-IN-ONE Scripts — IP Detection & Relay Fix (Phase 14) ✅ COMPLETED 2026-03-15
81. [x] **`get_public_ip: command not found` (Issue #58)**: Diagnostics function called undefined `get_public_ip` function at line 3348. Created reusable `get_public_ip()` function in all 3 scripts (`betterdesk.sh`, `betterdesk.ps1`, `betterdesk-docker.sh`). Function prefers IPv4 (`curl -4`) over IPv6 for relay compatibility.
82. [x] **DRY refactor**: All 4+ inline `curl ifconfig.me` patterns in `betterdesk.sh` and 5+ in `betterdesk-docker.sh` replaced with `get_public_ip()` calls. Single source of truth for IP detection.
83. [x] **Private/loopback IP warning**: `setup_services()` in `betterdesk.sh` and `Setup-Services` in `betterdesk.ps1` now warn when detected IP is private (10.x, 192.168.x, 172.16-31.x) or loopback (127.0.0.1). Remote relay connections will fail with private IPs.
84. [x] **`RELAY_SERVERS` env var override**: Both scripts now support `RELAY_SERVERS=YOUR.PUBLIC.IP sudo ./betterdesk.sh` to override auto-detected IP. Critical for servers behind NAT or with broken external IP detection.
85. [x] **Go server relay port normalization**: `GetRelayServers()` in `config/config.go` now auto-appends default relay port (21117) when `-relay-servers IP` is passed without port. Uses `net.SplitHostPort`/`net.JoinHostPort` for correct IPv6 handling.

#### Security Hardening — API + Installers (Phase 15) ✅ COMPLETED 2026-03-15
86. [x] **Go API WebSocket origin hardening**: Removed `InsecureSkipVerify: true` from `api/server.go` events WS endpoint and switched to safe defaults with optional `API_WS_ALLOWED_ORIGINS` allowlist in `config/config.go`.
87. [x] **Local-only Web panel by default**: Node.js config now binds panel to `127.0.0.1` by default (`HOST`), while keeping separate `API_HOST` for RustDesk client API exposure.
88. [x] **Install script SQL/interpolation hardening**: Added SQL literal escaping + PostgreSQL identifier validation in `betterdesk.sh`; replaced dangerous shell interpolation in Python/Node fallback password reset paths with environment-variable passing.
89. [x] **Credentials persistence hardening**: Plaintext `.admin_credentials` persistence is now opt-in via `STORE_ADMIN_CREDENTIALS=true` (default secure behavior: do not persist credentials files).
90. [x] **Dependency vulnerability fixes**: Updated Node override for `tar` in `web-nodejs/package.json`; `npm audit --omit=dev` now reports 0 vulnerabilities. Added Go toolchain hardening (`go.mod` toolchain + installer checks) to avoid vulnerable Go 1.26.0 stdlib.

#### Docker — API Key Auto-Generation (Phase 16) ✅ COMPLETED 2026-03-15
91. [x] **Root cause (Issue #59)**: Docker single-container never created `.api_key` file. Dashboard used public `/api/server/stats` (showed correct count), Devices page used protected `/api/peers` (401 → empty list). Node.js sent empty `X-API-Key` header because file didn't exist in volume.
92. [x] **Go server fix (`main.go`)**: `loadAPIKey()` now has 5-step lookup: (1) `API_KEY` env var, (2) `.api_key` in key dir, (3) `.api_key` in DB dir, (4) NEW: `server_config` table, (5) NEW: auto-generate 32-byte hex key → write to `.api_key` file + sync to DB.
93. [x] **Docker entrypoint fix (`docker/entrypoint.sh`)**: Generates API key before supervisord starts if `.api_key` file missing. Uses `openssl rand -hex 32` with `/dev/urandom` fallback. Also persists `API_KEY` env var to file if provided.
94. [x] **Node.js resilience (`betterdeskApi.js`)**: Axios 401 interceptor re-reads `.api_key` from disk once on auth failure. Handles race condition where Go server generates key after Node.js cached empty value at startup.

#### Go Server — Relay & Diagnostics Fixes (Phase 17) ✅ COMPLETED 2026-03-16
95. [x] **Public IP retry never activated**: `startIPDetectionRetry()` goroutine (60s ticker, retries `detectPublicIP()`) was defined in `signal/server.go` but never called from `Start()`. If initial public IP detection failed (e.g. external services unreachable at boot), `getRelayServer()` returned LAN IP or bare port — causing remote clients to fail relay with "Failed to secure tcp: deadline has elapsed". Fixed by adding `s.startIPDetectionRetry(s.ctx)` call in `Start()` before goroutine launches.
96. [x] **`/api/audit/conn` returns 400 for numeric IDs**: RustDesk client sends `host_id` as numeric (e.g., `1340238749`). Validation `typeof body.host_id !== 'string'` rejected it. Changed to `String()` coercion for `host_id`, `host_uuid`, and `peer_id` — accepts both string and numeric IDs.
97. [x] **Stale sysinfo log spam**: Heartbeat handler logged "Requesting sysinfo refresh from {id} (stale)" every ~15 seconds per device with no throttling. Added `shouldLogSysinfoRequest()` with Map-based 5-minute cooldown per device (auto-prune at 1000 entries). Sysinfo request to client still happens every heartbeat (functional behavior unchanged), only log message is throttled.

#### Go Server — Address Book & Issue Fixes (Phase 18) ✅ COMPLETED 2026-03-17
98. [x] **Address Book storage in Go server (Issue #57)**: Replaced stub `/api/ab` handlers with real implementation. Added `address_books` table (SQLite + PostgreSQL), `GetAddressBook`/`SaveAddressBook` methods to Database interface, full GET/POST handlers for `/api/ab`, `/api/ab/personal`, `/api/ab/tags`. RustDesk clients send AB to signal_port-2 (21114=Go), not Node.js (21121).
99. [x] **Settings password "password is required" (Issue #60)**: `settings.js` sent snake_case (`current_password`, `new_password`) but `auth.routes.js` expected camelCase (`currentPassword`, `newPassword`, `confirmPassword`). Fixed field names + added missing `confirmPassword`.
100. [x] **Password modal plaintext (Issue #60)**: `modal.js` `prompt()` only checked `options.type`, but `users.js` passed `inputType: 'password'`. Fixed modal to check both `options.type` and `options.inputType`.
101. [x] **Closed 12 resolved GitHub issues**: #59, #56, #52, #28, #54, #58, #19, #53, #61, #60, #57, #48 — all verified and closed with detailed resolution comments.

#### Go Server — Empty UUID & Relay Fix (Phase 19) ✅ COMPLETED 2026-03-18
102. [x] **Root cause: Empty UUID in relay (Issues #58, #63, #64)**: When hole-punch fails, RustDesk client sends `RequestRelay{uuid=""}` because `PunchHoleResponse` protobuf has no `uuid` field. Signal server propagated empty UUID to target and relay → relay rejected both connections. Fixed `handleRequestRelay()` (UDP) and `handleRequestRelayTCP()` (TCP) to generate `uuid.New().String()` when `msg.Uuid` is empty.
103. [x] **handleRelayResponseForward safety**: Added empty UUID warning + generation in `handleRelayResponseForward()` for target-initiated relay flow (last-resort safety net).
104. [x] **Relay server address validation**: `GetRelayServers()` in `config/config.go` now rejects entries with host < 2 characters (prevents `relay=a:21117` from invalid config).
105. [x] **Docker DNS resilience (Issue #62)**: Added retry logic (`|| { sleep 2 && apk add ...; }`) to all `apk add --no-cache` commands in `Dockerfile`, `Dockerfile.server`, and `Dockerfile.console` for transient DNS failures on AlmaLinux/CentOS.

#### ALL-IN-ONE Scripts — Installer Stability Fix (Phase 20) ✅ COMPLETED 2026-03-18
106. [x] **PostgreSQL→SQLite regression on UPDATE (CRITICAL)**: `setup_services()` in `betterdesk.sh` relied solely on ephemeral shell variables (`$USE_POSTGRESQL`, `$POSTGRESQL_URI`) for database config. If vars were lost between function calls, service files defaulted to SQLite. Added safety-net re-read from `.env` at start of `setup_services()`. Same fix applied to `Setup-Services` in `betterdesk.ps1`.
107. [x] **Hard-coded `/usr/bin/node` in systemd service**: `betterdesk-console.service` template used `ExecStart=/usr/bin/node server.js`. On systems with NodeSource/nvm/snap, node is at different path. Changed to dynamic detection via `command -v node`. Added `StandardOutput=journal`, `StandardError=journal`, `SyslogIdentifier=betterdesk-console` for visible error logs.
108. [x] **Auth.db + admin password destroyed on every UPDATE (CRITICAL)**: `install_nodejs_console()` unconditionally deleted `auth.db`, generated new admin password, new SESSION_SECRET, and created `.force_password_update` sentinel — destroying all user accounts, sessions, and TOTP configs on every update. Fixed: detect existing `.env` as UPDATE indicator; preserve auth.db, SESSION_SECRET, and admin password. Only generate fresh credentials on FRESH install. Same fix applied to `Install-NodeJsConsole` in `betterdesk.ps1` and `create_compose_file` in `betterdesk-docker.sh`.
109. [x] **Legacy betterdesk-api.service not cleaned up**: Script removed `rustdesksignal.service` and `rustdeskrelay.service` but not the old Flask `betterdesk-api.service`. Added cleanup in `setup_services()` (Linux) and NSSM `BetterDeskAPI` removal in `Setup-Services` (Windows). Fixes "Failed to determine user credentials: No such process" error.
110. [x] **PS1 `Do-Update` called `Setup-ScheduledTasks` instead of `Setup-Services`**: Windows update path used scheduled tasks fallback instead of NSSM services, inconsistent with `Do-Install` which correctly calls `Setup-Services`. Fixed to call `Setup-Services`.
111. [x] **PS1 `Repair-Binaries` checked `hbbs.exe` instead of `betterdesk-server.exe`**: Binary lock check referenced legacy Rust binaries. Updated to check `betterdesk-server.exe` with `hbbs.exe` fallback.
112. [x] **PS1 NSSM env missing DB_TYPE/DATABASE_URL**: NSSM `AppEnvironmentExtra` for console service did not include database type variables. Added `DB_TYPE` and `DATABASE_URL` propagation for PostgreSQL mode.
113. [x] **Docker: API key + auth.db regenerated on every update**: `create_compose_file()` unconditionally generated new API key, new admin password, and deleted auth.db from volume. Changed to preserve existing `.api_key` and `.admin_credentials` files; only wipe auth.db on fresh install.

#### Go Server & Installers — API TLS Separation Fix (Phase 21) ✅ COMPLETED 2026-03-18
114. [x] **Root cause: API auto-HTTPS breaking Node.js ↔ Go communication**: When `--tls-cert` and `--tls-key` flags were provided, `api/server.go` used `HasTLSCert()` to auto-enable HTTPS on API port 21114. Unlike signal (`--tls-signal`) and relay (`--tls-relay`) which had explicit opt-in flags, API TLS was automatic. With self-signed certs, Node.js sent `http://localhost:21114` to an HTTPS server → Go returned HTTP 400 ("client sent an HTTP request to an HTTPS server") → `getAllPeers` failed → 0 devices in panel.
115. [x] **`--tls-api` flag added to Go server**: New `TLSApi bool` field in `config.Config`, `APITLSEnabled()` method (`TLSApi || ForceHTTPS) && HasTLSCert()`), `--tls-api` CLI flag, `TLS_API=Y` env var. `api/server.go` changed from `HasTLSCert()` to `APITLSEnabled()`. API now stays HTTP unless explicitly opted in. `--force-https` implies `--tls-api`. Startup log shows correct HTTP/HTTPS scheme.
116. [x] **Installer scripts: self-signed → API stays HTTP**: `betterdesk.sh` and `betterdesk.ps1` now pass `-tls-api` only for proper certs (Let's Encrypt, custom), not for self-signed. `api_scheme` in systemd/NSSM env set to `http` for self-signed, `https` only when `-tls-api` active.
117. [x] **SSL config menu updated**: Option C (SSL configuration) in both scripts now correctly adds/removes `-tls-api` from Go server service args. Self-signed: signal/relay TLS only, API HTTP. Proper cert: full TLS including API.
118. [x] **.env API URL no longer blindly switched to https://**: Self-signed cert generation no longer changes `BETTERDESK_API_URL=http://` to `https://` in `.env`. Only SSL config with proper certs or explicit `--tls-api` triggers HTTPS API URLs.
119. [x] **Diagnostics updated**: `betterdesk.sh` diagnostics now checks for `--tls-api` or `--force-https` in service args (not just `--tls-cert`) to determine API scheme.
120. [x] **Stale `betterdesk-go.service` cleanup**: Added removal of `betterdesk-go.service` (from manual installs with wrong credentials) to `setup_services()` legacy cleanup, `legacy_services` array, and uninstall section.
121. [x] **Migration tool auto-compilation**: `migrate_sqlite_to_postgresql()` now tries to compile migration tool from source when Go is available and binary is not found. Also validates binary supports `-mode` flag (detects outdated binaries).
122. [x] **Migration tool rebuilt**: `tools/migrate/migrate-linux-amd64` rebuilt with current source code supporting `-mode`, `-src`, `-dst`, `-node-auth` flags.

#### Web Remote Client — Cursor, Video & Input Fix (Phase 22) ✅ COMPLETED 2026-03-18
123. [x] **Cursor ImageData crash (Critical)**: `renderer.js` `updateCursor()` called `new ImageData(new Uint8ClampedArray(pixelData), w, h)` without validating `pixelData.length === w * h * 4`. Protobuf cursor data can be zstd-compressed (magic `28 b5 2f fd`), truncated, or have padding. Added: zstd detection + skip, length validation (skip if too short, truncate if too long), full try/catch wrapper. Prevents `InvalidStateError: input data length is not a multiple of 4` crash.
124. [x] **Unhandled cursor promise rejection**: `_dispatchMessage()` in `client.js` called async `renderer.updateCursor()` without `.catch()` — unhandled promise rejections from ImageData errors polluted console. Added `.catch(() => {})` wrapper.
125. [x] **JMuxer per-frame seek stutter**: `_decodeFallback()` in `video.js` seeked to live edge (`currentTime = end - 0.01`) on every frame when buffer latency exceeded 0.15s. Constant micro-seeks caused playback stutter. Increased threshold from 0.15s to 0.5s and seek offset to 0.02s — lets MSE play naturally, only intervenes when significantly behind.
126. [x] **Health check too slow**: `_startHealthCheck()` interval reduced from 2000ms to 1000ms. Hard-seek threshold from 1.5s to 0.8s. Speed-up threshold from 0.3s to 0.15s. Playback rate from 1.05 to 1.15 for faster catch-up. `_recoverVideo()` threshold from 0.3s to 0.2s.
127. [x] **Focus management after login**: `handleLoginSuccess()` in `remote.js` now calls `passwordInput.blur()` to remove focus from hidden password input. `handleSessionStart()` explicitly calls `canvas.focus()`. Prevents `_isInputFocused()` guard in `input.js` from blocking keyboard events when hidden password input retains focus.
128. [x] **`.streaming` CSS class**: `handleStateChange()` in `remote.js` adds/removes `.streaming` class on `viewerContainer`. Enables CSS rule `.viewer-container:not(.streaming) #remote-canvas { cursor: default }` — shows system cursor when not streaming, hides when streaming.
129. [x] **Dynamic codec negotiation**: `buildLoginRequest()` in `protocol.js` now detects `VideoDecoder` (WebCodecs) and `JMuxer` availability. HTTPS: reports VP9+H264+AV1+VP8 with Auto preference. HTTP: reports H264-only with H264 preference. Gives peer more encoding options on HTTPS.
130. [x] **FPS option after login**: `_startSession()` in `client.js` sends `customFps` option as Misc message after login. Default reduced from 60 to 30 fps for stability. Helps peer establish target framerate without relying solely on `video_received` ack timing.

#### Go Server & Node.js — Device Management Fix (Phase 23) ✅ COMPLETED 2026-03-18
131. [x] **IsPeerSoftDeleted interface + impl**: Added `IsPeerSoftDeleted(id string) (bool, error)` to `db/database.go` interface. Implemented in both `sqlite.go` and `postgres.go` — queries `soft_deleted` column for deleted device detection.
132. [x] **Zombie device prevention (Issues #65, #64, #38)**: Signal handler now checks `IsPeerSoftDeleted()` after `IsPeerBanned()` in both `handleRegisterPeer()` and `processRegisterPk()`. Deleted devices cannot re-register, preventing "zombie" devices from reappearing after admin deletion.
133. [x] **UpdatePeerFields method**: Added `UpdatePeerFields(id string, fields map[string]string) error` to Database interface + implementations. Supports dynamic partial updates for `note`, `user`, `tags` fields with SQL-safe allowed-key validation.
134. [x] **PATCH /api/peers/{id} endpoint**: New REST endpoint in `api/server.go` for partial peer updates. Accepts JSON body `{"note": "...", "user": "...", "tags": "..."}`. Used by Node.js panel instead of direct SQLite writes.
135. [x] **Tags type mismatch fix (Issues #65, #38)**: `handleSetPeerTags` in `api/server.go` now accepts both JSON string (`"tag1,tag2"`) and array (`["tag1","tag2"]`) using `json.RawMessage`. Fixes 400 errors when panel sends array format.
136. [x] **Notes routed through Go API**: `serverBackend.js` `updateDevice()` now calls Go server's `PATCH /api/peers/{id}` endpoint instead of writing directly to Node.js SQLite. Ensures notes/user/tags stored in Go server's `db_v2.sqlite3`.
137. [x] **Tag serialization fix**: `betterdeskApi.js` `setPeerTags()` now sends tags as array in request body. Added `updatePeer()` method for PATCH requests.
138. [x] **auth.db cleanup on delete**: `devices.routes.js` delete handler now calls `db.cleanupDeletedPeerData(id)` to remove user linkages from auth.db when device is deleted. Implemented `cleanupDeletedPeerData()` in `dbAdapter.js` for both SQLite and PostgreSQL.
139. [x] **Relay UUID tracking (Issues #65, #64)**: Old RustDesk clients respond with empty UUID in `RelayResponse`. Added `pendingRelayUUIDs sync.Map` to track UUIDs sent to targets in `RequestRelay`/`PunchHole`. When target responds with empty UUID, `handleRelayResponseForward` recovers original UUID from store. Fixes relay pairing failures.
140. [x] **ActionPeerUpdated audit**: Added `ActionPeerUpdated` constant to `audit/logger.go` for tracking peer field updates.
141. [x] **getPendingUUID retry support**: Changed `getPendingUUID()` from `LoadAndDelete` to `Load` — UUID now remains available for multiple retry attempts from target device. Cleanup handled by existing ticker goroutine (2-min TTL).

#### Go Server — Peer Metrics Persistence (Phase 24) ✅ COMPLETED 2026-03-19
142. [x] **PeerMetric struct**: Added `PeerMetric` struct to `db/database.go` (ID, PeerID, CPU, Memory, Disk, CreatedAt) for heartbeat metrics storage.
143. [x] **Database interface methods**: Added `SavePeerMetric()`, `GetPeerMetrics()`, `GetLatestPeerMetric()`, `CleanupOldMetrics()` to Database interface.
144. [x] **peer_metrics table (SQLite)**: Added `peer_metrics` table to `sqlite.go` Migrate() with indexes on peer_id and created_at. Implemented all 4 metric methods.
145. [x] **peer_metrics table (PostgreSQL)**: Added `peer_metrics` table to `postgres.go` Migrate() with BIGSERIAL PK and TIMESTAMPTZ. Implemented all 4 metric methods.
146. [x] **handleClientHeartbeat extended**: Now parses `cpu`, `memory`, `disk` float64 fields from request body and calls `SavePeerMetric()` when any value > 0.
147. [x] **GET /api/peers/{id}/metrics endpoint**: New API endpoint returns historical metrics for a peer with configurable limit (default 100, max 1000). Enables Node.js console to fetch metrics from Go server.

#### Docker — GitHub Container Registry & Quick Start (Phase 25) ✅ COMPLETED 2026-03-19
148. [x] **GitHub Actions workflow**: `.github/workflows/docker-publish.yml` — automatically builds and publishes images to `ghcr.io/unitronix/betterdesk-server`, `ghcr.io/unitronix/betterdesk-console`, `ghcr.io/unitronix/betterdesk` on push to main. Multi-arch: linux/amd64 + linux/arm64.
149. [x] **docker-compose.quick.yml**: Pre-built images from ghcr.io — no build required. One-liner install: `curl ... && docker compose up -d`.
150. [x] **DOCKER_QUICKSTART.md**: 30-second quick start guide with troubleshooting, configuration options, and client setup instructions.
151. [x] **docker-compose.yml updated**: Header now points to quick.yml for beginners.
152. [x] **README.md updated**: Docker section now starts with Quick Start (no build required).

#### ALL-IN-ONE Scripts — PS1 Compatibility & Upgrade Detection (Phase 26) ✅ COMPLETED 2026-03-19
153. [x] **PS1 `RandomNumberGenerator::Fill` crash (Issue #38)**: `[System.Security.Cryptography.RandomNumberGenerator]::Fill()` is a .NET 6+ static method unavailable in Windows PowerShell 5.1 (.NET Framework 4.x). Changed to `RNGCryptoServiceProvider.GetBytes()` instance method which works on both .NET Framework 4.x and .NET 6+. Fixes API key generation failure → 0 devices in panel on fresh Windows install.
154. [x] **Rust→Go upgrade detection (Issues #66, #38)**: `Do-Update` (PS1) and `do_update()` (bash) now detect `SERVER_TYPE=rust` (legacy hbbs/hbbr) and warn user that Rust→Go is a major architecture change requiring fresh installation. In auto mode, redirects to `Do-Install`/`do_install` automatically. In interactive mode, prompts user to confirm fresh install (recommended) or continue with partial update. Prevents broken upgrade path from v1.5.0 (Rust) to v2.3.0+ (Go).

#### Go Server — ForceRelay UUID Fix & Docker GHCR (Phase 27) ✅ COMPLETED 2026-03-19
155. [x] **ForceRelay TCP UUID mismatch (Issue #66)**: `handlePunchHoleRequestTCP` ForceRelay path returned `RelayResponse{uuid=SERVER_UUID}` directly to TCP initiator. Some RustDesk client versions ignore the UUID from `RelayResponse` received in response to `PunchHoleRequest`, generate their own UUID, and connect to relay with it — while the target connects with the server's UUID. Relay pairing always failed (different UUIDs). **Fix**: ForceRelay TCP now returns `PunchHoleResponse{nat_type=SYMMETRIC}` instead of `RelayResponse`. Client sees SYMMETRIC NAT → sends `RequestRelay{uuid=CLIENT_UUID}` on same TCP connection → `handleRequestRelayTCP` forwards CLIENT_UUID to target → both sides use same UUID → relay pairing succeeds.
156. [x] **Relay diagnostic logging**: Added `log.Printf` with UUID and relay server in `handleRequestRelayTCP` and `handleRequestRelay` (UDP) return paths for better relay pairing diagnostics.
157. [x] **Docker GHCR "denied" error (Issue #67)**: Pre-built images on `ghcr.io/unitronix/betterdesk-*:latest` not available — workflow never triggered or packages are private. Added troubleshooting section to `DOCKER_QUICKSTART.md` (3 solutions: build locally, trigger workflow, authenticate). Added fallback comment to `docker-compose.quick.yml`. Added package visibility reminder to CI workflow summary step.

#### CDAP v0.2.0 — Device Revocation & Schema (Phase 28) ✅ COMPLETED 2026-03-20
158. [x] **CDAP schema columns**: Added `device_type TEXT DEFAULT ''` and `linked_peer_id TEXT DEFAULT ''` to `peers` table in both SQLite (`db/sqlite.go`) and PostgreSQL (`db/postgres.go`) via automatic column migration (v2.5.0). Updated all SELECT/Scan queries (GetPeer, ListPeers, ListPeersByTag, ChangePeerID) and `UpdatePeerFields` allowed keys.
159. [x] **GetLinkedPeers**: New `GetLinkedPeers(id string) ([]*Peer, error)` method on Database interface + both implementations. Queries peers where `linked_peer_id = id`.
160. [x] **Device revocation endpoint**: Enhanced `DELETE /api/peers/{id}` with `?revoke=true` (auto BlockID + disconnect active connections) and `?cascade=true` (delete all linked devices). Publishes `EventPeerRevoked` event and logs `ActionPeerRevoked` audit action.
161. [x] **Connection teardown on Remove**: `peer.Entry.CloseConnections()` method closes TCP and WebSocket connections. Called from `peer.Map.Remove()` and `CleanExpired()` — revoked devices are disconnected immediately.
162. [x] **Panel revocation UI**: Delete modal in `devices.js` includes "Revoke device" checkbox with hint text. Routes through `devices.routes.js` → `serverBackend.js` → `betterdeskApi.js` with `revoke`/`cascade` query params.
163. [x] **i18n keys**: Added `revoke_option`, `revoke_hint`, `revoke_success` to EN, PL, ZH translation files.
164. [x] **Deployed & verified**: Binary deployed to production server (PostgreSQL backend). Automatic migration confirmed — `device_type` and `linked_peer_id` columns present. API returns peers correctly. 5 devices online, 53 total.

#### CDAP v0.3.0 — Panel Widget Rendering (Phase 29) ✅ COMPLETED 2026-03-20
165. [x] **cdap/api.go**: REST-helper methods on Gateway — `GetDeviceInfo()`, `GetDeviceManifest()`, `GetDeviceWidgetState()`, `IsConnected()`, `SendCommandJSON()`, `ListConnectedDevices()`. New `DeviceInfo` struct for REST responses.
166. [x] **api/cdap_handlers.go**: 6 HTTP handlers — `handleCDAPStatus`, `handleCDAPListDevices`, `handleCDAPDeviceInfo`, `handleCDAPDeviceManifest`, `handleCDAPDeviceState`, `handleCDAPSendCommand`. Uses `commandCounter atomic.Int64` for unique command IDs. Returns 503 when CDAP disabled.
167. [x] **api/server.go CDAP integration**: Added `cdapGw` field, `SetCDAPGateway()` method, 6 CDAP mux routes. `CDAPConnected` bool in `peerResponse` for both `handleListPeers` and `handleGetPeer`. CDAP overlay: if device connected via CDAP but not signal, shown as online.
168. [x] **main.go CDAP wiring**: Gateway created before API server, `SetCDAPGateway()` called before `Start()`, gateway started after API.
169. [x] **betterdeskApi.js CDAP methods**: 6 async methods — `getCDAPStatus`, `getCDAPDevices`, `getCDAPDeviceInfo`, `getCDAPDeviceManifest`, `getCDAPDeviceState`, `sendCDAPCommand`.
170. [x] **cdap.routes.js**: Page route `GET /cdap/devices/:id` + 6 API proxy routes. Uses `requireAuth` + `requireRole('operator')` for command sending.
171. [x] **routes/index.js**: Registered `cdapRoutes` as `router.use('/', cdapRoutes)`.
172. [x] **cdap-device.ejs**: Device detail page with header (name, type, version, uptime, status), offline banner, widget grid, empty state, command log panel.
173. [x] **cdap-widgets.js**: Widget renderer supporting 8 types (toggle, gauge, button, led, text, slider, select, chart). State polling every 3s. Info polling every 10s. User interaction guard (`_userInteracting` flag) prevents state overwrite during input. Grouped by category.
174. [x] **cdap-commands.js**: Command sender with per-widget cooldown (1s), confirmation dialog integration, command log (max 50 entries), toast notifications.
175. [x] **cdap.css**: Full widget styling — grid layout, toggle switch, gauge bar with danger/warning thresholds, LED indicator, slider with range labels, select dropdown, chart bars, command log panel. Responsive breakpoints. Dark theme CSS variables.
176. [x] **i18n keys**: 22 CDAP keys added to EN, PL, ZH translation files (device_detail, loading, connected, disconnected, widgets, commands, etc.).
177. [x] **Deployed & verified**: Go binary + Node.js files deployed. Server running, console active. CDAP routes return 302 (auth redirect) for unauthenticated, 401 for API without key — both correct.

#### Devices Page UI Redesign (Phase 30) ✅ COMPLETED 2026-03-20
178. [x] **devices.ejs rewrite**: Removed 280px sidebar layout. New single-column layout with horizontal scrollable folder chips (`.folder-chip` buttons), unified toolbar (search + segmented filter pills + column visibility toggle), slim table with 7 columns (id, hostname, device_type, platform, last_online, status, actions), kebab menu (`more_vert` icon) replacing 5 inline action buttons, mobile bottom sheet overlay for phone kebab menu.
179. [x] **devices.css rewrite**: ~780 lines. 4 responsive breakpoints: ≤1024px (hide device_type), ≤768px (hide platform+last_online, full-width search, icon-only buttons), ≤600px (card-style rows via CSS grid 2-col, hidden thead, fixed bottom sheet kebab with overlay), ≤400px (chip labels hidden, compact filters). Folder chip styles with hover-reveal edit/delete actions. Kebab dropdown with color-coded menu items.
180. [x] **devices.js updates**: `renderDevices()` outputs new HTML template with `.device-status-dot`, `.kebab-wrapper`/`.kebab-btn`/`.kebab-menu`. `renderFolders()` changed from `.folder-item` divs to `.folder-chip` buttons with `.chip-action` edit/delete. `attachRowEventListeners()` handles kebab toggle + menu item actions. Added `initKebabGlobalClose()` + `closeAllKebabMenus()`. Updated all selectors: `.folder-item` → `.folder-chip` in `selectFolder()`, `updateFolderCounts()`, `initFolders()`, `attachFolderDropEvents()`. Double-click guard updated from `.action-btn`/`.drag-handle` to `.kebab-wrapper`.
181. [x] **Deployed & verified**: All 3 files deployed to production server. Console returns 302 (service running). Responsive layout active.

#### Security & Installer Fixes (Phase 31) ✅ COMPLETED 2026-03-20
182. [x] **API TLS breaking clients (Issues #70, #71)**: Fresh install with proper SSL certs added `-tls-api -force-https` → API port 21114 HTTPS-only → RustDesk clients (HTTP only) get 400 → 0 devices. Fix: removed `-tls-api -force-https` from betterdesk.sh + betterdesk.ps1 for ALL cert types. `config.go`: `ForceHTTPS` no longer implies `APITLSEnabled()`. SSL config menu: always removes `-tls-api`/`-force-https`. API URLs always HTTP.
183. [x] **Password `$` escaping in systemd (Issue #68)**: systemd interprets `$` as variable substitution in ExecStart and Environment directives. Admin password and PostgreSQL URL now escaped `$` → `$$` before writing to `.service` files. Auto-generated passwords (alphanumeric) unaffected.
184. [x] **Port CONFLICT false positive**: `ss -tlnp` shows `MainThread` instead of `node` on some Linux systems (Ubuntu 24.04+). Added `MainThread` to expected process patterns for ports 5000 and 21121.

---

## 🔄 System Statusu v3.0

### Nowe Pliki Źródłowe

| Plik | Opis |
|------|------
| `peer_v3.rs` | Ulepszony system statusu z konfigurowalnymi timeoutami |
| `database_v3.rs` | Rozszerzona baza danych z server_config |
| `http_api_v3.rs` | Nowe endpointy API dla konfiguracji |

### Konfiguracja przez Zmienne Środowiskowe

```bash
PEER_TIMEOUT_SECS=15        # Timeout dla offline (domyślnie 15s)
HEARTBEAT_INTERVAL_SECS=3   # Interwał sprawdzania (domyślnie 3s)
HEARTBEAT_WARNING_THRESHOLD=2   # Próg dla DEGRADED
HEARTBEAT_CRITICAL_THRESHOLD=4  # Próg dla CRITICAL
```

### Nowe Statusy Urządzeń

```
ONLINE   → Wszystko OK
DEGRADED → 2-3 pominięte heartbeaty
CRITICAL → 4+ pominięte, wkrótce offline
OFFLINE  → Przekroczony timeout
```

### Dokumentacja

Pełna dokumentacja: [STATUS_TRACKING_v3.md](../docs/STATUS_TRACKING_v3.md)

---

## � Zmiana ID Urządzenia

### Endpoint API

```
POST /api/peers/:old_id/change-id
Content-Type: application/json
X-API-Key: <api-key>

{ "new_id": "NEWID123" }
```

### Pliki Źródłowe

| Plik | Opis |
|------|------|
| `id_change.rs` | Moduł obsługi zmiany ID przez protokół klienta |
| `database_v3.rs` | Funkcje `change_peer_id()`, `get_peer_id_history()` |
| `http_api_v3.rs` | Endpoint POST `/api/peers/:id/change-id` |

### Walidacja

- **Długość ID**: 6-16 znaków
- **Dozwolone znaki**: A-Z, 0-9, `-`, `_`
- **Unikatowość**: Nowe ID nie może być zajęte
- **Rate limiting** (klient): 5 min cooldown

### Dokumentacja

Pełna dokumentacja: [ID_CHANGE_FEATURE.md](../docs/ID_CHANGE_FEATURE.md)

---

## 🌍 System i18n (Wielojęzyczność)

### Pliki Systemu

| Plik | Opis |
|------|------|
| `web/i18n.py` | Moduł Flask z API endpoints (deprecated) |
| `web-nodejs/middleware/i18n.js` | Node.js i18n middleware |
| `web-nodejs/lang/*.json` | Pliki tłumaczeń (Node.js) |
| `web/static/js/i18n.js` | Klient JavaScript |
| `web/static/css/i18n.css` | Style dla selektora języka |
| `web/lang/*.json` | Pliki tłumaczeń (Flask, deprecated) |

### API Endpoints

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/i18n/languages` | GET | Lista dostępnych języków |
| `/api/i18n/translations/{code}` | GET | Pobierz tłumaczenia |
| `/api/i18n/set/{code}` | POST | Ustaw preferencję języka |

### Dodawanie nowego języka

1. Skopiuj `web/lang/en.json` do `web/lang/{kod}.json`
2. Przetłumacz wszystkie wartości
3. Zaktualizuj sekcję `meta` z informacjami o języku

### Dokumentacja

Pełna dokumentacja: [CONTRIBUTING_TRANSLATIONS.md](../docs/CONTRIBUTING_TRANSLATIONS.md)

---

## 🔨 Skrypty Budowania

### Interaktywne skrypty kompilacji

| Skrypt | Platforma | Opis |
|--------|-----------|------|
| `build-betterdesk.sh` | Linux/macOS | Interaktywny build z wyborem wersji/platformy |
| `build-betterdesk.ps1` | Windows | Interaktywny build PowerShell |

### Użycie

```bash
# Linux - tryb interaktywny
./build-betterdesk.sh

# Linux - tryb automatyczny
./build-betterdesk.sh --auto

# Windows - tryb interaktywny
.\build-betterdesk.ps1

# Windows - tryb automatyczny
.\build-betterdesk.ps1 -Auto
```

### GitHub Actions CI/CD

Workflow `.github/workflows/build.yml` automatycznie:
- Buduje binarki dla Linux x64, Linux ARM64, Windows x64
- Uruchamia się przy zmianach w `hbbs-patch-v2/src/**`
- Pozwala na ręczne uruchomienie z wyborem wersji
- Opcjonalnie tworzy GitHub Release

### Dokumentacja

Pełna dokumentacja budowania: [BUILD_GUIDE.md](../docs/BUILD_GUIDE.md)

---

## ⚠️ Znane Problemy

1. ~~**Docker pull error**~~ ✅ ROZWIĄZANE - Obrazy budowane lokalnie z `pull_policy: never`
2. **Axum 0.5 vs 0.6** - Projekt używa axum 0.5, nie 0.6 (różnica w API State vs Extension)
3. **Windows API key path** - Na Windows `.api_key` jest w katalogu roboczym, nie w `/opt/rustdesk/`
4. ~~**Urządzenia offline**~~ ✅ ROZWIĄZANE - Docker obrazy używają teraz binarek BetterDesk
5. ~~**"no such table: peer"**~~ ✅ ROZWIĄZANE - Dockerfile.hbbs kopiuje zmodyfikowane binarki
6. ~~**Go Server: 2FA brute-force**~~ ✅ ROZWIĄZANE - `loginLimiter.Allow(clientIP)` + audit log (H3)
7. ~~**Go Server: Partial 2FA token TTL**~~ ✅ ROZWIĄZANE - `GenerateWithTTL()` 5min (H4)
8. ~~**Go Server: No TLS on signal/relay**~~ ✅ ROZWIĄZANE - `DualModeListener` z auto-detekcją TLS, WSS, flagi `--tls-signal`/`--tls-relay` (Phase 3)
9. ~~**Go Server: ConfigUpdate missing**~~ ✅ ROZWIĄZANE - `TestNatResponse.Cu` populated with relay/rendezvous servers (M8)
10. ~~**Go Server: SQLite only**~~ ✅ ROZWIĄZANE - PostgreSQL backend implemented (`db/postgres.go`, pgx/v5, pgxpool, LISTEN/NOTIFY) — Phase 4
11. ~~**Go Server: E2E encryption "nieszyfrowane"**~~ ✅ ROZWIĄZANE - 4 bugs fixed in signal/handler.go + relay/server.go (SignIdPk format, PunchHoleResponse, RelayResponse removal). Root cause: deployment path mismatch (`/opt/betterdesk-go/` vs `/opt/rustdesk/`) — Phase 6
12. ~~**Go Server: "Failed to secure tcp" when logged in**~~ ✅ ROZWIĄZANE - TCP/WS signal handlers returned nil for online targets, forcing logged-in clients (which use TCP) to wait for target responses that may never arrive. Fixed: immediate PunchHoleResponse/RelayResponse with signed PK matching UDP behavior — Phase 7
13. ~~**QR code invalid on Windows**~~ ✅ ROZWIĄZANE - Inverted QR colors fixed (`dark:'#e6edf3'` → `'#000000'`, `light:'#0d1117'` → `'#ffffff'`) — Phase 8
14. ~~**Users tab redirect for operators**~~ ✅ ROZWIĄZANE - Created `views/errors/403.ejs` (missing template caused crash → redirect) — Phase 8
15. ~~**Client login `_Map<String, dynamic>` error**~~ ✅ ROZWIĄZANE - Added RustDesk-compatible `/api/login` endpoint to Go server `client_api_handlers.go` — Phase 8
16. ~~**GetPeer missing live status**~~ ✅ ROZWIĄZANE - `handleGetPeer` now returns `live_online` + `live_status` from memory map — Phase 8
17. ~~**Hostname/Platform columns empty (Issue #37)**~~ ✅ ROZWIĄZANE - Go server was missing `/api/heartbeat`, `/api/sysinfo`, `/api/sysinfo_ver` endpoints. RustDesk client sends hostname/os/version via HTTP API to signal_port-2 (21114), but Go server had no handlers. Added all 3 endpoints + `UpdatePeerSysinfo` DB method — Phase 9
18. ~~**Users page 401 error (Issue #42)**~~ ✅ ROZWIĄZANE - Route conflict in `rustdesk-api.routes.js`: `/api/users` and `/api/peers` handlers were blocking panel requests (expecting Bearer token). Fixed by adding `next('route')` fallthrough when no Bearer token present, allowing session-based panel requests to reach `users.routes.js` — Phase 10
19. ~~**PostgreSQL→SQLite switch on UPDATE**~~ ✅ ROZWIĄZANE - `betterdesk.sh` and `betterdesk.ps1` were overwriting `.env` with default SQLite config during UPDATE/REPAIR. Added `preserve_database_config()` function to read existing DB config before reinstalling console — Phase 11
20. ~~**Folders not working with PostgreSQL (Issue #48)**~~ ✅ ROZWIĄZANE - `folders.routes.js` and `users.routes.js` used SQLite-specific `result.lastInsertRowid` instead of `result.id`. Fixed for PostgreSQL compatibility — Phase 12
21. ~~**TOTP column missing on upgrade (Issue #38)**~~ ✅ ROZWIĄZANE - Added automatic migration of `totp_secret`, `totp_enabled`, `totp_recovery_codes` columns to existing `users` table for both SQLite and PostgreSQL — Phase 12
22. ~~**SELinux volume mount issues (Issue #31)**~~ ✅ ROZWIĄZANE - Added SELinux documentation to DOCKER_TROUBLESHOOTING.md with 4 solutions (named volumes, `:z` flag, chcon, setenforce) — Phase 12
23. ~~**Docker single-container port 5000 conflict (Issue #56)**~~ ✅ ROZWIĄZANE - Go server `config.LoadEnv()` read generic `PORT=5000` (meant for Node.js console) and set signal port to 5000 instead of 21116, causing EADDRINUSE race condition. Fixed by adding `SIGNAL_PORT` env var with priority over `PORT` in `config.go`, setting `SIGNAL_PORT=21116` in `supervisord.conf` and `entrypoint.sh`, adding `ENV SIGNAL_PORT=21116` to `Dockerfile` — Phase 13
24. ~~**`get_public_ip: command not found` (Issue #58)**~~ ✅ ROZWIĄZANE - Diagnostics function called undefined `get_public_ip` at line 3348. Created reusable `get_public_ip()` function (IPv4-first) in all 3 scripts, replaced all inline curl patterns. Added private IP warning + `RELAY_SERVERS` env var override in `setup_services()`. Go server `GetRelayServers()` now auto-appends relay port when missing — Phase 14
25. ~~**Docker: Devices page 0 while Dashboard shows count (Issue #59)**~~ ✅ ROZWIĄZANE - Docker single-container never created `.api_key` file. Dashboard used public `/api/server/stats` (correct), Devices used protected `/api/peers` (401 → empty). Go server `loadAPIKey()` now auto-generates key on first run, Docker entrypoint also generates as safety net, Node.js `betterdeskApi.js` has 401-interceptor to reload key from file — Phase 16
26. ~~**Relay fails when initial public IP detection fails**~~ ✅ ROZWIĄZANE - `startIPDetectionRetry()` goroutine was defined but never called from `Start()` in `signal/server.go`. If boot-time `detectPublicIP()` failed, no retry ever happened, causing `getRelayServer()` to return LAN IP. Fixed by calling `s.startIPDetectionRetry(s.ctx)` in `Start()` — Phase 17
27. ~~**`/api/audit/conn` returns 400 for numeric device IDs**~~ ✅ ROZWIĄZANE - RustDesk client sends `host_id` as number. Validation rejected non-string. Changed to `String()` coercion — Phase 17
28. ~~**Stale sysinfo log spam every 15 seconds**~~ ✅ ROZWIĄZANE - Added 5-minute per-device throttle for sysinfo log messages in heartbeat handler — Phase 17
29. ~~**Address Book sync fails (Issue #57)**~~ ✅ ROZWIĄZANE - Go server `/api/ab` endpoints were stubs returning empty data. Added `address_books` table + full GET/POST handlers for `/api/ab`, `/api/ab/personal`, `/api/ab/tags` with SQLite + PostgreSQL support — Phase 18
30. ~~**Settings password "password is required" (Issue #60)**~~ ✅ ROZWIĄZANE - `settings.js` sent snake_case fields, `auth.routes.js` expected camelCase. Fixed field names + added missing `confirmPassword` — Phase 18
31. ~~**Password modal plaintext (Issue #60)**~~ ✅ ROZWIĄZANE - `modal.js` prompt checked `options.type` but `users.js` passed `inputType`. Fixed to check both — Phase 18
32. ~~**Empty UUID in relay causes all WAN connections to fail (Issues #58, #63, #64)**~~ ✅ ROZWIĄZANE - `PunchHoleResponse` has no `uuid` field, so when hole-punch fails, client sends `RequestRelay{uuid=""}`. Signal server now generates `uuid.New().String()` when empty in both `handleRequestRelay()` (UDP) and `handleRequestRelayTCP()` (TCP). Relay address validation rejects `host < 2 chars` (prevents `relay=a:21117`) — Phase 19
33. ~~**Docker DNS failures during build (Issue #62)**~~ ✅ ROZWIĄZANE - Added retry logic to all `apk add --no-cache` commands in Dockerfile, Dockerfile.server, Dockerfile.console — Phase 19
34. ~~**Target device sends empty UUID in RelayResponse (Issues #64, #65)**~~ ✅ ROZWIĄZANE - Old RustDesk clients don't echo UUID back in `RelayResponse`. Added `pendingRelayUUIDs sync.Map` to track UUIDs sent to targets in `RequestRelay`/`PunchHole`. When target responds with empty UUID, `handleRelayResponseForward` recovers original UUID from store. Fixes relay pairing failures where initiator and target used mismatched UUIDs — Phase 23
35. ~~**Notes/tags written to wrong database**~~ ✅ ROZWIĄZANE - Node.js panel was writing notes/user/tags directly to local SQLite instead of Go server's database. Now routes through `PATCH /api/peers/{id}` endpoint on Go server — Phase 23
36. ~~**Deleted devices reappear as zombies**~~ ✅ ROZWIĄZANE - Added `IsPeerSoftDeleted()` check in signal handlers. Soft-deleted devices cannot re-register, preventing "zombie" devices from reappearing after admin deletion — Phase 23
37. ~~**Metrics not visible in device detail (Issue #65)**~~ ✅ ROZWIĄZANE - Added `peer_metrics` table to Go server database (SQLite + PostgreSQL), extended `handleClientHeartbeat` to parse and save CPU/memory/disk metrics, added `GET /api/peers/{id}/metrics` endpoint for Node.js console to fetch metrics from Go server — Phase 24

---

## 📝 Wytyczne dla Copilota

### Przy kompilacji:
1. Zawsze używaj `git submodule update --init --recursive` po sklonowaniu rustdesk-server
2. Sprawdź wersję axum w Cargo.toml przed modyfikacją http_api.rs
3. Po kompilacji zaktualizuj CHECKSUMS.md

### Przy modyfikacjach kodu:
1. Kod API jest w `hbbs-patch-v2/src/http_api.rs`
2. Kod main jest w `hbbs-patch-v2/src/main.rs`
3. Używaj `hbb_common::log::info!()` zamiast `println!()`
4. Testuj na SSH (Linux) i lokalnie (Windows)
5. W plikach projektu używaj angielskiego, dokumentacja także ma być po angielsku, upewnij się za każdym razem że twoje zmiany są zgodne z aktualnym stylem i konwencjami projektu, nie wprowadzaj nowych konwencji bez uzasadnienia oraz są napisane w sposób spójny z resztą kodu, unikaj mieszania stylów kodowania, jeśli masz wątpliwości co do stylu, sprawdź istniejący kod i dostosuj się do niego, pamiętaj że spójność jest kluczowa dla utrzymania czytelności i jakości kodu. Wykorzystuj tylko język angielski w komunikacji, dokumentacji i komentarzach, nawet jeśli pracujesz nad polskojęzyczną funkcją, zachowaj angielski dla wszystkich aspektów kodu i dokumentacji, to ułatwi współpracę z innymi deweloperami i utrzyma spójność projektu.
6. Tworząc nowe moduły i zakładki pamiętaj o zachowaniu spójności z istniejącym stylem kodowania, strukturą projektu i konwencjami nazewnictwa, sprawdź istniejące moduły i zakładki, aby upewnić się że twoje zmiany są zgodne z aktualnym stylem, unikaj wprowadzania nowych konwencji bez uzasadnienia, jeśli masz wątpliwości co do stylu, dostosuj się do istniejącego kodu, pamiętaj że spójność jest kluczowa dla utrzymania czytelności i jakości kodu.
7. Przy dodawaniu nowych elementów do panelu web czy innych części projektu upewnij się że są one zgodne z systemem i18n, dodaj odpowiednie klucze do plików tłumaczeń i przetestuj działanie w obu językach, pamiętaj że wszystkie teksty powinny być tłumaczalne i nie powinno się używać hardcoded stringów w kodzie, to ułatwi utrzymanie wielojęzyczności projektu i zapewni spójność w komunikacji z użytkownikami (nie stosuj tych praktyk w przypadku elementów które nie będą bezpośrednio dostępne w interfejsie i które są zwyczajnymi funkcjami w kodzie).
8. Przy wprowadzaniu zmian projekcie upewnij się że będą one możliwe do instalacji przez obecne skrypty ALL-IN-ONE, jeśli wprowadzasz nowe funkcje lub zmieniasz istniejące, zaktualizuj skrypty instalacyjne, aby uwzględniały te zmiany, przetestuj instalację na czystym systemie, aby upewnić się że wszystko działa poprawnie, pamiętaj że skrypty ALL-IN-ONE są kluczowym elementem projektu i muszą być aktualizowane wraz z rozwojem funkcji, to zapewni użytkownikom łatwą i bezproblemową instalację najnowszych wersji projektu. Skrypty ALL-IN-ONE powinny być aktualizowane i testowane przy każdej większej zmianie, aby zapewnić kompatybilność i łatwość instalacji dla użytkowników, pamiętaj że skrypty te są często używane przez osoby bez zaawansowaną wiedzą techniczną, więc ważne jest aby były one jak najbardziej niezawodne i łatwe w użyciu, zawsze testuj skrypty po wprowadzeniu zmian, aby upewnić się że działają poprawnie i nie powodują problemów z instalacją.

9. Postaraj się rozwiązywać problemy z warningami porzy kompilacji, stosować najnowsze wersje bibliotek i narzędzi, utrzymywać kod w czystości i zgodności z aktualnymi standardami, to ułatwi utrzymanie projektu i zapewni jego długoterminową stabilność, pamiętaj że regularne aktualizacje i dbanie o jakość kodu są kluczowe dla sukcesu projektu, unikaj pozostawiania warningów bez rozwiązania, jeśli pojawią się warningi podczas kompilacji, postaraj się je rozwiązać jak najszybciej, to pomoże utrzymać kod w dobrej kondycji i zapobiegnie potencjalnym problemom w przyszłości.
10. Przy wprowadzaniu zmian w API, upewnij się że są one kompatybilne wstecz, jeśli wprowadzasz zmiany które mogą wpłynąć na istniejące funkcje lub integracje, postaraj się zachować kompatybilność wsteczną, jeśli to nie jest możliwe, odpowiednio zaktualizuj dokumentację i poinformuj użytkowników o zmianach, pamiętaj że stabilność API jest ważna dla użytkowników i deweloperów korzystających z projektu, staraj się unikać wprowadzania breaking changes bez uzasadnienia i odpowiedniej komunikacji, to pomoże utrzymać zaufanie i satysfakcję użytkowników oraz deweloperów współpracujących nad projektem.
11. Przy wprowadzaniu zmian w systemie statusu, upewnij się że są one dobrze przemyślane i przetestowane, jeśli wprowadzasz nowe statusy lub zmieniasz istniejące, postaraj się zachować spójność z aktualnym systemem i zapewnić jasne kryteria dla każdego statusu, przetestuj działanie nowych statusów w różnych scenariuszach, to pomoże zapewnić że system statusu jest wiarygodny i użyteczny dla użytkowników, pamiętaj że system statusu jest kluczowym elementem projektu i musi być utrzymywany w dobrej kondycji, staraj się unikać wprowadzania zmian które mogą wprowadzić niejasności lub problemy z interpretacją statusów, to pomoże utrzymać zaufanie użytkowników do systemu i zapewni jego skuteczność.
12. Stosuj wszystkie najlepsze praktyki bezpieczeństwa przy wprowadzaniu nowych funkcji, szczególnie tych związanych z autoryzacją, uwierzytelnianiem i komunikacją sieciową, jeśli wprowadzasz nowe funkcje które mogą mieć wpływ na bezpieczeństwo, upewnij się że są one dobrze zabezpieczone i przetestowane pod kątem potencjalnych luk, pamiętaj że bezpieczeństwo jest kluczowe dla projektu i jego użytkowników, staraj się unikać wprowadzania funkcji które mogą wprowadzić ryzyko bezpieczeństwa bez odpowiednich środków zaradczych, to pomoże utrzymać zaufanie użytkowników i zapewni długoterminowy sukces projektu.
13. Przy problemach z Dockerem, zawsze sprawdzaj czy obrazy są budowane lokalnie, unikaj używania `docker compose pull` dla obrazów betterdesk-*, jeśli napotkasz problemy z Dockerem, sprawdź DOCKER_TROUBLESHOOTING.md, to pomoże szybko zidentyfikować i rozwiązać problemy związane z Dockerem, pamiętaj że Docker jest ważnym elementem projektu i musi być utrzymywany w dobrej kondycji, staraj się unikać wprowadzania zmian które mogą wpłynąć na działanie Docker, to pomoże zapewnić stabilność i niezawodność projektu dla użytkowników korzystających z tej platformy.
14. Jeżeli napotkasz błędy kompilacji związane z innymi komponentami bądź niezgodności z bibliotekami, zawsze sprawdzaj aktualne wersje używanych bibliotek i narzędzi, upewnij się że są one kompatybilne z kodem projektu, jeśli napotkasz błędy kompilacji, postaraj się je rozwiązać jak najszybciej, to pomoże utrzymać kod w dobrej kondycji i zapobiegnie potencjalnym problemom w przyszłości, pamiętaj że regularne aktualizacje i dbanie o jakość kodu są kluczowe dla sukcesu projektu, staraj się unikać pozostawiania błędów kompilacji bez rozwiązania, to pomoże utrzymać stabilność i niezawodność projektu dla wszystkich użytkowników i deweloperów współpracujących nad projektem.
15. Wprowadzając funkcje powiązane z większą liczbą elementów, modułów czy funkcji staraj się je dobrze zorganizować i przemyśleć, jeśli wprowadzasz funkcje które mają wpływ na wiele części projektu, postaraj się je dobrze zorganizować i przemyśleć, to pomoże zapewnić że są one łatwe do zrozumienia i utrzymania, pamiętaj że spójność i organizacja kodu są kluczowe dla jego czytelności i jakości, staraj się unikać wprowadzania funkcji które są niejasne lub trudne do zrozumienia, to pomoże utrzymać projekt w dobrej kondycji i zapewni jego długoterminowy sukces. Przykładowo dodając nowe funkcje do klienta desktop które mają być powiązane z panelem web, upewnij się że po zakończeniu tworzenia nowego kodu wprowadzisz także zmiany w innych elementach aby funkcje były bardziej kompletne.
16. Po utworzeniu nowych funkcji postaraj zanotować sobie procedury powiązane z ich wdrażaniem i testowaniem, to pomoże ci w przyszłości szybko przypomnieć sobie jak działają i jak je utrzymywać, pamiętaj że dokumentacja jest kluczowa dla utrzymania projektu i jego zrozumienia przez innych deweloperów, staraj się unikać pozostawiania nowych funkcji bez odpowiedniej dokumentacji, to pomoże zapewnić że są one łatwe do zrozumienia i utrzymania dla wszystkich współpracujących nad projektem. Wżnym elementem całego projektu jest nie tylko dokumentacja ale także skrypty instalacyjne pozwalające szybko i łatwo zainstalować najnowsze wersje projektu, dlatego po wprowadzeniu nowych funkcji upewnij się że są one uwzględnione w skryptach ALL-IN-ONE, to pomoże zapewnić że użytkownicy mogą łatwo korzystać z nowych funkcji bez konieczności ręcznej konfiguracji czy rozwiązywania problemów z instalacją. Pamietaj że klienci często nie są technicznie obeznani i mogą mieć trudności z ręczną instalacją, dlatego ważne jest aby skrypty instalacyjne były aktualizowane i testowane przy każdej większej zmianie, to zapewni łatwą i bezproblemową instalację najnowszych wersji projektu dla wszystkich użytkowników, niezależnie od ich poziomu zaawansowania technicznego.

17. Stosuj tylko sprawdzone rozwiązania, moduły czy biblioteki do implementacji nowych funkcji, unikaj eksperymentalnych lub nieprzetestowanych rozwiązań, jeśli wprowadzasz nowe funkcje, postaraj się używać sprawdzonych i stabilnych rozwiązań, to pomoże zapewnić że są one niezawodne i bezpieczne dla użytkowników, pamiętaj że stabilność i bezpieczeństwo są kluczowe dla projektu i jego użytkowników, staraj się unikać wprowadzania funkcji które mogą wprowadzić ryzyko lub problemy bez odpowiednich środków zaradczych, to pomoże utrzymać zaufanie użytkowników i zapewni długoterminowy sukces projektu. Na bierząco aktualizuj biblioteki i narzędzia używane w projekcie, to pomoże zapewnić że korzystasz z najnowszych funkcji i poprawek bezpieczeństwa, jeśli napotkasz problemy z kompatybilnością lub błędy związane z bibliotekami, postaraj się je rozwiązać jak najszybciej, to pomoże utrzymać projekt w dobrej kondycji i zapobiegnie potencjalnym problemom w przyszłości, pamiętaj że regularne aktualizacje i dbanie o jakość kodu są kluczowe dla sukcesu projektu, staraj się unikać pozostawiania problemów związanych z bibliotekami bez rozwiązania, to pomoże utrzymać stabilność i niezawodność projektu dla wszystkich użytkowników i deweloperów współpracujących nad projektem.

18. Bewzględnie eliminuj wszystkie błędy bezpieczeństwa, przestrzałe biblioteki oraz inne problemy z bezpieczeństwem, jeśli napotkasz błędy bezpieczeństwa lub przestarzałe biblioteki, postaraj się je rozwiązać jak najszybciej, to pomoże utrzymać projekt bezpieczny dla użytkowników, pamiętaj że bezpieczeństwo jest kluczowe dla projektu i jego użytkowników, staraj się unikać pozostawiania problemów związanych z bezpieczeństwem bez rozwiązania, to pomoże utrzymać zaufanie użytkowników i zapewni długoterminowy sukces projektu. Regularnie przeprowadzaj audyty bezpieczeństwa i aktualizuj zależności, to pomoże zapewnić że projekt jest odporny na nowe zagrożenia i ataki, jeśli napotkasz problemy związane z bezpieczeństwem, postaraj się je rozwiązać jak najszybciej, to pomoże utrzymać projekt w dobrej kondycji i zapobiegnie potencjalnym problemom w przyszłości, pamiętaj że regularne audyty i dbanie o bezpieczeństwo są kluczowe dla sukcesu projektu, staraj się unikać pozostawiania problemów związanych z bezpieczeństwem bez rozwiązania, to pomoże utrzymać stabilność i niezawodność projektu dla wszystkich użytkowników i deweloperów współpracujących nad projektem.

### Dotyczy panelu web i jego zakładek, funkcji itp.

1. Zawsze zachowuj spójność z aktualnym stylem kodowania i konwencjami projektu.
2. Używaj angielskiego dla wszystkich tekstów, komunikacji i dokumentacji ale twórz także inne wersje językowe zgodne z obecnym systemem i18n.
3. Upewnij się że wszystkie teksty są tłumaczalne i nie używaj hardcoded stringów w kodzie.
4. Testuj działanie nowych funkcji w obu językach (EN/PL) i upewnij się że są one zgodne z systemem i18n.
5. Przy dodawaniu nowych elementów do panelu web, upewnij się że są one dobrze zorganizowane i przemyślane, to pomoże zapewnić że są one łatwe do zrozumienia i utrzymania.
6. Zachowaj spójność wyglądu i stylu, stosuj optymalizację oraz najlepsze praktyki dla interfejsu użytkownika, to pomoże zapewnić że panel web jest przyjazny dla użytkowników i łatwy w obsłudze.
7. Przy wprowadzaniu zmian w panelu web, upewnij się że są one dobrze przemyślane i przetestowane, staraj się unikać wprowadzania zmian które mogą wprowadzić niejasności lub problemy z użytecznością, to pomoże utrzymać zaufanie użytkowników do panelu web i zapewni jego skuteczność jako narzędzia do zarządzania serwerem BetterDesk dla wszystkich użytkowników, niezależnie od ich poziomu zaawansowania technicznego.
8. Upewnij się że wszystkie elementy pokazujące statystyki urządzeń oraz ich parametry są zgodne ze sobą, korzystają z tych samych źródeł danych i są aktualizowane w czasie rzeczywistym, to pomoże zapewnić że użytkownicy mają dostęp do dokładnych i spójnych informacji o swoich urządzeniach, co jest kluczowe dla skutecznego zarządzania i monitorowania serwera BetterDesk. Nie doprowadź do sytuacji w której różne części panelu web pokazują różne informacje o statusie urządzeń, to może wprowadzić użytkowników w błąd i obniżyć zaufanie do panelu web jako narzędzia do zarządzania serwerem BetterDesk.
9. Stosuj praktyki bezpieczeństwa.
10. Pamiętaj aby panel web operatora zawierał odpowiednią zakładkę logowania operaji operatorów przypisanych do ich kont, domyślnie ma być on używany jednocześnie przez większą ilość operatorów i panel web wraz z jego funkcjami ma być dopasowany do tego stylu zarządzania.

### Przy problemach Docker:
1. Sprawdź czy obrazy są budowane lokalne (`docker compose build`)
2. Nie używaj `docker compose pull` dla obrazów betterdesk-*
3. Sprawdź DOCKER_TROUBLESHOOTING.md

---

## 🤖 AI Roles & Security Policy

### Copilot Roles in This Project

| Role | Scope | Description |
|------|-------|-------------|
| **Security Auditor** | All code changes | Every modification undergoes automatic security review. Identifies vulnerabilities, insecure patterns, and outdated dependencies. |
| **Go Backend Developer** | `betterdesk-server/` | Clean-room RustDesk-compatible server implementation. Protocol handling, crypto, database, API. |
| **Node.js Backend Developer** | `web-nodejs/` | Express.js web console — authentication, CRUD, RustDesk Client API, WebSocket. |
| **DevOps Engineer** | Scripts, Docker, CI/CD | ALL-IN-ONE installers (`betterdesk.sh`, `betterdesk.ps1`), Dockerfiles, GitHub Actions. |
| **Frontend Developer** | `web-nodejs/views/`, `static/` | EJS templates, CSS, client-side JavaScript, i18n. |
| **Documentation Maintainer** | `docs/`, `.github/` | Keep all documentation current with code changes. |

### Security-First Policy (DEFAULT BEHAVIOR)

All code changes MUST include a security review as part of the implementation process. This is not optional.

**Mandatory checks for every change:**
1. **Input validation** — All user-supplied data (URL params, body, headers, query strings) must be validated with strict patterns (regexps, type checks, length limits).
2. **Rate limiting** — All public-facing endpoints and connection accept loops must have IP-based rate limiting.
3. **SQL injection prevention** — All database queries must use parameterized queries. LIKE patterns must escape `%` and `_`.
4. **Authentication & authorization** — Every non-public endpoint must verify credentials and enforce RBAC.
5. **Token security** — Short-lived tokens for transient states (2FA partial tokens: 5min max). No long-lived tokens for intermediate auth states.
6. **Dependency audit** — Flag outdated or vulnerable dependencies. Update proactively.
7. **Error handling** — Never expose internal error details to clients. Log internally, return generic messages.
8. **Audit logging** — Security-relevant operations (login, failed auth, config changes, bans) must be logged.

---

## 📞 Kontakt

- **Repozytorium:** https://github.com/UNITRONIX/Rustdesk-FreeConsole
- **Issues:** GitHub Issues

---

*Ostatnia aktualizacja: 2026-03-20 (Security & Installer Fixes — Phase 31) przez GitHub Copilot*
