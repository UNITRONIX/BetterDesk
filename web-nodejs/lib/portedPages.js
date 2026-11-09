/**
 * Old console pages that have switched over to the new console (web-ui):
 * the old URL redirects to the same URL under the new console's base, query
 * kept (the browser keeps the #hash), and the page's EJS view, script and
 * CSS are deleted in the same commit.
 *
 * An entry is an exact path, or "/path/*" for pages with an id in the path
 * (/organizations/7). Every entry is also in PORTED in
 * web-ui/src/lib/nav.ts, which lists all pages the new console has
 * (tests/portedPages.test.js checks it).
 */

'use strict';

const PORTED_PAGES = Object.freeze([]);

function isPortedPath(pathname, list = PORTED_PAGES) {
    return list.some((entry) => (entry.endsWith('/*')
        ? pathname.length > entry.length - 1 && pathname.startsWith(entry.slice(0, -1))
        : pathname === entry));
}

module.exports = { PORTED_PAGES, isPortedPath };
