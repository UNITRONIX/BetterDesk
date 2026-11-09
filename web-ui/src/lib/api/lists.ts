/**
 * Lists the server sends in more than one shape: bare, or under a key
 * ({ organizations }, { entries }, { rules }, { data }). Used by the Rules
 * pages' API files; a candidate for client.ts.
 */

import * as v from 'valibot';

/** The first array found (bare, or under one of `keys`), each item checked; null or no key is an empty list */
export function listIn<S extends v.GenericSchema>(item: S, ...keys: string[]) {
	return v.pipe(
		v.unknown(),
		v.transform((o): unknown[] => {
			if (Array.isArray(o)) return o;
			if (o && typeof o === 'object') {
				for (const k of keys) {
					const x = (o as Record<string, unknown>)[k];
					if (Array.isArray(x)) return x;
				}
			}
			return [];
		}),
		v.array(item)
	);
}

/**
 * Text that may come as null, a number or not at all, always a string in
 * the output (client.ts Text leaves the key optional in the type)
 */
export const Str = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);

/** SQLite booleans (true/false, 1/0, "1"/"0"); missing is false */
export const Bool = v.optional(
	v.pipe(
		v.nullable(v.union([v.boolean(), v.number(), v.string()])),
		v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
	),
	false
);
