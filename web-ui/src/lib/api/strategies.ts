/**
 * Access rules (RustDesk client settings per user group and device group;
 * routes/devices.routes.js "/api/panel/strategies"). The server calls them
 * strategies.
 */

import * as v from 'valibot';
import { api, wrapped, Text, Ok } from './client.ts';

const enc = encodeURIComponent;

/** The client settings a rule can set, in the order the sheet lists them */
export const STRATEGY_PERMISSIONS = [
	{ key: 'enable-file-transfer', labelKey: 'devices.strategy_perm_file_transfer' },
	{ key: 'disable-clipboard', labelKey: 'devices.strategy_perm_disable_clipboard' },
	{ key: 'enable-clipboard', labelKey: 'devices.strategy_perm_enable_clipboard' },
	{ key: 'enable-audio', labelKey: 'devices.strategy_perm_audio' },
	{ key: 'enable-tunnel', labelKey: 'devices.strategy_perm_tunnel' },
	{ key: 'enable-camera', labelKey: 'devices.strategy_perm_camera' },
	{ key: 'enable-remote-restart', labelKey: 'devices.strategy_perm_restart' },
	{ key: 'enable-block-input', labelKey: 'devices.strategy_perm_block_input' }
] as const;

const Permissions = v.pipe(
	v.optional(v.nullable(v.record(v.string(), v.unknown())), null),
	v.transform((p) => {
		const out: Record<string, 'Y' | 'N'> = {};
		for (const [k, val] of Object.entries(p ?? {})) {
			if (val === 'Y' || val === true) out[k] = 'Y';
			else if (val === 'N' || val === false) out[k] = 'N';
		}
		return out;
	})
);

export const Strategy = v.looseObject({
	guid: v.string(),
	name: Text,
	user_group_guid: Text,
	device_group_guid: Text,
	enabled: v.pipe(
		v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), null),
		// A rule without the field is on, as the old console read it
		v.transform((b) => !(b === false || b === 0 || b === '0' || b === 'false'))
	),
	permissions: Permissions
});
export type Strategy = v.InferOutput<typeof Strategy>;

const StrList = v.pipe(
	v.optional(v.nullable(v.array(v.string())), null),
	v.transform((a) => a ?? [])
);
const Count = v.pipe(
	v.optional(v.nullable(v.number()), null),
	v.transform((n) => n ?? 0)
);

export const StrategyDetail = v.looseObject({
	...Strategy.entries,
	peer_count: Count,
	user_count: Count,
	device_group_count: Count,
	peer_ids: StrList,
	user_names: StrList,
	group_guids: StrList
});
export type StrategyDetail = v.InferOutput<typeof StrategyDetail>;

export async function listStrategies(signal?: AbortSignal): Promise<Strategy[]> {
	const out = await api(wrapped(v.looseObject({ strategies: v.array(Strategy) })), '/api/panel/strategies', {
		signal
	});
	return out.strategies;
}

/** One rule with where it is applied */
export async function getStrategy(guid: string, signal?: AbortSignal): Promise<StrategyDetail> {
	const out = await api(
		wrapped(v.looseObject({ strategy: StrategyDetail })),
		`/api/panel/strategies/${enc(guid)}`,
		{
			signal
		}
	);
	return out.strategy;
}

export interface StrategyInput {
	name: string;
	user_group_guid: string;
	device_group_guid: string;
	enabled: boolean;
	permissions: Record<string, 'Y' | 'N'>;
}

export function createStrategy(s: StrategyInput) {
	return api(Ok, '/api/panel/strategies', { method: 'POST', body: s });
}

export function updateStrategy(guid: string, s: StrategyInput) {
	return api(Ok, `/api/panel/strategies/${enc(guid)}`, { method: 'PATCH', body: s });
}

export function deleteStrategy(guid: string) {
	return api(Ok, `/api/panel/strategies/${enc(guid)}`, { method: 'DELETE' });
}

/** Apply a rule to devices, users and device groups (at least one) */
export function assignStrategy(guid: string, to: { peers: string[]; users: string[]; groups: string[] }) {
	return api(Ok, `/api/panel/strategies/${enc(guid)}/assign`, { method: 'POST', body: to });
}
