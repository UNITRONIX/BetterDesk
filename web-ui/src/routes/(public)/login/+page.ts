/**
 * The sign-in page's values (branding, languages, CSRF token) start here,
 * beside the strings the layout waits for. A failed request is asked for
 * again by the page.
 */
import { getLoginPage } from '#lib/api/signin.ts';
import type { PageLoad } from './$types';

export const load: PageLoad = () => ({ early: getLoginPage().catch(() => null) });
