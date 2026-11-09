#!/usr/bin/env node
/**
 * Maintainer-only: refresh self-hosted Material Symbols subsets for the console.
 *
 * Does NOT run in the panel / updateService. Download happens only on the
 * developer machine (Google Fonts CSS API → gstatic woff2).
 *
 * Usage (from repo root):
 *   node scripts/update-material-symbols.mjs
 *
 * The icon names come from web-ui/scripts/icon-names.mjs, which scans the
 * console (web-ui/src and the remote viewer's scripts in web-ui/static) and
 * the icons the server sends it (web-nodejs, such as the navigation in
 * lib/consoleNav.js). Its header says which ways of writing a name it reads.
 * web-ui/tests/unit/icons.test.ts checks the font against the same scan.
 *
 * Writes into web-ui/static/fonts/:
 *   MaterialSymbolsOutlined.woff2, MaterialSymbolsRounded.woff2,
 *   MATERIAL_SYMBOLS_VERSION.txt
 * and the ?v= cache busters in web-ui's base.css and src/app.html.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectCandidateIcons } from '../web-ui/scripts/icon-names.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const UI = path.join(REPO_ROOT, 'web-ui');
const FONTS_DIR = path.join(UI, 'static', 'fonts');
const CODEPOINTS_CACHE = path.join(__dirname, '.cache', 'MaterialSymbolsOutlined.codepoints');
const CODEPOINTS_URL =
    'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;

export async function loadValidIconNames() {
    fs.mkdirSync(path.dirname(CODEPOINTS_CACHE), { recursive: true });
    if (!fs.existsSync(CODEPOINTS_CACHE)) {
        console.log('Downloading Material Symbols codepoints…');
        const res = await fetch(CODEPOINTS_URL, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) {
            throw new Error(`Failed to fetch codepoints: HTTP ${res.status}`);
        }
        fs.writeFileSync(CODEPOINTS_CACHE, await res.text(), 'utf8');
    }
    const valid = new Set();
    for (const line of fs.readFileSync(CODEPOINTS_CACHE, 'utf8').split(/\r?\n/)) {
        const name = line.split(/\s+/)[0];
        if (name && NAME_RE.test(name)) {
            valid.add(name);
        }
    }
    if (valid.size < 1000) {
        throw new Error(`Codepoints look incomplete (${valid.size} names).`);
    }
    return valid;
}

/** Candidates that are real Material Symbols names, sorted; the rest is reported. */
export function collectIcons(valid, candidates = collectCandidateIcons()) {
    const icons = [];
    const skipped = [];
    for (const [name, files] of candidates) {
        if (valid.has(name)) {
            icons.push(name);
        } else {
            skipped.push(`${name} (${[...files].join(', ')})`);
        }
    }
    icons.sort((a, b) => a.localeCompare(b));
    if (skipped.length) {
        // An icon place holds a name the font doesn't know: a typo, or a word the scan shouldn't read.
        // web-ui's icons.test.ts fails until it is fixed.
        console.warn(`Not Material Symbols names, left out:\n  ${skipped.join('\n  ')}`);
    }
    return icons;
}

async function fetchText(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/css,*/*;q=0.1',
        },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return res.text();
}

async function fetchBinary(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'font/woff2,*/*;q=0.1',
        },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

function extractWoff2Url(css) {
    // Subset kits often use /l/font?kit=… (no .woff2 suffix); full families use *.woff2.
    const m = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/);
    if (!m) {
        throw new Error(
            'No fonts.gstatic.com URL in CSS response. ' +
                'Google may have changed the API; inspect the CSS manually.\n' +
                css.slice(0, 500)
        );
    }
    return m[1];
}

function sha256(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildCssUrl(familyApiName, icons) {
    // Google expects unencoded "+" for spaces in family; avoid URLSearchParams
    // which encodes "+" as "%2B" and breaks the CSS2 API.
    const family = `${familyApiName}:opsz,wght,FILL,GRAD@24,400,0,0`;
    const iconNames = encodeURIComponent(icons.join(','));
    return `https://fonts.googleapis.com/css2?family=${family}&icon_names=${iconNames}&display=block`;
}

async function downloadFamily(familyLabel, familyApiName, outName, icons) {
    const cssUrl = buildCssUrl(familyApiName, icons);
    console.log(`Fetching CSS for ${familyLabel} (${icons.length} icons)…`);
    console.log(`  ${cssUrl.slice(0, 140)}…`);
    const css = await fetchText(cssUrl);
    const fontUrl = extractWoff2Url(css);
    console.log(`  woff2: ${fontUrl}`);
    const buf = await fetchBinary(fontUrl);
    const outPath = path.join(FONTS_DIR, outName);
    fs.writeFileSync(outPath, buf);
    const hash = sha256(buf);
    console.log(`  wrote ${outName} (${buf.length} bytes, sha256=${hash})`);
    return { outName, size: buf.length, sha256: hash, fontUrl, cssUrl };
}

function updateFontCacheBusters(outlined) {
    // base.css declares the font and app.html preloads it
    for (const basePath of [
        path.join(UI, 'src', 'lib', 'styles', 'base.css'),
        path.join(UI, 'src', 'app.html'),
    ]) {
        const base = fs.readFileSync(basePath, 'utf8').replace(
            /MaterialSymbolsOutlined\.woff2(?:\?v=[^'")]+)?/g,
            `MaterialSymbolsOutlined.woff2?v=${outlined.sha256.slice(0, 12)}`
        );
        fs.writeFileSync(basePath, base, 'utf8');
    }
}

async function main() {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
    const valid = await loadValidIconNames();
    const icons = collectIcons(valid);
    if (icons.length < 20) {
        throw new Error(`Suspiciously few icons scanned (${icons.length}); aborting.`);
    }
    if (!icons.includes('expand_more') || !icons.includes('devices')) {
        throw new Error('The scan missed expand_more or devices; check web-ui/scripts/icon-names.mjs.');
    }

    console.log(`Collected ${icons.length} unique Material Symbols ligatures.`);

    const outlined = await downloadFamily(
        'Outlined',
        'Material+Symbols+Outlined',
        'MaterialSymbolsOutlined.woff2',
        icons
    );
    const rounded = await downloadFamily(
        'Rounded',
        'Material+Symbols+Rounded',
        'MaterialSymbolsRounded.woff2',
        icons
    );
    updateFontCacheBusters(outlined);

    const versionPath = path.join(FONTS_DIR, 'MATERIAL_SYMBOLS_VERSION.txt');
    const lines = [
        'BetterDesk self-hosted Material Symbols (Apache-2.0)',
        'Upstream: https://github.com/google/material-design-icons (variablefont / Google Fonts CSS API)',
        'License: Apache License 2.0',
        `Generated: ${new Date().toISOString()}`,
        `Icon count: ${icons.length}`,
        '',
        `File: ${outlined.outName}`,
        `  size: ${outlined.size}`,
        `  sha256: ${outlined.sha256}`,
        `  source: ${outlined.fontUrl}`,
        '',
        `File: ${rounded.outName}`,
        `  size: ${rounded.size}`,
        `  sha256: ${rounded.sha256}`,
        `  source: ${rounded.fontUrl}`,
        '',
        'Axes instance: opsz=24, wght=400, FILL=0, GRAD=0',
        'display=block',
        '',
        'Icons (alphabetical):',
        icons.join(','),
        '',
    ];
    fs.writeFileSync(versionPath, lines.join('\n'), 'utf8');
    console.log(`Wrote ${path.relative(REPO_ROOT, versionPath)}`);
    console.log('Done. Review hashes, then commit fonts + CSS together.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
