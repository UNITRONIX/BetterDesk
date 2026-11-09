// The component kit is a developer page: it exists only in the dev server.
// A production build answers 404 here, so the page is never reachable.
// ($app/env is SvelteKit 3's name for what was $app/environment.)
import { dev } from '$app/env';
import { error } from '@sveltejs/kit';

export function load(): void {
	if (!dev) error(404, 'Not Found');
}
