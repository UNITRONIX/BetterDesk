# Contributor attributions

This register documents external reports, designs, tests, and code that
informed BetterDesk changes. It is intended to preserve contributor credit and
make provenance reviewable. It is not a copyright assignment or legal opinion.

## `@rathlinus` — console UX redesign

Contributor profile: <https://github.com/rathlinus>
Design discussion: [issue #493](https://github.com/UNITRONIX/BetterDesk/issues/493)
Redesign pull request: [PR #495](https://github.com/UNITRONIX/BetterDesk/pull/495)

Linus Rath (UI/UX designer) reworked the whole web console: every page, the
grouped sidebar (Devices / Support / People / Activity / Settings), the
device-list-first layout with side panels, per-topic Settings with search, and
light/dark support across all 26 locale files. The redesign lives on
`svelte-rewrite` and was **not** merged as a unit.

BetterDesk's **UX 3.6 beta** is an independent implementation in the existing
EJS/JavaScript/CSS stack that reuses his design system directly:

- `web-nodejs/public/css/ux36/palette.css` — his dark (neutral grey) and light
  (white-based) colour scales.
- `web-nodejs/public/css/ux36/tokens.css`, `base.css`, `components.css`,
  `shell.css` — his token set, IBM Plex typography, component styles and shell
  layout, taken from `web-nodejs/public/css/ui/` at the reference commit.
- `web-nodejs/public/fonts/IBMPlex*` — the fonts those sheets reference,
  under SIL OFL 1.1 (licence shipped as `IBMPlex-OFL.txt`).
- `web-nodejs/lib/consoleNav.js` — his grouped navigation model (sections,
  groups, active-page rules, the core/"More" split and the search keywords),
  adapted to the current routes and panel access; `buildSearchPages()` turns it
  into the global-search index.
- `web-nodejs/views/partials/ux36-topbar.ejs`, `ux36-sidebar.ejs` — his top bar
  and sidebar structure (search field, pre-paint restore, "More" rows), wired
  to the current element ids and permissions.
- `web-nodejs/public/js/ui-search.js` — his global search dialog (Ctrl+K,
  grouped results, keyboard handling), rewritten against this console's
  endpoints and permission flags.
- `web-nodejs/public/css/ux36/pages.css` — the console's own page classes mapped
  onto his page rhythm (page column, ruled sections, stat row, tab row, tables,
  workspaces); `legacy-bridge.css` keeps both token vocabularies on one scale.

The last pre-Svelte commit of the redesign is
[`d710bdbbb8541f325f6ecf8a24f7027187d475ba`](https://github.com/UNITRONIX/BetterDesk/commit/d710bdbbb8541f325f6ecf8a24f7027187d475ba)
and is the reference used for this port.

### Attribution rule for UX 3.6 commits

Every commit that ports, adapts, or refines elements of this redesign must keep
the credit in its body:

```text
Based-on: @rathlinus UX redesign (Refs #493, #495)
```

Unrelated commits must not carry that line. Do not describe the redesign as
merged — it is a design reference, not a merged branch.

## `@remoover`

Contributor profile: <https://github.com/remoover>
Collaboration discussion: [issue #346](https://github.com/UNITRONIX/BetterDesk/issues/346)

The original PR heads are preserved as public archive references. They were
created without force-push; repository rules should also prevent deletion or
rewriting of `archive/remoover/*` before release.

- [PR 266 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-266)
  — `884312e0088ddcf7d6511a9a76dfe90426ac3db4`
- [PR 271 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-271)
  — `33066571b75e5f36132ce0499777aee2333228e0`
- [PR 282 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-282)
  — `95d3cc8fcca1384ad7278329bd30d290f64cd199`
- [PR 283 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-283)
  — `aa12240445113ae6cb6df6898a1781b88af55592`
- [PR 348 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-348)
  — `52ce89088d1525c73f0903297601839add4f0078`
- [PR 357 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-357)
  — `1b0aa0de095ff55dd12be3dea6ae0b954ea49bc3`
- [PR 358 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-358)
  — `e2e4410b42f348a464226daa61db3078942e55a8`
- [PR 359 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-359)
  — `6dbd29ae1265651020079ea6aebc12d4f821d053`
- [PR 419 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-419)
  — `d9ea3949f6acf4b4c9762ba319dfa99cd11d74a3`
- [PR 420 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-420)
  — `6e74a4630eb235b0e5538a6faf085b29b0053f94`
- [PR 421 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-421)
  — `1cd91fd587ac46dd386cf1d786e31cae13755e5d`
- [PR 423 archive](https://github.com/UNITRONIX/BetterDesk/tree/archive/remoover/pr-423)
  — `a8b924b65768c37d58bbd370a03086d8acc4089e`

The following work informed the current BetterDesk changes:

- [#358](https://github.com/UNITRONIX/BetterDesk/pull/358) — controller-only
  outbound compatibility design, adapted with the explicit opt-in and
  relay-ticket safeguards described in this change.
- [#282](https://github.com/UNITRONIX/BetterDesk/pull/282) — browser relay
  framing, native WebSocket payload boundaries, and file-transfer session
  behavior. BetterDesk uses the framing portion and selected compatibility
  improvements; the full PR was not merged as a unit.
- [#348](https://github.com/UNITRONIX/BetterDesk/pull/348) — mixed transport
  behavior and preserving connected peer registrations during ID changes.
  BetterDesk uses separate, reviewable implementations for the peer rename and
  signal transport gate.
- [#357](https://github.com/UNITRONIX/BetterDesk/pull/357) — explicit
  `ENROLLMENT_MODE` precedence over stale persisted panel state.
- [#420](https://github.com/UNITRONIX/BetterDesk/pull/420) — Docker build
  cleanup was independently verified; the relevant Dockerfile state was
  already present locally.
- [#283](https://github.com/UNITRONIX/BetterDesk/pull/283) and
  [#423](https://github.com/UNITRONIX/BetterDesk/pull/423) — production
  reporting requirements and failure scenarios informed the design review;
  the live-session feature itself was not merged.

The following proposals remain intentionally unimplemented pending separate
security decisions:

- [#359](https://github.com/UNITRONIX/BetterDesk/pull/359) —
  disabling relay ticket enforcement for standalone relay processes.
- [#271](https://github.com/UNITRONIX/BetterDesk/pull/271) —
  upstream RustDesk client generator and GitHub Actions build pipeline.

## Rights and license treatment

The BetterDesk development branch is AGPL-3.0. Directly reused contributor
code remains subject to the applicable AGPL notices and the contributor's
copyright. No contributor is treated as having assigned copyright merely
because their issue or pull request was referenced.

When a future commit contains directly adapted code, the maintainer should:

1. preserve the contributor's authorship and provenance in the commit and
   release notes;
2. use `Co-authored-by` only after confirming the contributor's preferred
   identity and email address;
3. avoid claiming exclusive authorship unless a separate written agreement
   grants it;
4. include the relevant issue/PR links in the review record.

Bug reports, design proposals, production observations, and test scenarios are
credited as such and do not imply that the reporter authored unrelated
implementation code.
