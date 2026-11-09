/**
 * Platform support (routes/cross-platform.routes.js, device.view): what the
 * registered devices run, and what the online ones reported they can do.
 * Both answers are bare objects of counts.
 */

import * as v from 'valibot';
import { api } from './client.ts';

/** { name: count }; counts that aren't numbers are dropped */
const Counts = v.pipe(
	v.optional(v.nullable(v.record(v.string(), v.unknown())), null),
	v.transform((o) => {
		const out: Record<string, number> = {};
		for (const [k, n] of Object.entries(o ?? {})) {
			const num = Number(n);
			if (Number.isFinite(num) && num > 0) out[k] = num;
		}
		return out;
	})
);

const Total = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => (Number.isFinite(Number(n)) ? Number(n) : 0))
	),
	0
);

export const Distribution = v.looseObject({
	total: Total,
	platforms: Counts,
	archs: Counts,
	versions: Counts
});
export type Distribution = v.InferOutput<typeof Distribution>;

export function getDistribution(signal?: AbortSignal): Promise<Distribution> {
	return api(Distribution, '/api/panel/cross-platform/distribution', { signal });
}

export const Protocols = v.looseObject({
	totalOnline: Total,
	codecs: Counts,
	features: Counts
});
export type Protocols = v.InferOutput<typeof Protocols>;

export function getProtocols(signal?: AbortSignal): Promise<Protocols> {
	return api(Protocols, '/api/panel/cross-platform/protocols', { signal });
}
