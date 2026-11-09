/**
 * Error pages the server decided on (web-nodejs/lib/webUi.js
 * sendErrorPage, lib/public/server-error.ts): the address keeps its URL and
 * the server's status; the app shows the error page there instead of the
 * route that would match. Only the address the page was loaded with.
 */

import type { Reroute } from '@sveltejs/kit/hooks';
import { base } from '#lib/nav.ts';
import { errorReroute, serverError } from '#lib/public/server-error.ts';

const browser = typeof document !== 'undefined';
const first = browser ? location.href : '';
const marked = browser ? serverError(document) : null;

export const reroute: Reroute = ({ url }) => errorReroute(url.href, first, marked, base);
