#!/usr/bin/env node
/**
 * Fail when a console locale is missing a key that exists in en.json.
 *
 * The repo rule is that every key lives in all 26 locale files. This gate covers the
 * `pairing` namespace added with short-code pairing, and reports any other gap in the same
 * namespace so a later edit cannot silently drop a translation.
 *
 * Run: node scripts/check-pairing-i18n.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LANG_DIR = path.resolve(__dirname, '..', 'web-nodejs', 'lang');
const NAMESPACE = 'pairing';

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const files = fs
    .readdirSync(LANG_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();

if (!files.length) {
    console.error('error: no locale files found');
    process.exit(2);
}

const en = readJson(path.join(LANG_DIR, 'en.json'));
const expected = Object.keys(en[NAMESPACE] || {});

if (!expected.length) {
    console.error(`error: en.json has no "${NAMESPACE}" namespace`);
    process.exit(2);
}

const failures = [];
for (const name of files) {
    const locale = name.replace(/\.json$/, '');
    let data;
    try {
        data = readJson(path.join(LANG_DIR, name));
    } catch (err) {
        failures.push(`${name}: invalid JSON (${err.message})`);
        continue;
    }
    const namespace = data[NAMESPACE] || {};
    const missing = expected.filter((key) => !(key in namespace));
    if (missing.length) {
        failures.push(`${locale}: missing ${NAMESPACE}.${missing.join(', ')}`);
    }
    const empty = expected.filter((key) => (namespace[key] || '').trim() === '');
    if (empty.length && locale !== 'en') {
        // Documented fallback is "" (English key), but a new namespace should ship with
        // real translations; report rather than fail so an untranslated string is visible.
        console.warn(`warn: ${locale}: untranslated ${NAMESPACE}.${empty.join(', ')}`);
    }
    if (!data.nav || !data.nav.pairing) {
        failures.push(`${locale}: missing nav.pairing (sidebar entry)`);
    }
}

if (failures.length) {
    console.error('Pairing i18n parity failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

console.log(`Pairing i18n OK (${expected.length} keys x ${files.length} locales)`);
