'use strict';

/**
 * Every relative require() in the deployable console tree must resolve to a
 * file that actually exists.
 *
 * Why this test exists (3.5.216 → 3.5.217, issue-class: update rollback):
 * `routes/pairing.routes.js` shipped with `require('../db')`, a module that has
 * never existed in this repository. The update itself applied cleanly, then the
 * post-update repair scan resolved `../db` to `db.js`, asked GitHub for
 * `web-nodejs/db.js`, got a 404 and declared a critical failure — which rolled
 * back the whole update to the previous SHA on every panel that tried to
 * install it.
 *
 * `node --check` cannot catch this (it only parses), and lazy `require()`
 * inside a route handler means even a boot smoke test can miss it. A static
 * resolution scan is the only cheap guard that covers lazily loaded modules.
 */

const fs = require('fs');
const path = require('path');
const { createConsoleDeployGraph } = require('../lib/consoleDeployGraph');

const CONSOLE_ROOT = path.join(__dirname, '..');

// Mirrors CONSOLE_SKIP_PATH_PREFIXES in lib/consoleDeployGraph.js plus the
// non-runtime directories that never reach a deployed instance.
const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'data', 'coverage']);

function walkJs(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            walkJs(full, out);
        } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('console require integrity', () => {
    const graph = createConsoleDeployGraph(CONSOLE_ROOT);

    test('every relative require resolves to an existing file', () => {
        const unresolved = [];

        for (const absFile of walkJs(CONSOLE_ROOT)) {
            const relFile = path.relative(CONSOLE_ROOT, absFile).split(path.sep).join('/');
            if (!graph.isConsoleDeployLocalPath(relFile)) continue;

            const source = fs.readFileSync(absFile, 'utf8');
            // Blank out comments first so documentation examples such as
            // require('./config/theme.json') are not reported as dependencies.
            const scannable = source
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^[ \t]*\/\/[^\n\r]*/gm, '');

            for (const match of scannable.matchAll(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
                const request = match[1];
                const resolved = graph.resolveConsoleRequire(relFile, request);
                if (!resolved) continue;
                if (fs.existsSync(path.join(CONSOLE_ROOT, resolved))) continue;
                unresolved.push(`${relFile}: require('${request}') -> ${resolved} (missing)`);
            }
        }

        expect(unresolved).toEqual([]);
    });

    // lazyRoute('./x') takes the module path as a string, so the require() scan
    // above cannot see it, and the module is only loaded on the first request —
    // never during boot. Verify those paths resolve on disk.
    test('every lazily mounted route module exists', () => {
        const indexPath = path.join(CONSOLE_ROOT, 'routes', 'index.js');
        const source = fs.readFileSync(indexPath, 'utf8');
        const missing = [];

        for (const match of source.matchAll(/lazyRoute\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
            const request = match[1];
            const resolved = graph.resolveConsoleRequire('routes/index.js', request);
            if (!resolved || !fs.existsSync(path.join(CONSOLE_ROOT, resolved))) {
                missing.push(`${request} -> ${resolved || '(unresolved)'}`);
            }
        }

        expect(missing).toEqual([]);
    });
});
