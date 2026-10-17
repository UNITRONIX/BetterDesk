# Transport and Compatibility Threat Model for PR #346

This document is the review gate for the transport-related work discussed in
[issue #346](https://github.com/UNITRONIX/BetterDesk/issues/346). It is not an
approval of any external PR.

## Scope

The relevant surfaces are:

- `web-nodejs/services/wsRelay.js`
- `web-nodejs/public/js/rdclient/connection.js`
- `web-nodejs/public/js/rdclient/protocol.js`
- `web-nodejs/public/js/rdclient/client.js`
- `betterdesk-server/signal/handler.go`
- `betterdesk-server/relay/`

The browser relay framing change is intentionally separate from file-transfer
lazy loading. A framing change must not silently alter session authentication,
guest access, origin validation, or file-transfer behavior.

## Trust boundaries

1. Browser WebSocket upgrade → authenticated BetterDesk session or validated
   guest grant plus origin policy.
2. Node WebSocket proxy → bounded TCP bridge to the configured relay.
3. Signal → relay UUID authorization registry and one-use two-party claim.
4. Native/WebSocket relay peers → opaque, end-to-end RustDesk payloads; the
   relay must not decrypt or reinterpret peer messages.

## Required invariants

### Framing

- Native WebSocket transport carries exactly one opaque RustDesk payload per
  binary WebSocket message.
- A TCP bridge converts each complete WebSocket message to exactly one bounded
  RustDesk `BytesCodec` frame and converts complete TCP frames back to one
  WebSocket message.
- Empty frames, malformed headers, oversized payloads, fragmented headers, and
  fragmented payloads are rejected without unbounded allocation.
- TCP↔TCP, WebSocket↔WebSocket, and TCP↔WebSocket all retain their intended
  framing semantics.

### Authorization

- `/ws/relay` continues to enforce session, guest-grant, and origin checks.
- Mixed transport support does not bypass signal-issued relay ticket checks.
- `ALLOW_LEGACY_OUTBOUND` remains disabled by default and cannot authorize
  anonymous initiators in `managed` or `locked` enrollment.
- `RELAY_REQUIRE_TICKETS=N` is not a production default. Until signal/relay
  authorization is shared or cryptographically verifiable across hosts, this
  setting must remain an explicitly documented compatibility risk.
- Target ban, disable, deletion, password, consent, and E2E checks remain
  enforced.

### Abuse resistance

- Per-IP connection limits, pending-auth limits, active-session limits,
  bandwidth limits, idle timeouts, and frame-size limits remain active.
- Cleanup is race-safe: a timeout must not close a connection that was paired
  concurrently.
- A failed or unauthorized upgrade must not leave an open TCP socket, pending
  relay entry, or leaked limiter slot.

## Review split for #282

The safe first unit is:

1. `wsRelay` framing helpers and their boundary/fragmentation tests.
2. Browser native relay serialization and raw-message send/receive tests.
3. No file-transfer runtime changes in the same review.

The file-transfer session changes require a separate PR with readiness,
failure, cleanup, and legacy-viewer tests. They must not be accepted merely
because the framing tests pass.

## Review split for #358 and #359

Do not merge either compatibility bypass as part of a framing change.

For #358, require a separate threat review covering anonymous initiator
authorization, target selection, audit attribution, rate limiting, and the
operator-visible warning required when `open` enrollment is used.

For #359, prefer a shared authorization backend or signed relay capability
over disabling ticket enforcement. If a compatibility mode is retained, it
must be opt-in, default-deny, clearly logged, tested on TCP and WebSocket
listeners, and documented as weaker than the all-in-one mode.

## Evidence required before merge

- Focused framing tests and authenticated upgrade tests.
- `go test -race` for `relay`, `signal`, and `peer`.
- `go vet ./...`, `npm test`, and secret/provenance checks for the affected
  tree.
- Wire-level tests for all three transport pairings and TLS where applicable.
- A deployment note explaining whether the panel updater rebuilds the Go
  binary or Docker must be recreated.
