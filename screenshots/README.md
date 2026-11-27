# Screenshots

Console screenshots for the README and wiki live in [`generated/`](generated/).

## Current set (UX 3.5 dark)

| File | View |
|------|------|
| `login-dark.png` | Sign-in |
| `dashboard-dark.png` | Dashboard |
| `devices-list-dark.png` | Devices list (list-first rail) |
| `device-details-dark.png` | Devices detail / selected row view |
| `remote-dark.png` | Remote Desktop client |
| `settings-updates-dark.png` | Settings → Updates |

Use **fictional** device names (e.g. `BD-DEMO-*`) so real hostnames never appear in docs.

## Capture locally

1. Run the web console (`web-nodejs`) and, for a populated Devices list, the Go server with a shared SQLite DB.
2. Seed demo peers into the Go `peers` table (status `ONLINE`/`OFFLINE`, hostnames, platforms).
3. Capture at **1920×1080** dark theme / English:

```bash
# requires Playwright Chromium in .tmp-playwright (gitignored)
node scripts/capture-readme-screens.mjs
```

Env overrides: `BD_URL`, `BD_USER`, `BD_PASS`.

Marketing hero / feature banners: [`docs/assets/readme/`](../docs/assets/readme/).
