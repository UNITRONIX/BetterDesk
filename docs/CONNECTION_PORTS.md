# BetterDesk connection ports — operator cheat sheet

**This is the single source of truth for ports.** Every other document, installer note and
firewall snippet must agree with the table below; `scripts/check-port-docs.js` fails CI when
they drift apart.

Applies to: host + short-code pairing, desktop clients, Web Remote, and the console panel.

---

## 1. Port table

| Port | Proto | Process | Exposure | Purpose | If it is closed |
|------|-------|---------|----------|---------|-----------------|
| **21116** | TCP + UDP | `betterdesk-server` | **WAN** | Signal: registration, hole punching | Clients cannot register or connect. **Not proxiable over HTTP** — UDP cannot be reverse-proxied. |
| **21117** | TCP | `betterdesk-server` | **WAN** | Relay data when a direct path fails | Connections fail behind NAT/symmetric firewalls. |
| **21114** | TCP | `betterdesk-server` | **WAN via TLS**, prefer `443` | Go Client API: `/api/branding`, `/api/pairing/*`, `/api/devices/register`, login, address book | Pairing, branding, enrollment and login fail while remote sessions may still work — the most confusing failure mode. |
| **443** | TCP | Caddy/Nginx (or BetterDesk native TLS) | **WAN** | TLS termination for the panel and Client API | Recommended entry point for everything HTTP. |
| **21121** | TCP | Node proxy to Go | **WAN only for legacy fleets** | Compatibility path for clients configured with `:21121` | New deployments do not need it. |
| **21118** | TCP | `betterdesk-server` | via proxy `/ws/id` | WSS signal (WebSocket Mode) | WebSocket Mode clients cannot connect; native TCP/UDP still works. |
| **21119** | TCP | `betterdesk-server` | via proxy `/ws/relay` | WSS relay | WebSocket Mode relay fails; direct connections still work. |
| **5000** | TCP | `betterdesk-console` | **localhost only** | Panel UI (HTTP) | Nothing, as long as a reverse proxy reaches it on `127.0.0.1`. **Never expose to WAN.** |
| **5443** | TCP | `betterdesk-console` | localhost / LAN | Panel UI (native HTTPS) | Only used without an external proxy. |
| **21115** | TCP | `betterdesk-server` | optional WAN | NAT type test | Clients fall back to a slower connection strategy. |
| **21122** | TCP | `betterdesk-server` | optional | CDAP gateway (WebSocket) | CDAP agents and tooling cannot connect. |

> **Port 21120 does not exist.** Any document mentioning it is stale; see
> `docs/architecture/PORT_SECURITY.md`, which is kept only as a historical record.

---

## 2. Deployment profiles

Pick one profile and apply exactly its commands. **Profile B is the recommendation** for a
server reachable from the internet, and the only one that supports pairing over HTTPS with
the smallest attack surface.

### Profile A — minimal, no reverse proxy

Small LAN/WAN install where the Client API is reachable over plain HTTP on `21114`.

```bash
# Debian/Ubuntu (ufw)
sudo ufw allow 21116/tcp
sudo ufw allow 21116/udp
sudo ufw allow 21117/tcp
sudo ufw allow 21114/tcp
# Panel stays on localhost; reach it over SSH tunnel.
```

```powershell
# Windows (elevated PowerShell)
foreach ($p in 21114,21116,21117) {
  New-NetFirewallRule -DisplayName "BetterDesk $p TCP" -Direction Inbound `
    -LocalPort $p -Protocol TCP -Action Allow
}
New-NetFirewallRule -DisplayName "BetterDesk 21116 UDP" -Direction Inbound `
  -LocalPort 21116 -Protocol UDP -Action Allow
```

Trade-off: the Client API (including pairing) is plaintext on `21114`. Use this only inside
a trusted network or VPN.

### Profile B — recommended: reverse proxy + TLS

One public port (`443`), Client API on the same hostname under `/api`, panel never exposed.

```bash
sudo ufw allow 443/tcp
sudo ufw allow 21116/tcp
sudo ufw allow 21116/udp
sudo ufw allow 21117/tcp
# 21114 must NOT be reachable from WAN: the proxy talks to it over loopback.
sudo ufw deny 21114/tcp
```

Proxy upstream: `http://127.0.0.1:5000` for the panel and `http://127.0.0.1:21114` for the
Client API path allowlist. Full Caddy/Nginx examples: `docs/setup/REVERSE_PROXY.md`.

Client settings for this profile: **only the host name**, e.g. `desk.example.com`. The
client probes `https://host` first, so no port has to be typed.

### Profile C — hardened WSS-only

Desktop clients use WebSocket Mode; TCP signal/relay stay closed to WAN.

```bash
sudo ufw allow 443/tcp
# No 21116/21117 from WAN.
```

Proxy: `/ws/id` to `:21118`, `/ws/relay` to `:21119` (only when Web Remote is not on the same
hostname — see the collision note in `docs/setup/REVERSE_PROXY.md`). Client must have
`allow-websocket=Y` and an `https://` host so it builds `wss://`.

Trade-off: one path for everything, but an operator mistake in the proxy config closes all
connectivity; profile B degrades more gracefully.

### Profile D — Docker / AIO

Ports are published by Compose, not the host firewall.

| Host port | Container | Notes |
|-----------|-----------|-------|
| `21116/tcp+udp`, `21117/tcp` | `betterdesk-server` | Required. |
| `21121` | Go (single-image) **or** Node proxy (split) | In AIO, `:21121` is Go itself. In split, it proxies to Go `:21114`. |
| `443` | proxy container | Terminates TLS. |
| `5000` | panel | Bind to `127.0.0.1:` in the Compose port mapping so it never reaches WAN. |

---

## 3. Client field to port map

| Client field | Value | Port it uses |
|--------------|-------|--------------|
| `ID Server` (`custom-rendezvous-server`) | `desk.example.com` | 21116 |
| `Relay Server` | `desk.example.com` | 21117 |
| `API Server` | empty (recommended) | auto: `https://host` -> 443, then `:21114`, then `:5443` |
| `API Server` (explicit) | `https://desk.example.com` | exactly that URL, no probing |
| Use WebSocket | on | 21118 / 21119 (or 443 through the proxy) |
| **Pairing: server address** | `desk.example.com` | the client finds the API itself |

With pairing, the operator types **only the host and a code**. Everything in this table is
filled in from the server response; nothing has to be looked up in a firewall.

---

## 4. What pairing actually needs

| Requirement | Why |
|-------------|-----|
| `443` with a valid certificate (or `21114` over TLS) | The code is a bearer credential for one configuration; sending it over plaintext leaks it to anyone on the path. |
| `21116/tcp+udp` and `21117/tcp` open | Pairing only configures the client. Without signal and relay the pairing *succeeds* and the session then fails — the hardest case to diagnose. |
| Server clock roughly correct | Codes expire after 10 minutes; a badly skewed clock makes an otherwise valid code look expired. |
| `PUBLIC_SERVER_ID` (or `RENDEZVOUS_SERVERS`) set when behind a proxy | Otherwise the server reports the internal hostname it sees in the request. |

Pairing does **not** grant access: it returns the same data a manual setup would, and the
device still goes through enrollment (bans, pending approval, key proof all apply).

---

## 5. Common mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `:5000` reachable from the internet | Panel bound to `0.0.0.0` | `HOST=127.0.0.1`, put a proxy in front (profile B). |
| Login works, connecting fails with `initiator_token_rejected` | `API Server` points at the panel, or the proxy splits `/api/login` from `/api/ws/` | Point the client at `443`/`21114`, keep all `/api` on Go. |
| Web Remote socket closes immediately with code 1000 | `/ws/rendezvous` routed to Go `:21118` | `/ws/rendezvous` belongs to the panel `:5000`. |
| `ws://` fails with HTTP 308 | Proxy forces HTTPS | Use WebSocket Mode with an `https://` host so the client builds `wss://`. |
| Clients time out with no error | 21116 UDP blocked | Open UDP 21116; TCP alone is not enough for hole punching. |
| Pairing says "server unreachable" but the panel works | API not exposed on 443/21114, or blocked to WAN | Profile B: proxy `/api` to `:21114`, or open `21114` over TLS. |
| `initiator_not_registered` behind a proxy | `TRUST_PROXY` off | `TRUST_PROXY=Y` plus `TRUSTED_PROXIES=<proxy CIDR>`. |
| UDP 21116 "open" but no connections | Cloudflare orange-cloud | Cloudflare cannot proxy UDP; use DNS-only for the ID hostname. |

---

## 6. TLS notes

- **Required** for the Client API when it is reachable from the internet. Pairing codes and
  device tokens travel over it.
- **Self-signed** is accepted only when the operator sets `allow-insecure-tls-fallback=Y`
  (Settings -> Network). The client then shows an orange warning stating the connection is
  not encrypted. This is a deliberate, visible downgrade, never silent.
- Verify a certificate before blaming the client:

```bash
openssl s_client -connect desk.example.com:443 -servername desk.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject -issuer
```

---

## 7. Verification

```bash
# 1. Which profile is actually running (exits non-zero on mismatch)
sudo bash scripts/check-connection-ports.sh b

# 2. The panel must be loopback-only in profile B
ss -tlnp | grep -E ':(5000|5443)\b'   # expect 127.0.0.1:

# 3. Signal and relay must be reachable from outside
nc -vz desk.example.com 21116
nc -vzu desk.example.com 21116
nc -vz desk.example.com 21117

# 4. The Client API must answer over TLS
curl -sf https://desk.example.com/api/health
curl -sf https://desk.example.com/api/branding | head -c 200

# 5. Pairing endpoint reachable (401 for a bad code is the expected answer)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://desk.example.com/api/pairing/redeem \
  -H 'Content-Type: application/json' -d '{"code":"ABC234","device_id":"1"}'
```

Windows equivalent of steps 1-2: `powershell -File scripts/check-connection-ports.ps1 -Profile b`.

---

## 8. Keeping this document true

`scripts/check-port-docs.js` parses the port constants from
`betterdesk-server/config/constants.go` and `web-nodejs/config/config.js`, compares them with
the table above, and also fails when a document reintroduces `21120` as a live port. It runs
in CI, so a port change cannot ship with a stale cheat sheet.

Related reading: `docs/setup/REVERSE_PROXY.md` (proxy examples),
`docs/important/betterdesk-api-port-consolidation.md` (why `21114` and `21121` coexist),
`docs/features/CLIENT_BRANDING.md` (`/api/branding` payload).
