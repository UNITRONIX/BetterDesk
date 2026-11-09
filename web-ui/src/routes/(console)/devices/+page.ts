/**
 * The device list's first requests start here. The console layout waits for
 * the session before it draws a page, and a page's load runs beside that, so
 * the list's data is on its way while the console starts. The page uses each
 * answer once, for its first load (a failed one is asked for again there).
 */
import { listDeviceGroups, listDevices, listFolders, listTags } from '#lib/api/devices.ts';
import { PREF_SHOW_DELETED } from '#lib/devices/model.ts';
import { readPref } from '#lib/util/storage.ts';
import type { PageLoad } from './$types';

const quiet = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export const load: PageLoad = () => ({
	early: {
		devices: quiet(listDevices({ includeDeleted: readPref(PREF_SHOW_DELETED) === '1' })),
		folders: quiet(listFolders()),
		groups: quiet(listDeviceGroups()),
		tags: quiet(listTags())
	}
});
