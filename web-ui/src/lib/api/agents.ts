/**
 * Support agent releases (routes/phase4_5.routes.js): the signed agent
 * release this server imported from GitHub and serves on /portal.
 * Reading and importing need enrollment.manage.
 */

import * as v from 'valibot';
import { api } from './client.ts';

export const AgentRelease = v.looseObject({
	tag: v.optional(v.nullable(v.string()), ''),
	imported_at: v.optional(v.nullable(v.union([v.string(), v.number()])), null),
	manifest: v.optional(
		v.nullable(v.looseObject({ assets: v.optional(v.nullable(v.array(v.unknown()))) })),
		null
	)
});
export type AgentRelease = v.InferOutput<typeof AgentRelease>;

/** Imported releases, the newest first */
export async function listReleases(signal?: AbortSignal): Promise<AgentRelease[]> {
	const out = await api(
		v.looseObject({ releases: v.optional(v.nullable(v.array(AgentRelease))) }),
		'/api/agent-releases',
		{
			signal
		}
	);
	return out.releases ?? [];
}

/** Download and check the latest signed release; resolves its tag */
export async function importLatest(): Promise<string> {
	const out = await api(
		v.looseObject({ tag: v.optional(v.nullable(v.string())) }),
		'/api/agent-releases/sync',
		{
			method: 'POST',
			body: {}
		}
	);
	return out.tag ?? '';
}

/** Installers in a release */
export function installerCount(r: AgentRelease): number {
	return r.manifest?.assets?.length ?? 0;
}
