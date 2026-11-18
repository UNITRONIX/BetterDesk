#!/usr/bin/env node
/**
 * Fail when docs/CONNECTION_PORTS.md disagrees with the port constants in the code.
 *
 * The cheat sheet is the operator's single source of truth, so it must not drift from the
 * Go server or the panel. Also fails when a document reintroduces 21120 as a live port:
 * that number appeared in an early design and never shipped.
 *
 * Run: node scripts/check-port-docs.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'docs', 'CONNECTION_PORTS.md');
const GO_CONSTANTS = path.join(ROOT, 'betterdesk-server', 'config', 'constants.go');
const NODE_CONFIG = path.join(ROOT, 'web-nodejs', 'config', 'config.js');

const failures = [];

function read(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (err) {
        failures.push(`cannot read ${path.relative(ROOT, file)}: ${err.message}`);
        return '';
    }
}

// --- Ports declared in code -------------------------------------------------------------
const goSource = read(GO_CONSTANTS);
const nodeSource = read(NODE_CONFIG);

function goPort(name) {
    const match = goSource.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
}

function nodePort(expression) {
    // `const GO_API_PORT_DEFAULT = 21114;` / `parseInt(...) || 21121;`
    const match = nodeSource.match(new RegExp(`${expression}[^;]*?(\\d{4,5})\\s*;`, 's'));
    return match ? Number(match[1]) : null;
}

const codePorts = {
    signal: goPort('DefaultSignalPort'),
    relay: goPort('DefaultRelayPort'),
    api: goPort('DefaultAPIPort'),
    nodeClientApi: nodePort('CLIENT_API_PORT_DEFAULT'),
};

if (codePorts.signal === null) failures.push('constants.go: DefaultSignalPort not found');
if (codePorts.relay === null) failures.push('constants.go: DefaultRelayPort not found');
if (codePorts.api === null) failures.push('constants.go: DefaultAPIPort not found');
if (codePorts.nodeClientApi === null) {
    failures.push('config.js: CLIENT_API_PORT_DEFAULT not found');
}

// --- Ports documented in the cheat sheet ------------------------------------------------
const doc = read(DOC);

if (doc) {
    // Every code-declared port must literally appear in the document.
    for (const [label, port] of Object.entries(codePorts)) {
        if (port === null) continue;
        if (!new RegExp(`\\b${port}\\b`).test(doc)) {
            failures.push(
                `docs/CONNECTION_PORTS.md does not mention ${label} port ${port} declared in code`
            );
        }
    }

    // The document must not claim a different signal/relay number.
    const signalRow = doc.match(/^\|\s*\*\*(\d{4,5})\*\*\s*\|\s*TCP \+ UDP/m);
    if (!signalRow) {
        failures.push('docs/CONNECTION_PORTS.md: signal row (TCP + UDP) not found');
    } else if (Number(signalRow[1]) !== codePorts.signal) {
        failures.push(
            `docs/CONNECTION_PORTS.md signal row says ${signalRow[1]}, code says ${codePorts.signal}`
        );
    }
}

// --- 21120 must never be presented as a live port ---------------------------------------
const SCAN = ['docs', 'web-nodejs', 'betterdesk-server', 'scripts'];
const STALE_PORT = /21120/;

function walk(dir) {
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
        return;
    }
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'private') {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
            continue;
        }
        if (!entry.isFile() || !/\.(md|js|sh|ps1|go)$/.test(entry.name)) continue;
        if (full.endsWith(path.join('scripts', 'check-port-docs.js'))) continue;
        // Vendored toolchains contain huge numbers of unrelated files.
        if (full.includes(`${path.sep}data${path.sep}go-toolchain${path.sep}`)) continue;

        let text = '';
        try {
            text = fs.readFileSync(full, 'utf8');
        } catch (_) {
            continue;
        }
        if (!STALE_PORT.test(text)) continue;

        // Allowed only where the text explains that the port does not exist, or in the
        // historical document that is explicitly marked as such.
        const historical =
            full.endsWith(path.join('docs', 'architecture', 'PORT_SECURITY.md')) ||
            /does not exist|never shipped|HISTORICAL|histor/i.test(text);
        if (!historical) {
            failures.push(
                `${path.relative(ROOT, full)} mentions port 21120, which does not exist in the code`
            );
        }
    }
}

for (const entry of SCAN) {
    walk(path.join(ROOT, entry));
}

if (failures.length) {
    console.error('Port documentation check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log(
    `Port docs OK (signal ${codePorts.signal}, relay ${codePorts.relay}, api ${codePorts.api}, ` +
        `client-api proxy ${codePorts.nodeClientApi})`
);
