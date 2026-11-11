'use strict';

/**
 * Every inline script needs the request nonce.
 *
 * The console sends a strict CSP: script-src is 'self' plus a per-request
 * nonce (middleware/security.js), with no 'unsafe-inline'. A <script> block
 * without the nonce is therefore blocked by the browser, silently: the page
 * renders and then does nothing.
 *
 * The public download portal hit exactly that — it stayed on "Loading
 * available installers…" forever because the fetch never ran.
 *
 * This test walks the views instead of listing known files, so a new page
 * cannot reintroduce it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const viewsDir = path.join(root, 'views');

/** Every .ejs file under views/, recursively. */
function viewFiles(dir = viewsDir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...viewFiles(full));
        else if (entry.name.endsWith('.ejs')) out.push(full);
    }
    return out;
}

const ANCHOR_SRC = /<script(?![^>]*\bsrc\s*=)[^>]*>/gi;

describe('inline scripts carry the CSP nonce', () => {
    it('finds the views to check', () => {
        assert.ok(viewFiles().length > 20, 'expected the console views');
    });

    it('never emits an inline <script> without a nonce', () => {
        const offenders = [];
        for (const file of viewFiles()) {
            const source = fs.readFileSync(file, 'utf8');
            const matches = source.match(ANCHOR_SRC) || [];
            for (const tag of matches) {
                if (!/\bnonce\s*=/.test(tag)) {
                    const line = source.slice(0, source.indexOf(tag)).split('\n').length;
                    offenders.push(`${path.relative(root, file)}:${line}`);
                }
            }
        }
        assert.deepStrictEqual(offenders, [],
            'inline <script> without nonce — the browser will block it under the CSP');
    });

    it('keeps the strict policy: a nonce is required, inline is not allowed', () => {
        const security = fs.readFileSync(path.join(root, 'middleware', 'security.js'), 'utf8');
        // The nonce is what the views interpolate; the policy must keep requiring it.
        assert.match(security, /res\.locals\.cspNonce\s*=\s*nonce/);
        assert.match(security, /scriptSrc:\s*scriptSources/);
        assert.match(security, /'nonce-\$\{nonce\}'/);
        assert.doesNotMatch(security, /scriptSources\.push\('unsafe-inline'\)/,
            "enabling 'unsafe-inline' would defeat the policy instead of fixing the script");
    });

    it('serves the download portal with a nonced script', () => {
        // The public portal uses no layout, so it is the easiest page to forget.
        const portal = fs.readFileSync(path.join(viewsDir, 'downloads-portal.ejs'), 'utf8');
        assert.match(portal, /<script nonce="<%= cspNonce %>">/);
        assert.match(portal, /\/api\/portal\/installers/);
    });
});
