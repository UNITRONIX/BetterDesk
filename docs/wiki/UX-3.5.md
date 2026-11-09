# UX 3.5 / UX 3.6 (beta)

The console ships two layouts:

| Shell | Status | Default |
|---|---|---|
| **UX 3.5** | stable | yes |
| **UX 3.6** | beta, opt-in per browser | no |

Both render the same pages, routes, permissions and APIs. Only the chrome
(sidebar, spacing, layouts of Dashboard / Devices / Settings) differs.

## Switching

**Settings → General → Console interface** offers the two layouts. The choice is
stored in the `bd_ui_shell` cookie for that browser only — no database
migration, no effect on other operators.

Support deep link: `?ui=ux36` (or `?ui=ux35`) on any console page applies the
choice for that browser and survives later navigation.

Switching back is always possible; UX 3.5 is the fallback when the cookie is
missing or invalid.

## What UX 3.6 changes

- Sidebar grouped into **Devices**, **Support**, **People**, **Activity** and
  **Settings** instead of a flat list. Every page keeps its old route and its
  old panel-access section, so roles see the same entries as before.
- Only the active group is expanded on first load; each group can be collapsed
  and the state is remembered for the session.
- Devices uses a list-first layout: folders and device groups sit in a rail
  beside the table, and device details open as a side sheet on desktop.
- Settings keeps its per-topic tabs and search, with `?tab=<topic>` deep links
  (older `#topic` links still work).
- Layout is modelled on the community redesign by
  [@rathlinus](https://github.com/rathlinus)
  ([issue #493](https://github.com/UNITRONIX/BetterDesk/issues/493),
  [PR #495](https://github.com/UNITRONIX/BetterDesk/pull/495)) and rebuilt in the
  current EJS/JavaScript/CSS stack — Svelte is **not** part of this change.

## What does not change

Pages and permissions, the Remote and SDK Studio surfaces, Desktop Mode embeds
(`?embed=1`), branding, wallpaper, fonts, themes (light/dark/custom), the Help
panel, notifications and every API.

## Developers

| Area | Files |
|---|---|
| Shell resolution | `web-nodejs/lib/uiShell.js` |
| Layout branching | `web-nodejs/views/layouts/main.ejs` |
| Grouped navigation model | `web-nodejs/lib/consoleNav.js` |
| Sidebar partial | `web-nodejs/views/partials/ux36-sidebar.ejs` |
| Styles | `web-nodejs/public/css/ux36.css` (layered on `ux35.css`) |
| Client behaviour | `web-nodejs/public/js/ux36-shell.js` |
| Preference API | `web-nodejs/routes/ui-shell.routes.js` (`GET`/`POST /api/ui-shell`) |
| Tests | `web-nodejs/tests/ux36-shell.test.js`, `ux35-ui-contract.test.js` |

UX 3.6 must never fork the UX 3.5 token contract (`--ux35-*`): themes, branding
and wallpaper are generated for those names by `services/brandingService.js`.

Acceptance checklists belong in PRs, not in this operator page.

---

## See also

- [[Web Console|Web-Console]]
- [[Home]]
