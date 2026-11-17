# RustDesk ↔ BetterDesk compatibility checklist

Use this whenever `scripts/watch_rustdesk_upstream.py` (or a human) flags a new **stock RustDesk client** or **open-source `rustdesk-server`** release.

BetterDesk production uses clean-room [`betterdesk-server`](../../betterdesk-server/) (not AGPL `rustdesk-server`). Track OSS server notes only for **wire / API parity**. Do **not** vendor AGPL sources into this tree.

Automation state: [`config/rustdesk-upstream-watch.json`](../../config/rustdesk-upstream-watch.json)  
Human audit log: [`docs/RDCLIENT_VS_RUSTDESK_AUDIT.md`](../RDCLIENT_VS_RUSTDESK_AUDIT.md)

## Before you start

- [ ] Note the upstream tag(s) under review (client and/or `rustdesk-server`)
- [ ] Read the GitHub release notes + linked PRs that mention security, policy, config, relay, API, or handshake
- [ ] Diff BetterDesk canonical protos vs the upstream tag **for reference only** (`rendezvous.proto`, `message.proto`) — copy schemas into BetterDesk only after clean-room assessment

## 1. Bootstrap / client config

- [ ] Dashboard **deploy string** / QR / `rustdesk://config/…` still applies ID server, relay (`host:port`), API, and key
- [ ] Mobile deep-link: `allow-deep-link-server-settings` (or Import Server Config fallback) still documented for the new client
- [ ] Client no longer silently falling back to public RustDesk infrastructure when misconfigured (fail-closed / offline is OK; silent public relay is not)
- [ ] Server-pushed `ConfigUpdate` (TestNat path): confirm whether the client still honours it; document if ignored

## 2. RegisterPk / enrollment

- [ ] Fresh peer registers on BetterDesk signal (UDP / TCP / WSS as deployed)
- [ ] Managed / locked enrollment: pending, reject, allow, re-enroll
- [ ] Rejected-device lock requires operator **Allow re-enroll** (no silent bypass)
- [ ] Initiator gates (`LOGGED_IN_ONLY_INITIATOR`, `OPERATOR_ONLY_OUTBOUND`) still deny stock clients without tokens when enabled

## 3. Signal + relay

- [ ] PunchHole / RequestRelay succeed between two stock peers through BetterDesk
- [ ] Relay UUID authorization still rejects spoofed pairs
- [ ] Portless `relay-server` clients still work with API sniff / documented host:port deploy
- [ ] TLS / WSS / reverse-proxy paths match [`HTTPS_SETUP.md`](../setup/HTTPS_SETUP.md) / [`REVERSE_PROXY.md`](../setup/REVERSE_PROXY.md)

## 4. Client HTTP API

- [ ] Login (local / LDAP / TOTP) + logout
- [ ] Address book / groups / peers sync
- [ ] Heartbeat + sysinfo (`version` stored)
- [ ] Strategy / branding `config_options`: list which keys the new client **applies** vs **ignores / locks**
- [ ] Confirm BetterDesk does **not** rely on locked keys (`api-server`, `custom-rendezvous-server`, `relay-server`, `key`, `2fa`, `websocket-port`, trusted-device policy keys) for fleet bootstrap

## 5. Session features (lab)

- [ ] Remote desktop (video + input)
- [ ] Clipboard (text; image if claimed)
- [ ] File transfer
- [ ] Terminal / privacy mode / multi-monitor if release notes change them
- [ ] Connection approval / trusted devices if present in the release

## 6. OSS `rustdesk-server` release (parity only)

- [ ] Read OSS server release notes for handshake, punch, relay, or amplification fixes
- [ ] Map any wire/behaviour change to BetterDesk Go signal/relay/API
- [ ] No requirement to run upstream binaries in production

## 7. Close-out

- [ ] Append a dated section to [`RDCLIENT_VS_RUSTDESK_AUDIT.md`](../RDCLIENT_VS_RUSTDESK_AUDIT.md) (OK / Partial / Blocker + verify steps)
- [ ] Set `last_reviewed_tag` in [`config/rustdesk-upstream-watch.json`](../../config/rustdesk-upstream-watch.json) for each reviewed component
- [ ] Open or update a `Next Updates` Issue for any code/docs follow-ups; **do not** close Issues unless the operator asks
- [ ] Prefer fixes on branch `dev`

## Known 1.5.x hot spots (baseline)

| Topic | Why it matters |
|-------|----------------|
| `ConfigUpdate` removed on client | BetterDesk may still send rendezvous list on TestNat; new clients ignore it — bootstrap must be local (deploy string / UI) |
| Policy-locked keys (1.5.3) | Heartbeat strategy cannot rewrite server endpoints or key |
| Explicit bootstrap / no public fallback | Mis-deployed clients stay offline instead of using public infra |
| Relay / UUID validation | Stricter clients may reject rewritten or masked relay addresses |
| Force-relay `sendRelayResponse` | Server-computed relay without `relayAdvertisedToTarget` — see [#504](https://github.com/UNITRONIX/BetterDesk/issues/504) |

**Complete 1.5.3 audit:** [`RUSTDESK_1_5_3_COMPAT_AUDIT.md`](RUSTDESK_1_5_3_COMPAT_AUDIT.md)
