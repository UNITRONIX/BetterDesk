# UX 3.5

The console ships **UX 3.5** as the only layout. UX 3.6 beta was an opt-in
experiment and is **retired from the console UI** — the top-bar switch,
Settings → Console interface card, and beta CSS/JS load path are disconnected.
Stale `bd_ui_shell=ux36` cookies and `?ui=ux36` links resolve to UX 3.5.

| Shell | Status | Default |
|---|---|---|
| **UX 3.5** | stable | yes (only) |
| UX 3.6 | retired (assets kept for reference) | — |

Pages, routes, permissions and APIs are unchanged. Chrome work continues on
UX 3.5 (`web-nodejs/public/css/ux35.css`, `ux35-tokens.css`,
`views/partials/ux35-*`).

**Devices** uses a list-first layout: folders and device groups sit in a sticky
~210px rail beside the table (`web-nodejs/public/css/devices.css`), matching
the former UX 3.6 Devices arrangement.

## Preference API

`GET` / `POST /api/ui-shell` still exists for compatibility. Only `ux35` is
accepted; reads always report UX 3.5 and clear a stale beta cookie when present.

## Developers

| Area | Files |
|---|---|
| Shell resolution | `web-nodejs/lib/uiShell.js` (always `ux35`) |
| Layout | `web-nodejs/views/layouts/main.ejs` |
| Sidebar / top bar | `web-nodejs/views/partials/ux35-topbar.ejs`, `ux35-sidebar.ejs` |
| Client mirror | `web-nodejs/public/js/ui-shell.js`, `ux35-shell.js` |
| Preference API | `web-nodejs/routes/ui-shell.routes.js` |
| Retired beta assets | `web-nodejs/public/css/ux36/`, `ux36-shell.js`, `partials/ux36-*` (not loaded) |
| Tests | `web-nodejs/tests/ux36-shell.test.js`, `ux36-ui-shell.routes.test.js`, `ux35-ui-contract.test.js` |

Acceptance checklists belong in PRs, not in this operator page.

---

## See also

- [[Web Console|Web-Console]]
- [[Home]]
