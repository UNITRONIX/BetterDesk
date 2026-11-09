/** Types for icon-names.mjs, which tests/unit/icons.test.ts imports */

/** Names that only arrive as data at run time */
export const EXTRA_ICONS: readonly string[];

/** The ICONS meaning table of src/lib/util/display.ts, read from its source */
export function readMeanings(): Record<string, string>;

/** The icon names written in one file's text (meanings not yet turned into glyphs) */
export function iconNamesIn(text: string, file: string): string[];

/** Every glyph name the console may draw, with the files that draw it */
export function collectCandidateIcons(): Map<string, Set<string>>;
