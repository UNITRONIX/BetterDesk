# Client Generator

The **BetterDesk Support Generator** distributes **incoming-only** desktop
agents. Production BetterDesk servers (typically Linux) **do not compile**
clients on the panel host.

Signed installers are built on GitHub in
[BetterDesk-Client](https://github.com/UNITRONIX/BetterDesk-Client)
(Windows x86 / Windows ARM, Linux for typical distributions, macOS). The
console **imports** a verified release, caches it under the instance data
directory, and **serves download links**. End users open a public hub or
portal page — downloading does not trigger a build.

Appearance (logo, colors) is **not** baked into installers. The desktop
client loads branding at runtime from the Console **Client Branding API**.

---

## Quick start (production — download-only)

1. Log in as **admin**.
2. Open **Generator**.
3. Under **Generic incoming-only agents**, click **Import latest release**.
4. Share the public download / portal links with end users.
5. After install, the generic agent asks for the BetterDesk HTTPS address
   (local IP or public), downloads the server public key, and shows a
   pairing QR (`type: betterdesk-agent-pairing`).
6. In **Główne → Aktywuj agenta** an operator with `enrollment.approve`
   scans that QR, sets device name/folder, and activates the pending
   enrollment.

The outbound HTTPS connection completes enrollment; no inbound port or
password is required on the agent side.

> **Client note:** the pairing form + QR producer lives in BetterDesk-Client.
> The panel scanner and `POST /api/agent-pairing/activate` are ready in this
> repository.

---

## Generic Support Agent releases

The `BetterDesk-Client` repository publishes generic permanent incoming-only
agents through the protected
`.github/workflows/betterdesk-support-generic-release.yml` workflow. The
generic release contains no server URL, organization data or enrollment
secret.

An administrator imports a signed release through the release API (the
Generator UI calls the same endpoint). BetterDesk verifies the Ed25519
manifest signature, SHA-256 values, target metadata and absence of
`custom.txt`, then stores the verified files below the instance data
directory. Public download links serve the local cache, not GitHub
directly.

Environment:

```text
BETTERDESK_CLIENT_REPO=UNITRONIX/BetterDesk-Client
BETTERDESK_CLIENT_ALLOWED_REPOS=UNITRONIX/BetterDesk-Client
BETTERDESK_CLIENT_GENERATOR_MODE=download
# Optional: base64 Ed25519 public key matching the Actions signing secret
# BETTERDESK_SUPPORT_RELEASE_PUBLIC_KEY=
AGENT_BUILD_WORKER=off
```

---

## Legacy / maintainer: embedded local builds

Local Flutter/Cargo compilation on the BetterDesk host is **optional and
developer-only**. It is not required for production.

To enable:

```text
BETTERDESK_CLIENT_GENERATOR_MODE=embedded
AGENT_BUILD_WORKER=on
BETTERDESK_CUSTOM_CLIENT_SIGNING_SEED=<base64 32-byte NaCl seed>
```

Then install the host toolchain (menu **B** in `betterdesk.sh`, or
`scripts/install-build-toolchain.sh` / `.ps1`) and sync BetterDesk-Client
source from the Generator module UI.

Builder data (embedded mode only) lives under:

```text
{dataDir}/modules/betterdesk-client-builder/
  state.json
  source/
  requests/
  outputs/
```

Embedded bundles embed a signed server profile at compile time (no
`custom.txt` in the delivered archive). That path still needs a full
platform matrix from a trusted provider for non-host targets.

Windows maintainer hosts:

```powershell
.\scripts\install-build-toolchain.ps1 -Install
.\scripts\install-build-toolchain.ps1 -VerifyOnly
```

---

## Connection defaults (branded / embedded profiles)

Defaults come from `/api/generator/defaults` (`keyService` + `clientConfigHost`):

- Server host / relay host
- HTTPS toggle + API port
- Server public key (`id_ed25519.pub`)

### Service and autostart

The bundle editor exposes two opt-in settings:

- **Install Support Agent service** — creates the platform service.
- **Start Support Agent automatically** — enables service/startup autostart.

Both are disabled by default.

---

## Security notes

- Prefer import + local cache + public links over host toolchain setup.
- Do not expose `agent-builds`, builder requests or Client source trees as
  static web directories.
- The signing seed (embedded mode) is secret and must be readable only by
  the console service.
