# Complete compatibility audit — RustDesk client 1.5.3 ↔ BetterDesk

**Date:** 2026-11-17  
**Scope:** Stock RustDesk desktop/mobile clients **1.5.1 → 1.5.3** against BetterDesk clean-room Go server + Node panel (not AGPL `rustdesk-server` binaries).  
**Upstream client:** [rustdesk/rustdesk 1.5.3](https://github.com/rustdesk/rustdesk/releases/tag/1.5.3) (published 2026-11-09)  
**Upstream OSS server:** [rustdesk/rustdesk-server 1.1.16](https://github.com/rustdesk/rustdesk-server/releases/tag/1.1.16) (no newer OSS server for this client bump)  
**Proto reference:** [rustdesk/hbb_common `protos/rendezvous.proto`](https://github.com/rustdesk/hbb_common/blob/master/protos/rendezvous.proto) (fetched 2026-11-17; tracks current client wire)  
**Method:** Code review of BetterDesk signal/relay/API/panel + upstream release notes / PRs `#16696`, `#16858`, `#16548`, `#16784`, ConfigUpdate removal `9f9585c`. **No live stock GUI binaries in this pass** (lab remaining — see §8).

**Overall verdict: Partial / production-viable with conditions**

| Condition | Required |
|-----------|----------|
| Bootstrap | Every peer gets ID / relay (`host:port`) / API / key via deploy string, Network UI, Import, or Support `custom.txt` — **not** heartbeat policy or TestNat `ConfigUpdate` |
| Relay path | Prefer normal PunchHole → PunchHoleSent → RequestRelay (peer-offered relay stored verbatim). Treat **force-relay / AlwaysUseRelay / hairpin / org block_direct_p2p** as elevated risk until `sendRelayResponse` uses `relayAdvertisedToTarget` |
| Windows | Upgrade GUI + service together (IPC hardening) |

---

## 1. Executive risk matrix

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| R1 | `sendRelayResponse` forwards server-computed `RelayServer` to target **without** `relayAdvertisedToTarget` | **Fixed in code; lab pending** | Fixed on `dev`; verify with live 1.5.3 AlwaysUseRelay — [#504](https://github.com/UNITRONIX/BetterDesk/issues/504) |
| R2 | 1.5.3 controlled peers drop `RequestRelay` if relay ∉ remembered offers and ≠ local default (`check_relay_request` / `#16858`) | **Critical** (client behaviour; interacts with R1) | Documented |
| R3 | Heartbeat / strategy cannot change endpoint keys (`api-server`, rendezvous, relay, `key`, …) — `#16696` | **High** if operators relied on policy re-home; **OK** for BetterDesk defaults | Mitigated by design + tests |
| R4 | Clients ignore `ConfigUpdate` (TestNat `cu`) since ~1.5.1 | **Medium** (ops footgun) | Docs; emission still present |
| R5 | Proto drift vs current `hbb_common` (`NOT_DEPLOYED`, `RequestRelay.controlled_context`/`switch_code`, `ControlPermissions.privacy_mode`/`usb`, `IdPk` WebRTC fields) | **Reduced; runtime attribution pending** | Additive fields synced and regenerated; emission/storage of audit context remains follow-up — [#505](https://github.com/UNITRONIX/BetterDesk/issues/505) |
| R6 | `LOGGED_IN_ONLY_INITIATOR` / enrollment pending look like “grounded” peers | **High** if misconfigured; **Info** by design | Operator settings |
| R7 | Deploy / QR always emit relay `host:port` | **OK** | Covered by tests |
| R8 | Strategy UI + Go allowlist exclude locked keys; raw API can store junk JSON but heartbeat filters | **Low** | Optional harden on save |
| R9 | Trusted Devices V2 / connection approval | **Info** | Peer-local / client-only |
| R10 | OSS `rustdesk-server` 1.1.16 | **OK / no action** | Parity watch only |

---

## 2. Wire / protobuf parity

Canonical BetterDesk: [`betterdesk-server/protos/rendezvous.proto`](../../betterdesk-server/protos/rendezvous.proto), [`message.proto`](../../betterdesk-server/protos/message.proto).

Compared to current `hbb_common` `rendezvous.proto`:

| Item | Upstream | BetterDesk | Impact |
|------|----------|------------|--------|
| Envelope field numbers 6–29 | Same | Same | OK |
| `ConfigUpdate` / `TestNat*` | Present | Present | Clients ignore apply path |
| `PunchHole.controlled_context` | Field 9 | Present | BetterDesk does **not emit** `conn_audit_ref` |
| `RequestRelay.controlled_context` | Field **10** | **Missing** | Controllers cannot attach audit ref on relay path |
| `RequestRelay.switch_code` | Field **11** | **Missing** | Switch-code pairing on relay path incomplete |
| `FetchLocalAddr.controlled_context` | Field **5** | **Missing** | Same attribution gap on LAN path |
| `RegisterPkResponse.NOT_DEPLOYED` | Enum **8** | **Missing** (stops at `SERVER_ERROR=7`) | Enrollment denials map to `NOT_SUPPORT` |
| `ControlPermissions` bits | Includes `privacy_mode=12`, `usb=13` | Stops at `remote_modify=11` | Extra bits ignored if set by peers; BetterDesk cannot request them |
| `IdPk` (in `message.proto`) | Upstream adds `dtls_fingerprint`, `kx_version` | Only `id` + `pk` | WebRTC identity bind incomplete vs newest clients |
| `HttpProxy*` | Present | Present; BetterDesk **rejects** with error | Correct (no SSRF) |
| `IceCandidate` | Field 29 | Present + forwarded | OK |

**Conclusion:** Core rendezvous/relay handshake remains interoperable. Gaps are additive fields and permission bits — not a full wire break — but R5 should be closed for 1.5.x completeness.

---

## 3. Relay path deep dive (root cause class for “grounded” devices)

### 3.1 What RustDesk 1.5.3 does

From `src/rendezvous_mediator.rs` (tag 1.5.3):

- `remember_reported_relay` normalises via `check_port(..., RELAY_PORT)` and keeps up to 32 entries for 600s.
- `check_relay_request` rejects unless:
  - UUID passes charset rules (1–128, `[A-Za-z0-9_-]`), **and**
  - `is_reported_relay(rr.relay_server)` **or** normalised request equals peer’s own `get_relay_server("")`.
- Refusal is silent to the controller → **relay timeout**.

### 3.2 What BetterDesk does well

| Mechanism | Location | Behaviour |
|-----------|----------|-----------|
| Verbatim store of peer relay | `handlePunchHoleSent` → `peer.Entry.RelayServer` | Does **not** sanitize before store |
| Target-bound RequestRelay | `relayAdvertisedToTarget` | Prefers stored peer value; else bare host so `check_port` matches |
| Tests | `signal/relay_identity_test.go` | Documents rewrite → peer drop |

### 3.3 What breaks under 1.5.3

```text
ForceRelay / AlwaysUseRelay / hairpin / org block_direct_p2p
        │
        ▼
 sendRelayResponse(target, …, relayServer, …)
        │
        ├─► RelayResponse to initiator  (server relay OK)
        └─► RequestRelay to target with RelayServer = server relay
              ❌ NOT relayAdvertisedToTarget(target, relay)
```

If target never stored a PunchHoleSent relay (TCP force-relay can skip punch), or server relay string ≠ peer-configured / remembered offer → **R1/R2**.

Other notes:

- Initiator-facing `PunchHoleResponse.relay_server` after PunchHoleSent is **sanitized + selectPeerRelayServer** (may differ from stored peer value) — usually OK for initiator dial; target validation uses forwarded RequestRelay.
- UDP `RequestRelay` applies `applyNetworkRelayPolicy` before advertise; TCP path does not — asymmetry.
- `sanitizeClientRelayAddress` only on PunchHoleSent / RequestRelay initiator legs (3 call sites).

### 3.4 UUID

`uuid.New().String()` is compatible with 1.5.3 charset validation. Empty client UUID → server generates. Low risk.

---

## 4. Client HTTP API / strategy / branding

| Surface | Verdict | Detail |
|---------|---------|--------|
| Login / AB / groups / peers / heartbeat / sysinfo | **OK** | Go Client API when panel proxies to Go |
| Strategy allowlist | **OK** | 8 feature toggles only; test excludes locked 1.5.3 keys |
| Strategies UI | **OK** | Same 8 keys in `web-nodejs/public/js/strategies.js` |
| Strategy POST storage | **Low gap** | Panel/Go can persist arbitrary JSON; heartbeat filters |
| Branding → RustDesk options | **OK** | `display-name` only |
| Support Agent | **OK** | Strategy withheld; connection via signed `custom.txt` |
| Audit conn extras (`primary_auth`, `two_factor`) | **Partial** | Accepted, not stored (from 1.4.9) |

Locked keys clients ignore in strategy updates (`#16696`):  
`api-server`, `custom-rendezvous-server`, `relay-server`, `key`, `2fa`, `bot`, `enable-trusted-devices`, `trusted-device-expiration-days`, `websocket-port`.

Still allowed client-side via strategy (BetterDesk does not currently push most of these):  
`approve-mode`, `verification-method`, `access-mode`, `whitelist`, `id-whitelist`, `allow-auto-update`.

---

## 5. Bootstrap / deploy / ConfigUpdate

| Path | Verdict |
|------|---------|
| Dashboard deploy string / QR / CLI `--config` | **OK** — relay forced to `host:port` (`keyService`, `clientConfigHost`, `agentBundleConnection`) |
| Mobile deep link | **OK with caveat** — needs `allow-deep-link-server-settings` or Import (#368) |
| Support `custom.txt` override-settings | **OK** — bake-time, not heartbeat |
| TestNat `ConfigUpdate` (`RENDEZVOUS_SERVERS`) | **Dead on 1.5.x clients** — still emitted; do not use for re-home |
| Standing `configure_update` message | **Not sent** by BetterDesk handlers |

---

## 6. Enrollment / initiator gates (false “grounded”)

| Gate | Symptom | Notes |
|------|---------|-------|
| Managed pending | Online in heartbeat, no inbound remote | Approve in Registrations |
| Rejected + re-enroll lock | Permanent refuse until Allow re-enroll | By design |
| `LOGGED_IN_ONLY_INITIATOR` | Punch/relay denied without login token | Default off — verify after upgrades |
| `OPERATOR_ONLY_OUTBOUND` | Stock peer cannot initiate | Intentional hardening |
| Shared NAT without allow | Ambiguous initiator | Config flag |

These are **not** new in 1.5.3 but amplify confusion when combined with relay timeouts.

---

## 7. Client-only 1.5.x features (no BetterDesk blocker)

| Feature | Impact on BetterDesk |
|---------|----------------------|
| Trusted Devices V2 (`#16548`) | Peer-local; mixed versions → TOTP |
| Connection approval (`#16784`) | Controlled-side UX |
| Windows IPC / installer hardening | Update all local components together |
| Signed auto-update | Client/vendor; not BetterDesk server |

---

## 8. Lab checklist (remaining — not executed in this pass)

Use stock RustDesk **1.5.3** binaries against a BetterDesk lab (`dev` image):

1. [ ] Two peers, correct deploy string (`relay` with `:21117`) — remote + file transfer  
2. [ ] Same with `AlwaysUseRelay` / force-relay — watch for R1 timeout  
3. [ ] Peer with bare relay host / wrong `:21114` — compare logs: stored vs forwarded relay  
4. [ ] Org policy `block_direct_p2p` / allowed relays — confirm advertise strings  
5. [ ] Heartbeat strategy toggles apply; locked keys never rewrite Network settings  
6. [ ] Upgrade 1.4.9 → 1.5.3 without server change  
7. [ ] Windows GUI+service pair after upgrade  

Checklist template: [`rustdesk-compat-checklist.md`](rustdesk-compat-checklist.md).

---

## 9. Recommended work (priority)

1. **P0 — Live verification:** test the `sendRelayResponse` fix with stock 1.5.3 AlwaysUseRelay / force-relay and confirm the target accepts `relayAdvertisedToTarget` — [#504](https://github.com/UNITRONIX/BetterDesk/issues/504)  
2. **P1 — Runtime proto follow-up:** additive fields are synced; emit/store `ControlledContext.conn_audit_ref` and validate WebRTC identity fields where BetterDesk can obtain them — [#505](https://github.com/UNITRONIX/BetterDesk/issues/505)
3. **P2 — Ops:** optional stop emitting TestNat `ConfigUpdate`; Strategies UI hint that endpoints are deploy-only on 1.5.x  
4. **P2 — Harden:** reject locked keys on strategy save (panel + Go)  
5. **P3 — Attribution:** emit/store `conn_audit_ref` + audit JSON extras  

---

## 10. References

- Summary table: [`docs/RDCLIENT_VS_RUSTDESK_AUDIT.md`](../RDCLIENT_VS_RUSTDESK_AUDIT.md) (§ 1.5.3)  
- Watch manifest: [`config/rustdesk-upstream-watch.json`](../../config/rustdesk-upstream-watch.json)  
- Deploy guide: [`docs/setup/RUSTDESK_CLIENT_DEPLOYMENT.md`](../setup/RUSTDESK_CLIENT_DEPLOYMENT.md)  
- Code anchors: `betterdesk-server/signal/handler.go` (`sendRelayResponse`, `relayAdvertisedToTarget`, `sanitizeClientRelayAddress`, `handleTestNat`), `api/client_api_handlers.go`, `signal/relay_identity_test.go`  
