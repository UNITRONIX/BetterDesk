# BetterDesk console (web-ui)

The web console's frontend: Svelte 5 (runes), SvelteKit 3 as a single-page
app (adapter-static, `ssr = false`), Vite 8, TypeScript (strict). The
Express server in `web-nodejs/` serves the build and the JSON API.

While old and new pages run side by side, the app lives under `/app`
(`/app/devices` is the new `/devices`). Set `BD_UI_BASE=""` to build it
for the root.

## Commands

Dependencies live in a Docker volume, not on the host. From the repo root:

```sh
# install (once, or after package.json changes)
docker run --rm -v "$PWD/web-ui:/w" -v bd-webui-nm:/w/node_modules -w /w node:22-bookworm npx -y npm@11.6.2 ci
# any script
docker run --rm -v "$PWD/web-ui:/w" -v bd-webui-nm:/w/node_modules -w /w node:22-bookworm npm run <script>
```

Scripts: `build`, `check` (svelte-check, fails on warnings), `lint`
(ESLint and Prettier), `format`, `test` (Vitest), `e2e` (Playwright),
`dev` (Vite on :5173, proxies everything outside the base to Express on
:5000; set `BD_BACKEND=http://host.docker.internal:5000` in a container).

## Layout

```
src/
  app.html               loads /console-boot.js (theme, language, a11y before paint)
  routes/
    +layout.ts           ssr = false, trailingSlash = 'never'
    +layout.svelte       global CSS
    (console)/           pages behind sign-in, inside the shell
    (public)/            login, portal, downloads (no session)
  lib/
    api/                 client.ts (request, api, ApiError) and one file per area
    i18n/                i18n.svelte.ts (t, tf, plural, switchLanguage), format.ts (dates, numbers)
    state/               shared state as .svelte.ts modules with $state
    ui/                  components (see below)
    util/                pure helpers (display.ts, storage.ts)
    styles/              tokens.css and base.css (the only global CSS)
    nav.ts               link() for hrefs (adds the base)
```

Imports inside the app use `#lib/...` with the file extension
(`#lib/api/client.ts`, `#lib/ui/Button.svelte`). There is no barrel file.

## Rules

These come from the owner's design rules (IMPLEMENT-PROMPT-UI.md,
.ui-rework/GUIDE.md) and the rewrite brief. They are checked by lint,
svelte-check, the unit tests and the e2e suite.

Svelte:
- Runes only: `$state`, `$derived`, `$effect`, `$props`, `$bindable`.
  No `export let`, no stores. Shared state is a class with `$state`
  fields in a `.svelte.ts` module.
- `$effect` only for talking to the outside (DOM APIs, timers, sockets).
  Derive values with `$derived`.
- Event attributes (`onclick`), snippets (`{#snippet}` / `{@render}`),
  never `on:click` or slots.

Text:
- No visible string literals in markup; lint rejects them. Use `t('key')`
  for existing keys, `tf('key', 'English fallback')` for keys added since
  the last container restart. New keys go to all 26 languages through
  `.ui-rework/tools/i18n-set.mjs` (German with "Sie").
- Everything from users or devices is text: `{value}`, never `{@html}`
  (lint rejects it). Icons are `<Icon name="...">`.

Styles:
- Port the rules from `web-nodejs/public/css/ui/components.css` into the
  component's `<style>`, keeping the class names, so `.ui-rework/ui-kit.html`
  stays the visual reference. Tokens only (`var(--text)`, `var(--space-3)`),
  no new colours or sizes.
- No `!important`. No `style="..."` attributes in markup (CSP blocks
  them); computed geometry uses `style:width={px}` (goes through CSSOM).
- Logical properties (`margin-inline-start`, `inset-inline-end`,
  `text-align: start`) so right-to-left works.
- `:global()` only to style a child component's root or markup a snippet
  passed in, and scoped under the component's own class.
- Motion 150 ms or less (`var(--motion)`), none under reduced motion
  (the token is 0 then).

Components (`src/lib/ui/`):
- One file per component, PascalCase. Props typed with an interface;
  extend `HTMLButtonAttributes` etc. when the root is a native control.
- Every control has an accessible name. Icon-only buttons are
  `IconButton` with a `label`, only for close, row menu, copy, chevron.
- Popups (menus, dropdowns) register with `openPopup()` from
  `ui/popups.svelte.ts`: only one is open at a time.
- Focus: Escape closes the top dialog, sheet or menu and focus goes back
  to what opened it.
- Each component has unit tests in `tests/unit/ui/` for its states and
  keyboard behaviour. A test must fail when the behaviour it covers is
  broken; check that before relying on it.

API:
- One file per area in `lib/api/` with typed functions and valibot
  schemas for responses (`api(schema, path, opts)`). Keep request and
  response shapes as the server has them.
- The client adds the CSRF token to writes, retries reads, and turns 401
  into a sign-in redirect and 403 into a plain sentence.

Permissions:
- `can('device.ban')` from `state/session.svelte.ts` hides what would fail.
  The server checks every request; never use `can()` to widen anything.

Storage:
- `readPref`/`writePref` from `util/storage.ts` for per-browser
  preferences only (same keys as the old console). Never tokens or
  secrets.
