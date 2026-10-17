# Embedded Support builder — operational notes

The active incoming-only generator uses `clientTemplateWorker.js`,
`clientBuilderService.js` and `localClientBuilder.js`. The old Tauri/Go
`agentBuildWorker.js` path is not part of the Support generator.

- The local provider is host-only. It builds Linux targets on Linux, Windows
  targets on Windows and macOS targets on macOS.
- The Linux package targets additionally require `dpkg-deb`, `rpmbuild` and
  `zstd` as applicable.
- `betterdesk-console.service` must receive the absolute tool paths through
  systemd: `PATH`, `FLUTTER_ROOT`, `VCPKG_ROOT`, `CARGO_HOME` and `PUB_CACHE`.
- Run `scripts/install-build-toolchain.sh` as root. It writes
  `/etc/betterdesk/build.env`; make the service environment reference the same
  values or configure them in the systemd drop-in.
- Inspect the Generator status before creating a profile. Unavailable targets
  must be disabled in the UI and must not be queued by the API.
- A full Windows/Linux/macOS and ARM matrix requires a trusted provider that
  returns a verified embedded manifest. The local Linux provider must never be
  presented as that matrix.
- The artifact directory is `${DATA_DIR}/agent-builds`; builder requests and
  outputs live under `${DATA_DIR}/modules/betterdesk-client-builder`.

## Retry a failed build
```bash
sudo -u postgres psql betterdesk -c \
  "UPDATE agent_bundle_builds SET status='queued', error_message='' \
   WHERE branding_hash='<hash>' AND platform='linux' AND format='deb';"
```

## Reset admin password (PostgreSQL — reset-password.js is BROKEN, hardcoded SQLite)
```bash
HASH=$(node -e "console.log(require('bcrypt').hashSync('NEW_PW', 12))")
sudo -u postgres psql betterdesk -c \
  "UPDATE users SET password_hash='$HASH' WHERE username='admin';"
```
