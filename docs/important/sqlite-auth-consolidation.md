# SQLite authentication-store consolidation

BetterDesk versions before the consolidation maintain two SQLite files:

- `db_v2.sqlite3` — BetterDesk server data;
- `auth.db` — legacy Node.js panel users, MFA, tokens and panel state.

The current runtime uses one selected database. On SQLite this is
`db_v2.sqlite3`; on PostgreSQL no SQLite file is created.

## Upgrade an existing SQLite installation

Stop the BetterDesk server and console first. Do not run the migration while
either process may write to either database.

Run a validation-only pass. The dry run now executes the real merge against
throwaway copies of both databases, so it fails wherever the real run would:

```sh
AUTH_DB_PATH=/opt/BetterDeskConsole/data/auth.db \
  betterdesk-server -db /opt/rustdesk/db_v2.sqlite3 \
  -migrate-sqlite-auth -migrate-sqlite-auth-dry-run
```

If the same account exists on both sides with a matching role and MFA state but
a different password-hash format (bcrypt in the console, pbkdf2 in the server),
the run stops and reports the account. That is deliberate: two different hashes
can mean two different passwords, and picking one silently would hand access to
whoever holds it. To keep the server-side hash and proceed, opt in explicitly:

```sh
AUTH_DB_PATH=/opt/BetterDeskConsole/data/auth.db \
  betterdesk-server -db /opt/rustdesk/db_v2.sqlite3 \
  -migrate-sqlite-auth \
  -migrate-sqlite-auth-prefer-target-credentials
```

Each resolved account is listed as a warning in the JSON report, so the decision
is auditable. Never prefer the legacy console hash.

If it completes without conflicts, run the migration with a durable backup
directory:

```sh
AUTH_DB_PATH=/opt/BetterDeskConsole/data/auth.db \
  betterdesk-server -db /opt/rustdesk/db_v2.sqlite3 \
  -migrate-sqlite-auth \
  -migrate-sqlite-auth-backup-dir /opt/rustdesk/backups
```

The command emits a JSON report. It:

1. validates both databases with SQLite integrity checks;
2. creates snapshots of both databases and a candidate copy of `db_v2.sqlite3`;
3. creates every missing legacy table before copying rows, so foreign keys
   between legacy tables cannot fail on ordering;
4. imports the legacy panel data only into the candidate, merging users by
   username and comparing only authentication columns (console profile fields
   such as `preferred_language` or `email` never look like a conflict);
5. aborts on user, role, credential, MFA, address-book or primary-key
   conflicts rather than silently overwriting data;
6. validates the candidate, compares foreign-key violations against the
   baseline taken before the merge (an aged install may already carry orphaned
   rows such as audit entries for deleted users), and atomically activates it.

The original `auth.db` is not changed or deleted. Keep it and the generated
backups until the upgraded service has been verified and the normal retention
period has elapsed.

### Known limitations

- A read-only `auth.db` bind mount is not enough: SQLite needs write access to
  the `-wal`/`-shm` side files even though the source is never modified.
  Mount the console data directory read-write for the migration, or copy
  `auth.db` to a writable location and point `AUTH_DB_PATH` at the copy.
- Tables that only ever existed in the console database (`agent_bundles`,
  `agent_bundle_builds`) are not part of the consolidation. Copy them
  separately if an older install kept them in its own `DB_PATH`.

## Verify and rollback

Start BetterDesk and confirm login, MFA, device groups, folders and the
RustDesk address book. The migration marker makes both the Go server and Node
console read panel data from `db_v2.sqlite3`.

If service verification fails before new data is written, stop services and
restore the reported target snapshot:

```sh
betterdesk-server -db /opt/rustdesk/db_v2.sqlite3 \
  -rollback-sqlite-auth /opt/rustdesk/backups/db_v2.sqlite3.pre-auth-consolidation-YYYYMMDDTHHMMSSZ
```

The failed consolidated database is retained alongside the active file for
forensics. Migration never deletes the legacy `auth.db`.
