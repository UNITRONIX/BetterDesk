# Live Session Reporting Review for PR #346

This is the implementation gate for [#283](https://github.com/UNITRONIX/BetterDesk/pull/283)
and [#423](https://github.com/UNITRONIX/BetterDesk/pull/423). The feature is
useful, but neither large PR is approved for direct merge.

## Security findings to resolve first

1. **Attribution must be server-trusted.** A RustDesk audit payload can contain
   controller names and peer fields. A client-provided display name must never
   become the operator identity when the server cannot bind it to an
   authenticated session.
2. **Every lifecycle event needs ownership checks.** `start`, `heartbeat`, and
   `end` must use an opaque server-issued session handle bound to the
   authenticated operator and target. Checking visibility only at `start`
   permits a caller holding a session identifier to mutate a later event.
3. **Signal observation is not proof of a connected session.** A
   `RequestRelay` authorization happens before the relay pair is established.
   Signal-created rows need a pending state, a short pairing deadline, or an
   explicit relay confirmation so failed attempts do not become work time.
4. **Retention is mandatory.** Session history contains operator identity,
   device identity, controller identity, and timestamps. The feature needs a
   configurable retention policy, bounded cleanup, and documented deletion
   behavior for SQLite and PostgreSQL.
5. **Split relay reporting must use an explicit internal trust boundary.**
   The relay callback must authenticate with the internal API key, validate
   the UUID format and target/session binding, clamp timestamps, and remain
   best-effort without blocking the relay data path.
6. **Visibility must be enforced at the Go API boundary as well as in Node.**
   Organization scope, device permissions, deleted/disabled devices, empty
   selections, and direct API callers require tests for both databases.
7. **CSV is an export of sensitive data.** Keep formula-injection protection,
   no-store headers, authenticated authorization, bounded date/device limits,
   audit logging, and escaped UI rendering. Add tests for malicious
   hostnames, display names, usernames, and controller IDs.

## Reviewable implementation split

### Phase A — database primitives

Files:

- `betterdesk-server/db/database.go`
- `betterdesk-server/db/sqlite.go`
- `betterdesk-server/db/postgres.go`
- new `device_online_sessions` and `remote_access_sessions` modules

Scope:

- additive schema and indexes;
- idempotent start/touch/end operations;
- target ID rename/delete/ban/restart handling;
- retention cleanup with bounded batches;
- SQLite/PostgreSQL behavior parity;
- no HTTP routes and no UI changes.

Required tests:

- duplicate starts;
- concurrent touches;
- end-before-start and end-after-end;
- restart/offline cleanup;
- rename and hard-delete behavior;
- retention deletion;
- PostgreSQL integration when `BETTERDESK_TEST_POSTGRES_DSN` is present.

### Phase B — authenticated server API

Files:

- `betterdesk-server/api/remote_session_handlers.go`
- `betterdesk-server/api/device_activity_handlers.go`
- `betterdesk-server/api/relay_session_handlers.go`
- `betterdesk-server/api/server.go`
- `betterdesk-server/signal/handler.go`
- relay callback code

Scope:

- bind event handles to authenticated operator, target, and source;
- enforce organization/device scope on every request;
- model pending/active/ended/orphaned states;
- deduplicate audit, signal, web-console, and split-relay observations;
- never use client-supplied names as authenticated identity;
- authenticate internal relay callbacks separately from user permissions.

Required tests:

- unauthorized operator, cross-organization target, deleted target, and
  reused session handle;
- audit payload with forged operator/display name;
- signal request that never pairs;
- relay callback with wrong API key, wrong UUID, future timestamp, and wrong
  target;
- duplicate events from all sources.

### Phase C — Node proxy and export

Files:

- `web-nodejs/routes/devices.routes.js`
- `web-nodejs/services/betterdeskApi.js`
- `web-nodejs/routes/rustdesk-api.routes.js`

Scope:

- pass only server-derived operator identity;
- preserve the visible-device allowlist;
- bound date range, device count, operator count, and response size;
- export only authorized rows;
- log exports without logging secrets or full sensitive payloads.

Required tests:

- session and permission failures;
- empty visible selection does not expand to all devices;
- CSV formula injection and Unicode;
- GET download authorization and no-store behavior;
- organization visibility in SQLite and PostgreSQL modes.

### Phase D — console UI

Files:

- `web-nodejs/public/js/devices.js`
- `web-nodejs/public/js/deviceActivity.js`
- `web-nodejs/public/css/device-activity.css`
- `web-nodejs/views/devices.ejs`
- widget files only when needed

Scope:

- clearly distinguish Online presence from Live remote sessions;
- do not display untrusted HTML;
- keep current-session duration separate from selected-period totals;
- preserve existing filters and mobile/popout behavior.

### Phase E — translations and release

Files:

- every `web-nodejs/lang/*.json`
- `CHANGELOG.md`
- relevant update/release documentation

Scope:

- add the English keys first;
- add proper translations to all 26 locales in the same change;
- verify identical key paths across locales;
- document native updater Go rebuild/restart behavior and Docker image
  recreation;
- add retention/privacy notes to release documentation.

## Merge gate

Do not merge #283 or #423 directly. Accept only the smaller phases, in order,
after their tests and security review pass. If the maintainer rewrites the
feature, retain the production findings and test cases as design input, but
do not copy code or unreviewed assumptions wholesale.
