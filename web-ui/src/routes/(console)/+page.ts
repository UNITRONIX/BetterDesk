/**
 * The overview's first requests start here, beside the console's own start
 * (the layout waits for the session before it draws a page), so the counts
 * and the client values are on their way while the console starts. The
 * page uses each answer once; a failed one is asked for again there.
 * Requests that need a permission start in the page, once it knows who is
 * signed in.
 */
import { getClientConfig, getDeviceStats, getServerStatus } from '#lib/api/dashboard.ts';
import { readClientHost } from '#lib/devices-area/dashboard.ts';
import type { PageLoad } from './$types';

const quiet = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export const load: PageLoad = () => ({
	early: {
		stats: quiet(getDeviceStats()),
		status: quiet(getServerStatus()),
		config: quiet(getClientConfig(readClientHost()))
	}
});
