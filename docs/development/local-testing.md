# BetterDesk local diagnostic gate

The local gate is the authoritative pre-commit and pre-push check for a
developer checkout. It is intentionally separate from GitHub Actions: the
repository does not enable these hooks automatically on a clone, and the
workflow files do not call the local gate.

## First-time setup on Windows

Install the following commands and make them available on `PATH`:

- Node.js 22 or newer and npm
- Go 1.25 or newer and `govulncheck`
- Docker Desktop with the Compose plugin
- Bash and ShellCheck (Git Bash or WSL can provide Bash)
- PowerShell, ripgrep, gitleaks, and Trivy
- Python 3.9 or newer and `pip-audit`

The gate detects Python requirements in the bridges and the Python SDK
`pyproject.toml`. It detects Rust manifests if they are restored to the
checkout and then requires `cargo-audit` as well.

From the repository root:

```powershell
.\scripts\setup-local-gates.ps1
```

This runs the prerequisite check and sets only the clone-local Git setting:

```text
core.hooksPath=.githooks
```

It does not edit `.gitignore`, repository workflows, global Git settings, or
any host service configuration.

## Running the gate

Run the complete gate manually:

```powershell
npm run local:gate
```

The same command is called by both local hooks. A non-zero exit code blocks
the commit or push. The report files are written to `.local-test-results/`:

- `latest.json` contains machine-readable statuses, commands, exit codes,
  durations, captured output, branch, commit, and environment.
- `latest.md` contains the human-readable summary and explicit coverage
  boundaries.

To inspect the planned categories without claiming a pass:

```powershell
npm run local:gate:dry-run
```

## What is checked

The gate fails closed when any required stage is missing or incomplete.

- Node.js: clean installs and audits for the root package, console, and Node
  SDK; frontend syntax; protocol artifacts; all locale parity; provenance;
  full Jest tests; and SDK tests.
- Go: `go vet`, race-enabled tests, `govulncheck`, native build/help,
  Linux amd64/arm64 and Windows amd64 cross-builds, and PostgreSQL tests.
- Python: bytecode compilation for SDK/bridges, Python SDK unit tests, and
  `pip-audit` for each requirements file and SDK project dependency.
- Security: gitleaks, operator-specific path scan, Trivy source scan, npm
  audit, Go vulnerability analysis, Python dependency analysis, and Trivy
  scans of local Docker images.
- Installers: Bash syntax, ShellCheck, mocked installer regression tests,
  non-mutating help paths, and PowerShell AST parsing.
- Runtime: every Compose manifest, local image builds, temporary PostgreSQL,
  isolated SQLite/PostgreSQL Docker smoke tests, panel/API health, admin
  login, protocol/port checks, restart persistence, and hardened bind mounts.

The test runner builds from the checkout and does not pull the official
BetterDesk image from GHCR. Dependency and vulnerability databases may still
be contacted by npm, Go, pip, Docker base-image, or security-scanner tools;
the test execution and runtime stack remain local.

## Status meanings

- `PASS`: the required check completed successfully.
- `FAIL`: the check ran and found a defect, test failure, vulnerability, or
  leak.
- `BLOCKED`: a required tool, service, integration, or test was unavailable,
  or a test silently skipped.
- `OUT_OF_SCOPE`: an explicit boundary that cannot be proved by this checkout,
  such as a real RustDesk client, physical device, native host service
  lifecycle, or desktop source tree that is not present.

`OUT_OF_SCOPE` is never presented as a pass. `FAIL` and `BLOCKED` always
produce a non-zero gate result.

## Safety boundaries

The Docker checks use unique temporary containers and volumes and clean them
up in `finally` paths. The local gate never runs the native installer against
`/opt`, `C:\BetterDeskConsole`, NSSM, systemd, or production data. Native
install/update/rollback/uninstall lifecycle tests belong in a disposable VM.

Git's `--no-verify` option can bypass a local hook. Such a bypass is
intentional and must not be treated as evidence that the gate passed.
