/**
 * Settings changes that need a BetterDesk service restart
 * (services/restartCoordinator.js, routes/settings.routes.js). A save that
 * needs one answers with `restartRequired`; the person then restarts or
 * cancels, which puts the previous values back. Everything but the status
 * probe needs server.config.
 */

import * as v from 'valibot';
import { BoolLike, Text, api, wrapped } from './client.ts';

export const RestartItem = v.looseObject({
	id: v.string(),
	phase: v.optional(v.string(), 'pending'),
	changes: v.optional(v.array(v.looseObject({ key: Text, label: Text })), []),
	error: v.optional(v.nullable(v.string()), null)
});
export type RestartItem = v.InferOutput<typeof RestartItem>;

/** The signed-in person's restart that waits for an answer, or null */
export function getPendingRestart(signal?: AbortSignal) {
	return api(wrapped(v.optional(v.nullable(RestartItem), null)), '/api/settings/restart/pending', {
		signal
	});
}

/** Put the previous values back and drop the restart */
export function cancelRestart(id: string) {
	return api(wrapped(v.unknown()), '/api/settings/restart/cancel', { method: 'POST', body: { id } });
}

const Confirmed = wrapped(
	v.looseObject({
		phase: Text,
		failed: BoolLike,
		error: v.optional(v.nullable(v.string()), null),
		token: Text
	})
);

/** Restart the services; the token lets the status probe follow this restart */
export function confirmRestart(id: string) {
	return api(Confirmed, '/api/settings/restart/confirm', { method: 'POST', body: { id } });
}

/** The restart is over (ready or given up): forget it */
export function completeRestart(id: string) {
	return api(wrapped(v.unknown()), '/api/settings/restart/complete', { method: 'POST', body: { id } });
}

const Probe = v.looseObject({
	data: v.optional(
		v.looseObject({
			phase: Text,
			ready: BoolLike,
			error: v.optional(v.nullable(v.string()), null)
		}),
		{}
	)
});

/**
 * Public probe while the console restarts. Answers 503 while it starts up;
 * the caller treats every failure as "not back yet".
 */
export function restartStatus(id: string, token: string) {
	return api(Probe, '/api/settings/restart-status', {
		query: { job: id, token, _: Date.now() }
	});
}
