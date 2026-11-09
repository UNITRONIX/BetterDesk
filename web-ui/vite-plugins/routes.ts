/**
 * Puts routes.json next to the build's index.html: every page of the app with
 * the pattern SvelteKit matches its path against (groups left out, [param],
 * [[optional]] and [...rest] as SvelteKit reads them). The server
 * (web-nodejs/lib/webUi.js) answers an address that matches none of them
 * with status 404, and the app shows its not-found page there.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, Builder } from '@sveltejs/kit';

export interface RouteEntry {
	/** The route's folder under src/routes, e.g. "/(console)/policies/[[orgId]]" */
	id: string;
	/** RegExp source matched against the decoded path without the base */
	pattern: string;
}

export function routeEntries(routes: Builder['routes']): RouteEntry[] {
	return routes.map((r) => ({ id: r.id, pattern: r.pattern.source }));
}

/** The adapter, then routes.json in its output folder (the adapter empties it first) */
export function withRoutesList(adapter: Adapter, dir: string): Adapter {
	return {
		...adapter,
		async adapt(builder) {
			await adapter.adapt(builder);
			const list = routeEntries(builder.routes);
			fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify(list, null, '\t') + '\n');
			builder.log.minor(`Wrote routes.json (${list.length} pages)`);
		}
	};
}
