# Client Generator

The **BetterDesk Support Generator** in the web console builds **incoming-only** desktop installers from the independent BetterDesk-Client repository. In embedded mode, the signed server profile is supplied at compile time and stored inside the client binary; the delivered archive contains no `custom.txt` or other external server configuration file. End users download a stable artifact from a public hub page — downloading does not trigger another build.

Appearance (logo, colors) is **not** baked into installers. The desktop client loads branding at runtime from the Console **Client Branding API**.

---

## What you get

Each Support bundle produces portable artifacts that:

- Use BetterDesk-Client desktop binaries (AGPL)
- Force **incoming-only** (`conn-type: incoming`)
- Embed server settings and the permanent incoming-only policy in the binary
- Target Windows / Linux / macOS (x64 + ARM64 portable)

| Platform | Format |
|----------|--------|
| Windows x64 / ARM64 | Portable `.zip` |
| Linux x64 / ARM64 | Portable `.tar.gz` |
| macOS Intel / Apple Silicon | Portable `.tar.gz` |

---

## Builder install (first run)

Before creating embedded bundles, admins configure the **BetterDesk-Client builder**:

1. Open **Generator** and accept the AGPL / incoming-only notice.
2. Configure the public [BetterDesk-Client](https://github.com/UNITRONIX/BetterDesk-Client) repository and branch/ref.
3. The BetterDesk server uses its built-in local builder. It receives one JSON request, downloads/uses the pinned Client source, compiles the incoming-only profile and writes verified target archives to the runtime output directory.
4. Run the builder connection/source check. The console downloads a pinned source snapshot outside the BetterDesk checkout.
5. Create a Support config. The config is built once per Client commit and reused by its download link.

Builder data lives under:

```text
{dataDir}/modules/betterdesk-client-builder/
  state.json
  source/             # pinned BetterDesk-Client snapshot; never part of the BetterDesk repo
  requests/           # private, short-lived build requests
  outputs/            # provider output before verification
```

Signing seed:

- Env: `BETTERDESK_CUSTOM_CLIENT_SIGNING_SEED` (base64 32-byte NaCl seed)
- Or file `custom-client-signing.seed` copied into the module dir

The signing seed is never sent to the builder. The console signs the payload, sends only the signed value, and the Client build embeds it. Plain JSON and external `custom.txt` are not accepted by the embedded production path.

---

## Quick start

1. Log in as **admin** and finish module install
2. Open **Generator** → **New Support**
3. Enter bundle name, optional app name, confirm server / relay / API (prefilled from console defaults)
4. Select platforms and **Save**
5. Watch build status; share the download hub link (`/d/:slug`)

### Connection fields

Defaults come from `/api/generator/defaults` (`keyService` + `clientConfigHost`):

- Server host / relay host
- HTTPS toggle + API port
- Server public key (`id_ed25519.pub`)

The worker sends the signed Support payload to the build provider. The provider embeds it in the binary; the final archive contains no `custom.txt`.

### Build generations and automatic updates

The console stores each Support configuration as a reusable profile. It does not rebuild when somebody downloads a client. A profile has one artifact set per Client commit and target.

When the BetterDesk-Client ref changes, the panel update flow:

1. resolves and downloads the new commit into the data directory;
2. queues one new generation for every non-revoked Support profile;
3. builds every target exposed by the configured provider in the background;
4. verifies the manifest, checksum, Support SKU and absence of `custom.txt`;
5. atomically switches each profile's existing link only after all required targets are ready.

If a target fails, the previous generation remains active and the worker retries after restart. Existing links are never switched to a partial generation.

### Service and autostart

The bundle editor exposes two opt-in settings:

- **Install Support Agent service** — creates the platform service.
- **Start Support Agent automatically** — enables service/startup autostart.

Both are disabled by default. Windows bundles contain PowerShell install/uninstall scripts; Linux bundles contain systemd scripts; macOS bundles contain LaunchDaemon scripts. The scripts request elevation only for the service installation operation.

### Generator environment

For native, Docker and Windows installations configure these values in the BetterDesk environment file:

```text
BETTERDESK_CLIENT_REPO=UNITRONIX/BetterDesk-Client
BETTERDESK_CLIENT_ALLOWED_REPOS=UNITRONIX/BetterDesk-Client
BETTERDESK_CLIENT_REF=master
BETTERDESK_GITHUB_TOKEN=
BETTERDESK_CUSTOM_CLIENT_SIGNING_SEED=
BETTERDESK_CLIENT_GENERATOR_MODE=embedded
# Optional remote fallback; local server builder is the default.
BETTERDESK_CLIENT_GITHUB_ACTIONS=off
BETTERDESK_CLIENT_BUILD_WORKFLOW=support-build.yml
# Optional trusted local provider override:
# BETTERDESK_CLIENT_BUILD_COMMAND=/path/to/trusted-builder
BETTERDESK_CLIENT_BUILD_TIMEOUT_MS=3600000
AGENT_ARTIFACT_DIR=<dataDir>/agent-builds
AGENT_BUILD_WORKER=on
```

The signing seed is secret. The console service account needs read/write access to the builder, build cache and artifact directories, while the seed should be readable only by the console service. Do not expose `agent-builds`, builder requests or the source directory as static web directories. The build command must be an operator-installed, trusted provider; never accept it from a web request.

The built-in local provider is host-only: it exposes a target only when the
host platform and its required Cargo, Flutter and vcpkg toolchain are
available. On a Linux console this normally means Linux x64. Unsupported
platforms are omitted from the generator instead of being queued and later
reported with a misleading artifact error. A complete cross-platform matrix
requires a provider that supplies those targets.

---

## Architecture notes

| Piece | Role |
|-------|------|
| `clientBuilderService.js` | Pinned Client source sync, provider request and generation identity |
| `customTxtBuilder.js` | Create the signed payload that is embedded during the Client build |
| `clientTemplateWorker.js` | Queue embedded builds, verify artifacts, promote complete generations |
| `agent_bundles` / `agent_bundle_builds` | Existing DB tables (product_type `betterdesk-support`) |

Legacy Go **Support Agent** (`betterdesk-support-agent`) and compile-on-console workers are removed. Old product types (`support-agent`, `agent`, `agent-client`, `rdclient`) normalize to `betterdesk-support` for compatibility.

---

## Security notes

- Bundles do **not** embed a shared enrollment token
- Each install registers independently; managed mode issues a `device_token` after operator approval
- Support clients are **inbound-only** — end users cannot browse or connect outbound to other devices on your infrastructure
- Support clients load company name, colors and logo at runtime from `GET /api/branding`; branding images are sent through the Client Branding API and are not baked into the bundle.
- The server does not push generic heartbeat strategy settings to `betterdesk-support` devices.
- The signing seed on the console must match the public key baked into the BetterDesk-Client source revision.
- Generated archives must not contain `custom.txt`; the server refuses to promote an artifact that contains the old external configuration marker.
