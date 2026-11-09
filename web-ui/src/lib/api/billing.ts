/**
 * Support packages and contracts (routes/commercialization.routes.js).
 * Only what the device list needs so far (a package for a device group);
 * the billing pages add the rest when they are ported. These routes answer
 * without the { success, data } envelope.
 */

import * as v from 'valibot';
import { api, Text } from './client.ts';

export const Package = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Text,
	included_minutes: v.optional(v.nullable(v.number())),
	currency: Text
});
export type Package = v.InferOutput<typeof Package>;

const PackageList = v.pipe(
	v.looseObject({
		packages: v.optional(v.array(Package)),
		data: v.optional(v.looseObject({ packages: v.optional(v.array(Package)) }))
	}),
	v.transform((o) => o.data?.packages ?? o.packages ?? [])
);

const Any = v.unknown();

/** Needs billing.view */
export function listPackages(signal?: AbortSignal) {
	return api(PackageList, '/api/panel/billing/packages', { signal });
}

export interface PackageInput {
	name: string;
	description: string;
	included_minutes: number;
	overage_rate: number;
	currency: string;
}

/** Needs billing.manage */
export function createPackage(p: PackageInput) {
	return api(Any, '/api/panel/billing/packages', { method: 'POST', body: p });
}

/** Attach a package to a device group (needs billing.manage) */
export function assignPackageToGroup(groupGuid: string, packageId: string) {
	return api(Any, '/api/panel/billing/contracts', {
		method: 'POST',
		body: { target_type: 'device_group', target_key: groupGuid, package_id: packageId }
	});
}
