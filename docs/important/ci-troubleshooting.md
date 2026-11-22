# GitHub Actions — troubleshooting

Quick map of CI workflows, common failures, and local commands that mirror branch protection checks.

## Required checks (branch protection)

| Workflow | What it enforces | Local mirror |
|---|---|---|
| **Version Verify** | Tier 1/2 files match `VERSION` | `node scripts/bump-version.js --verify` |
| **Secret Scan** | Gitleaks + operator fingerprint ban | `gitleaks detect --source . --config .gitleaks.toml` and `bash scripts/check-no-sensitive-paths.sh` |
| **Web Console CI** | `npm ci`, moderate+ audit, Jest | `cd web-nodejs && npm ci && npm audit --omit=dev --audit-level=moderate && npm run test:ci` |

## Why many jobs run after one push

A single push to `dev` can trigger:

1. First wave: CodeQL (5 languages), Secret Scan, path-filtered CI, Version Bump (dev)
2. Second wave: Version Bump commit → Version Verify, Docker Publish (if paths match)

Merges to `main` add tag + release + server binary builds. This is expected; failures look worse than they are when several independent checks fail for different reasons.

## Common failures

### Version Verify — `betterdesk.sh: expected X, got Y`

Version drift in installer scripts. Fix:

```bash
node scripts/bump-version.js --sync
node scripts/bump-version.js --verify
```

### Secret Scan — `leaks found`

Operator fingerprints must not appear in tracked sources:

- Lab LAN host `192.168.0.x` (specific test IP blocked — use `203.0.113.x` in docs/examples)
- Developer home paths under `/home/...` (build machines must not leak into commits)
- SSH `user@internal-ip` patterns from private runbooks

Sidecar binaries under `betterdesk-agent-client/src-tauri/binaries/` are **not** committed; they are built locally/CI with `go build -trimpath` via `build.rs`.

### Web Console CI — Jest failures

```bash
cd web-nodejs
npm ci
npm run test:ci
```

### Web Console CI — `npm audit`

Moderate+ production vulnerabilities fail CI. Fix with dependency bumps or documented `overrides` in `web-nodejs/package.json`.

### CodeQL red on Dependabot PRs

Dependabot PRs skip SARIF upload (GitHub permission limitation). Analysis still runs; push to `dev`/`main` uploads results. This is intentional in [`.github/workflows/codeql.yml`](../../.github/workflows/codeql.yml).

### Version Bump (dev) — `GH006: Protected branch update failed`

`dev` requires a pull request (and status checks). The bump workflow must **not**
push commits with `GITHUB_TOKEN` straight onto `dev`. Current behaviour
([`version-bump-dev.yml`](../../.github/workflows/version-bump-dev.yml)): open
`chore/bump-dev-vX.Y.Z`, wait for checks, **squash-merge** into `dev`.

If create/merge fails:

1. Settings → Actions → General → Workflow permissions → enable **Allow GitHub Actions to create and approve pull requests**
2. Confirm `dev` protection allows merge once `test-and-audit` + `gitleaks` are green (approving reviews optional on `dev` so the bot can land bumps without a second human account)

### Version Bump (dev) — `failed to push some refs` (rebase loop)

Concurrent pushes while an older direct-push bump still ran. Prefer the PR-based
flow above. If a stale job is stuck, cancel it and re-run **Version Bump (dev)**
on the latest `dev` tip.

### Release server — Go version mismatch

[`release-server.yml`](../../.github/workflows/release-server.yml) uses `go-version-file: betterdesk-server/go.mod` (same as Go Server CI).

## Pre-merge checklist (`dev` → `main`)

See [PRE_RELEASE_CHECKLIST.md](../PRE_RELEASE_CHECKLIST.md). Minimum before opening the release PR:

```bash
node scripts/bump-version.js --verify
cd web-nodejs && npm ci && npm audit --omit=dev --audit-level=moderate && npm run test:ci
gitleaks detect --source . --config .gitleaks.toml
bash scripts/check-no-sensitive-paths.sh
```
