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

---

## 🔄 System Statusu v3.0

### Nowe Pliki Źródłowe

| Plik | Opis |
|------|------|
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

*Ostatnia aktualizacja: 2026-03-15 (IP detection & relay fix — Phase 14) przez GitHub Copilot*
