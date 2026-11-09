# BetterDesk third-party notices

This file is the release index for third-party material distributed with
BetterDesk. It complements, but does not replace, the license text and notices
required by each dependency.

## Source manifests

The authoritative dependency manifests for a release are:

- `betterdesk-server/go.mod` and `betterdesk-server/go.sum`
- `betterdesk-agent/go.mod` and `betterdesk-agent/go.sum`
- `betterdesk-support-agent/go.mod` and `betterdesk-support-agent/go.sum`
- `web-nodejs/package.json` and `web-nodejs/package-lock.json`
- `rdclient-desktop/package.json`, Cargo manifests, and
  `rdclient-desktop/vendor/wry/LICENSE.spdx`

The build/release process must archive resolved dependency lists from those
manifests with the matching source revision as an SBOM.

## Support Agent distribution

The Support Agent is built with Go and Fyne. Its code declares the dependency
licenses in [LICENSE](LICENSE); a release must also include the notices supplied
by Fyne and all resolved Go modules when they are distributed in a form that
requires them.

External system tools such as FFmpeg, GStreamer, PipeWire, xdg-desktop-portal,
xdotool, and ydotool are not silently relicensed by BetterDesk. A package may
only bundle one of them after its license, redistributability, provenance, and
security-update path are recorded in the release SBOM.

## Web console code

The Svelte console in `web-ui/` bundles these npm packages into the code the
browser loads. All are under the MIT License; each package ships its license,
and the resolved versions are in `web-ui/package-lock.json`.

- Svelte, copyright Svelte contributors
- SvelteKit (`@sveltejs/kit`, its client runtime), copyright SvelteKit
  contributors
- devalue (used by SvelteKit), copyright devalue contributors
- clsx (used by Svelte), copyright Luke Edwards
- Valibot, copyright Fabian Hiller
- xterm.js (`@xterm/xterm` and `@xterm/addon-fit`), copyright the xterm.js
  authors, SourceLair Private Company and Christopher Jeffrey
- qrcode-generator, copyright Kazuhiko Arase

Each build writes the full license text of every bundled package to
`licenses.txt` next to the code (served at `/app/licenses.txt`), and the build
fails when a bundled package is under a license other than MIT, ISC, 0BSD,
BSD-2-Clause, BSD-3-Clause or Apache-2.0 (`web-ui/vite-plugins/licenses.ts`).
Keep this list in step with that file.

The browser remote desktop client (`web-ui/static/rdclient/`) is served as
plain files, not bundled, so `licenses.txt` doesn't cover the libraries in its
`vendor/` folder:

- protobuf.js 7.6.5, BSD-3-Clause, copyright Daniel Wirtz
- TweetNaCl-js (`nacl.min.js`) and tweetnacl-util (`nacl-util.min.js`), public
  domain under the Unlicense
- JMuxer (`jmuxer.min.js`), MIT, copyright Samir Das

Build and test tools in `web-ui/package.json` (Vite, TypeScript, Vitest,
Playwright, ESLint and others) are not part of what the console serves.

## Web console fonts

The console self-hosts these fonts in `web-nodejs/public/fonts/`, and the
Svelte console the same files in `web-ui/static/fonts/`:

- IBM Plex Sans (Latin, Latin Extended, Cyrillic, Greek and Vietnamese
  subsets, variable weight) and IBM Plex Mono (Latin, Latin Extended and
  Cyrillic subsets, weights 400 and 600), SIL Open Font License 1.1,
  copyright IBM Corp. License text:
  `web-nodejs/public/fonts/IBMPlex-OFL.txt`.
- Material Symbols (subset), Apache License 2.0, see
  `web-nodejs/public/fonts/MATERIAL_SYMBOLS_VERSION.txt`.

Operating system marks in `web-nodejs/public/img/os-icons.svg` are from
Phosphor Icons (https://phosphoricons.com), MIT License, copyright Phosphor
Icons. The logos are trademarks of their owners and only name the operating
system a device runs.

Language flags in `web-nodejs/public/img/flags/` are from Twemoji
(https://github.com/jdecked/twemoji), taken from the `@twemoji/svg` 15.0.0
package. Graphics licensed under CC-BY 4.0
(https://creativecommons.org/licenses/by/4.0/), copyright Twitter, Inc and
other contributors. The files are renamed to the language code they stand
for; the drawings are unchanged.

The Svelte console has copies of the OS marks and the flags in
`web-ui/static/img/`.

## Compatibility components

Any desktop-client compatibility adapter is subject to
[support-agent-provenance.md](docs/important/support-agent-provenance.md).
Before distribution, its release record must include:

1. the compatibility specification revision;
2. a source-provenance review result;
3. generated-schema hashes;
4. third-party notices for its direct and transitive dependencies; and
5. a signed artifact checksum.

## Maintainer checklist

- Do not remove vendor license files from release inputs.
- Do not declare a dependency's license from memory; use its resolved package
  metadata and shipped notices.
- Do not add external source, generated protocol artifacts, or binary blobs
  without an entry in the SBOM and provenance review.
- Update this index when a release begins bundling a new runtime component.

