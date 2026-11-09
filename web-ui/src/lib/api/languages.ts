/**
 * The translations page (routes/languages.routes.js, routes/i18n.routes.js).
 * The list and the missing keys need server.config; the texts of a
 * language are the same merged strings the console loads. These routes
 * answer without the { success, data } envelope, except /api/i18n.
 */

import * as v from 'valibot';
import { BoolLike, Text, api } from './client.ts';

const Count = v.pipe(
	v.optional(v.nullable(v.number())),
	v.transform((n) => n ?? 0)
);

export const LanguageRow = v.looseObject({
	code: v.string(),
	name: Text,
	native: Text,
	rtl: BoolLike,
	needs_review: BoolLike,
	is_reference: BoolLike,
	total_keys: Count,
	missing_keys: Count,
	extra_keys: Count,
	empty_keys: Count,
	coverage: v.optional(v.nullable(v.number()), null),
	error: v.optional(v.nullable(v.string()), null)
});
export type LanguageRow = v.InferOutput<typeof LanguageRow>;

const LanguageList = v.looseObject({
	languages: v.optional(v.array(LanguageRow), []),
	refKeyCount: Count
});

export function listLanguages(signal?: AbortSignal) {
	return api(LanguageList, '/api/panel/languages', { signal });
}

export type Texts = { [key: string]: string | number | boolean | null | Texts };
const TextTree: v.GenericSchema<Texts> = v.record(
	v.string(),
	v.union([v.string(), v.number(), v.boolean(), v.null(), v.lazy(() => TextTree)])
);

/** Every text of a language (merged over English by the server) */
export function getTexts(code: string, signal?: AbortSignal) {
	return api(
		v.pipe(
			v.looseObject({ data: v.optional(TextTree, {}) }),
			v.transform((o) => o.data)
		),
		`/api/i18n/translations/${encodeURIComponent(code)}`,
		{ signal }
	);
}

const Missing = v.looseObject({
	missing: v.optional(v.array(v.looseObject({ key: v.string(), en_value: Text })), [])
});
export type Missing = v.InferOutput<typeof Missing>;

/** The keys the language file lacks (the merged texts fill them with English) */
export function getMissing(code: string, signal?: AbortSignal) {
	return api(Missing, `/api/panel/languages/${encodeURIComponent(code)}/missing`, { signal });
}
