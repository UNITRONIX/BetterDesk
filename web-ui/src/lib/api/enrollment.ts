/**
 * The enrollment mode (routes/tokens.routes.js): which new devices may join.
 * Reading and changing it need enrollment.manage. Used by Device tokens
 * (where it is changed) and Client setup (which says what it means).
 */

import * as v from 'valibot';
import { api, request } from './client.ts';

export type EnrollmentMode = 'open' | 'managed' | 'locked';

const MODES: readonly string[] = ['open', 'managed', 'locked'];

export function isEnrollmentMode(m: unknown): m is EnrollmentMode {
	return typeof m === 'string' && MODES.includes(m);
}

/** The current mode; null when the server sends something else */
export async function getEnrollmentMode(signal?: AbortSignal): Promise<EnrollmentMode | null> {
	const out = await api(
		v.looseObject({ data: v.optional(v.nullable(v.looseObject({ mode: v.optional(v.unknown()) }))) }),
		'/api/panel/enrollment/mode',
		{ signal }
	);
	const mode = out.data?.mode;
	return isEnrollmentMode(mode) ? mode : null;
}

export async function setEnrollmentMode(mode: EnrollmentMode): Promise<void> {
	const out = await request('/api/panel/enrollment/mode', { method: 'PUT', body: { mode } });
	// The Go server answers a refused mode with text, which the console turns into success: false at 200
	if (out && typeof out === 'object' && (out as { success?: unknown }).success === false) {
		const err = (out as { error?: unknown }).error;
		throw new Error(typeof err === 'string' ? err : 'Request failed');
	}
}
