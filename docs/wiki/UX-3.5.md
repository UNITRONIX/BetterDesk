# UX 3.5

UX 3.5 is the standard and only supported console shell. It is enabled by
default for all users, including new installations. The legacy classic shell
and its shell switch are no longer available.

The console ignores legacy `?ui=classic` links and `bd_ui_shell=classic`
cookies, so existing users are migrated to UX 3.5 automatically. Surfaces are
**solid** (not glass/blur).

## What changes for you

- Full-height sidebar list + topbar instead of icon rail
- Same pages and permissions underneath
- Help panel still opens from **Help** (supporters + links)

If something looks wrong on a phone, update the panel — several 3.5.x fixes targeted mobile topbar/tabs.

## Developers

Layout and CSS live under `web-nodejs/views/partials/ux35-*.ejs`, `public/css/ux35*.css`, `public/js/ui-shell.js`. Acceptance checklists belong in PRs, not in this operator page.

---

## See also

- [[Web Console|Web-Console]]
- [[Home]]
