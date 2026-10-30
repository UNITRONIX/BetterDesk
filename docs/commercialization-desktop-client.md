# Commercialization — desktop client / stock RustDesk

Billable sessions are created on the **BetterDesk server** for every connection that
uses this server’s signal/relay (`PrepareRelay` → `ActivateRelay` → `EndRelay`),
regardless of client SKU.

## Stock RustDesk

- No in-client work-report UI.
- When `BILLING_REQUIRE_WORK_REPORT` is enabled, ended sessions stay
  `pending_report` until an operator completes the report in
  **Commercialization → Sessions → Complete report**.

## BetterDesk-Client (Flutter / UNITRONIX/BetterDesk-Client)

Target UX (same model as Web Remote):

1. During a billable session: show package badge + “Work report” action (optional draft).
2. On disconnect: prompt for work summary (required when billing requires reports).
3. If the app closes without submit: leave the same `billing_sessions` row as
   `pending_report` (no duplicate). Operator finishes it in the panel Sessions tab.

### Panel / API hooks (already on BetterDesk server)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/billing/check?device_id=` | `package_name`, `remaining_minutes`, `allowed` |
| GET | `/api/billing/sessions/pending?device_id=` | latest `pending_report` for device |
| POST | `/api/billing/sessions/{id}/report` | `{ summary, category?, ticket_ref? }` |

Client builds should call these with the operator token used for Client API auth.
Implementation lives in the BetterDesk-Client repository (not this monorepo).
