# BetterDesk device telemetry contract

Version: `1`

This contract is shared by BetterDesk desktop clients, the Go server, and the
web console. It is additive to the RustDesk-compatible `/api/heartbeat` and
`/api/sysinfo` endpoints.

## Device modes

`product_sku` is authoritative for product behavior:

- `betterdesk-desktop`: managed desktop agent. The UI may show all capabilities
  that the operating system and policy permit.
- `betterdesk-support`: Support Agent. It is incoming-only and must not be
  promoted to a managed agent by a server strategy.

`conn_mode` is `normal` or `incoming-only`. The server must enforce both the
SKU and the operator permission; client-reported capabilities are never an
authorization decision by themselves.

## Collection status

Every optional collector may return one of these short codes:

`ok`, `unsupported`, `permission_denied`, `unavailable`, `error`.

The payload may include a short, localized-by-the-panel `message_key`, but
must not include stack traces, command output, usernames, paths, or secrets.

## Heartbeat envelope

The existing heartbeat remains small and frequent. New clients may include:

```json
{
  "telemetry_schema": 1,
  "id": "DEVICE_ID",
  "uuid": "DEVICE_UUID",
  "product_sku": "betterdesk-desktop",
  "conn_mode": "normal",
  "capabilities": ["telemetry.metrics", "inventory.hardware"],
  "telemetry": {
    "sample_id": "uuid",
    "collected_at": "2026-09-12T17:00:00Z",
    "metrics": {
      "cpu_percent": 12.5,
      "memory_percent": 44.1,
      "disk_percent": 61.0
    },
    "status": {"metrics": "ok", "hardware": "unavailable"}
  }
}
```

Legacy `cpu`, `memory`, and `disk` fields remain accepted and are mapped to the
same metric sample. Samples are idempotent by `(device_id, sample_id)`.

Recommended defaults:

- heartbeat/status: existing client interval;
- resource sample: 60 seconds, configurable by server policy;
- hardware inventory: once per 24 hours, plus an authenticated refresh command;
- services/processes/events: cached snapshots, normally no more often than every
  5 minutes;
- activity: opt-in, aggregated application/window metadata only, no URLs,
  document contents, keystrokes, screenshots, or clipboard data.

## Inventory and cached snapshots

Inventory and snapshots are sent as bounded records:

```json
{
  "telemetry_schema": 1,
  "device_id": "DEVICE_ID",
  "kind": "hardware",
  "sample_id": "uuid",
  "collected_at": "2026-09-12T17:00:00Z",
  "status": "ok",
  "data": {}
}
```

Supported `kind` values are `hardware`, `services`, `processes`, `events`, and
`activity`. The server stores only the latest inventory plus bounded history.
Events and activity have independent retention policies.

## Commands

Commands are addressed to one device and contain a unique `command_id`,
`command`, bounded `args`, an expiry, and the operator audit identity. The
agent returns `queued`, `ok`, `rejected`, `unsupported`, `permission_denied`,
or `error`. Service changes, process termination, file writes/deletes, and
downloads require an explicit capability and operator permission.

Commands must be allowlisted. An arbitrary shell command is not part of this
contract.

## Application-level protection

HTTPS/WSS remains the required production transport. For deployments that
still expose HTTP, telemetry may additionally use an envelope containing:

- a server deployment public key for authenticated encryption;
- a signed X25519 key fetched from `/api/telemetry/key`, verified against the
  BetterDesk server public key configured in the client's existing `key`
  connection setting;
- a device key for signing;
- a unique nonce and monotonic sequence;
- the schema version and device ID as authenticated additional data.

The server rejects invalid signatures, stale sequences, mismatched device IDs,
and payloads above the endpoint limit. BetterDesk heartbeats and command
responses use the same envelope when the signed key is available. Private
keys never leave their owner. Ordinary RustDesk heartbeats remain
plaintext-compatible and are classified as `RustDesk` when no BetterDesk
identity fields are present.

After the first authenticated device heartbeat, BetterDesk JSON API requests
may use `X-BetterDesk-Envelope: 1` and `X-BetterDesk-Device`. The server
decrypts the request before invoking the normal handler and encrypts the
response. Bootstrap endpoints such as login, enrollment, branding, health,
and `/api/telemetry/key` remain compatible so a device can establish identity.
Production deployments should still use HTTPS/WSS.
