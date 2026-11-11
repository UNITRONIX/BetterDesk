# UX 3.5 / UX 3.6 (beta)

The console ships two layouts:

| Shell | Status | Default |
|---|---|---|
| **UX 3.5** | stable | yes |
| **UX 3.6** | beta, opt-in per browser | no |

Both render the same pages, routes, permissions and APIs. Only the chrome
(sidebar, spacing, layouts of Dashboard / Devices / Settings) differs.

## Switching

The switch sits in the **top bar**, next to the theme / refresh / language controls:

- In UX 3.5 the button is marked **BETA** and opens UX 3.6.
- In UX 3.6 the same button returns to UX 3.5 (the sidebar footer repeats it as
  **Switch back to UX 3.5**).

**Settings → General → Console interface** offers the same choice with a
description of each layout, and records the contributor credit.

The choice is stored in the `bd_ui_shell` cookie for that browser only — no
database migration, no effect on other operators.

Support deep link: `?ui=ux36` (or `?ui=ux35`) on any console page applies the
choice for that browser and survives later navigation.

## Global search

**Ctrl+K** (or **/** when no field has focus) opens one dialog that searches
pages, devices and people.

- Pages come from `window.BetterDesk.searchPages`, built per request in
  `lib/consoleNav.js` and filtered by panel access and RBAC. The index lists
  only pages the signed-in role may open, so it cannot be used to learn about
  a page it cannot reach. Entries carry extra search words, so old page names
  ("Keys", "DataGuard", "Fleet") still find the page after the regrouping.
- Devices and people are loaded on first use from `/api/devices` and
  `/api/users`, and only when `BetterDesk.searchCaps` says the session may call
  them. Results are cached for a minute.
- Every typed word must match somewhere. Arrow keys move, Enter opens, Escape
  closes and returns focus.
- The dialog is UX 3.6 only; UX 3.5 keeps its own menu filter.

Switching back is always possible; UX 3.5 is the fallback when the cookie is
missing or invalid.

## What UX 3.6 changes

This is not a recolouring of UX 3.5 — the beta loads the contributor's own
design system (`web-nodejs/public/css/ux36/`):

| Sheet | What it provides |
|---|---|
| `palette.css` | his neutral dark scale and white-based light theme |
| `tokens.css` | `--bg`, `--text`, `--rule`, `--control-h`, `--space-4…7`, layers |
| `base.css` | IBM Plex Sans/Mono, heading scale, page column, focus ring |
| `components.css` | buttons, fields, tables, menus, tags, notices, pagination |
| `shell.css` | top bar, grouped navigation, content column, mobile bar |
| `pages.css` | this console's page classes mapped onto his page rhythm |
| `legacy-bridge.css` | his token names ⇄ the v2 names page sheets still use |

- Sidebar grouped into **Devices**, **Support**, **People**, **Activity** and
  **Settings**, each section a `<ul>` with an icon and optional group labels.
  Every page keeps its old route and its old panel-access section, so roles see
  the same entries as before.
- Only the active group is expanded on first load; each group can be collapsed
  and the state is remembered for the session.
- Long sections keep their daily pages visible and put the rest under the
  section's own **More** row (with a count), the way the redesign's card sort
  ordered them. A section with a single extra page prints it directly — a
  "More" row that hides one link only adds a click.
- The menu filter sits above the groups and opens whatever it matched,
  including rows inside a "More" list.
- Width, collapsed groups, opened "More" rows and the scroll position are
  restored by an inline script **before the first paint**, so the menu never
  jumps on load.
- Devices uses a list-first layout: folders and device groups sit in a 210px
  rail beside the table, and device details open as a side sheet on desktop.
- Dashboard stats read as one ruled row; Settings uses a ruled topic row with
  `?tab=<topic>` deep links (older `#topic` links still work) and a settings
  search that also answers "that is a separate topic" when the words name
  another topic.
- Every other page keeps its markup and gets the same rhythm from
  `ux36/pages.css`: one content column, ruled sections instead of floating
  cards, stat numbers in one ruled row, page tabs as a ruled row, hairlines in
  tables. Chat and Remote stay full-bleed workspaces with one rule between
  columns.
- Design and interaction model: [@rathlinus](https://github.com/rathlinus)
  ([issue #493](https://github.com/UNITRONIX/BetterDesk/issues/493),
  [PR #495](https://github.com/UNITRONIX/BetterDesk/pull/495)), rebuilt in the
  current EJS/JavaScript/CSS stack — Svelte is **not** part of this change.

## What does not change

Pages and permissions, the Remote and SDK Studio surfaces, Desktop Mode embeds
(`?embed=1`), branding, wallpaper, custom theme colours, the Help panel,
notifications and every API.

The beta palette is skipped when the operator uses **custom** theme colours, so
their own colours always win.

## Developers

| Area | Files |
|---|---|
| Shell resolution | `web-nodejs/lib/uiShell.js` |
| Layout branching | `web-nodejs/views/layouts/main.ejs` |
| Grouped navigation model | `web-nodejs/lib/consoleNav.js` |
| Sidebar / top bar partials | `web-nodejs/views/partials/ux36-topbar.ejs`, `ux36-sidebar.ejs` |
| Beta design system | `web-nodejs/public/css/ux36/` (palette, tokens, base, components, shell, pages, legacy-bridge) |
| Shared switch chrome | `web-nodejs/public/css/ux36/shared-chrome.css` (both shells) |
| Fonts | `web-nodejs/public/fonts/IBMPlex*` (SIL OFL 1.1), `IBMPlex-OFL.txt` |
| Client behaviour | `web-nodejs/public/js/ui-shell.js` (switch, both shells), `web-nodejs/public/js/ux36-shell.js` (beta layout only) |
| Global search | `web-nodejs/public/js/ui-search.js`, index from `buildSearchPages()` in `web-nodejs/lib/consoleNav.js` |
| Preference API | `web-nodejs/routes/ui-shell.routes.js` (`GET`/`POST /api/ui-shell`) |
| Tests | `web-nodejs/tests/ux36-shell.test.js`, `ux36-pages.render.test.js`, `ux36-ui-shell.routes.test.js`, `ux35-ui-contract.test.js` |

The beta keeps the UX 3.5 token contract intact: `brandingService.js` still
generates `--ux35-*` and the wallpaper rules, and `legacy-bridge.css` translates
the contributor's scale onto the v2 names the remaining page sheets use, so no
page mixes two typographic or spacing systems.

Acceptance checklists belong in PRs, not in this operator page.

---

## See also

- [[Web Console|Web-Console]]
- [[Home]]
