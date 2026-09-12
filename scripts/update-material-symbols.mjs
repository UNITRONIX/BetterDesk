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
 * Writes:
 *   web-nodejs/public/fonts/MaterialSymbolsOutlined.woff2
 *   web-nodejs/public/fonts/MaterialSymbolsRounded.woff2
 *   web-nodejs/public/fonts/MATERIAL_SYMBOLS_VERSION.txt
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const WEB = path.join(REPO_ROOT, 'web-nodejs');
const FONTS_DIR = path.join(WEB, 'public', 'fonts');
const SCAN_ROOT = WEB;
const SCAN_EXTS = new Set(['.ejs', '.js', '.html', '.css', '.json']);
const CODEPOINTS_CACHE = path.join(__dirname, '.cache', 'MaterialSymbolsOutlined.codepoints');
const CODEPOINTS_URL =
    'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints';

/** Always include — may be set dynamically or only in docs/hints. */
const EXTRA_ICONS = [
    'monitoring',
    'widgets',
    'help',
    'help_outline',
    'error',
    'error_outline',
    'info',
    'warning',
    'check_circle',
    'radio_button_unchecked',
    'dns',
    'cloud',
    'security',
    'home_repair_service',
    'autorenew',
];

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Only lowercase Material-style ligatures inside icon spans. */
const LIGATURE_IN_ICON_SPAN =
    /material-icons(?:-round|-outlined)?\b[^>]*>\s*([a-z][a-z0-9_]{1,48})\s*</g;

const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;

function walkFiles(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'coverage') {
            continue;
        }
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walkFiles(full, out);
        } else if (SCAN_EXTS.has(path.extname(ent.name))) {
            out.push(full);
        }
    }
    return out;
}

async function loadValidIconNames() {
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

function collectCandidateIcons() {
    const icons = new Set(EXTRA_ICONS);
    for (const file of walkFiles(SCAN_ROOT)) {
        const text = fs.readFileSync(file, 'utf8');
        LIGATURE_IN_ICON_SPAN.lastIndex = 0;
        let m;
        while ((m = LIGATURE_IN_ICON_SPAN.exec(text)) !== null) {
            icons.add(m[1]);
        }
    }
    return icons;
}

function collectIcons(valid) {
    const candidates = collectCandidateIcons();
    const icons = [];
    const skipped = [];
    for (const name of candidates) {
        if (valid.has(name)) {
            icons.push(name);
        } else {
            skipped.push(name);
        }
    }
    icons.sort((a, b) => a.localeCompare(b));
    if (skipped.length) {
        console.log(
            `Skipped ${skipped.length} non-Material ligature candidates (e.g. ${skipped.slice(0, 8).join(', ')})`
        );
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

async function main() {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
    const valid = await loadValidIconNames();
    const icons = collectIcons(valid);
    if (icons.length < 20) {
        throw new Error(`Suspiciously few icons scanned (${icons.length}); aborting.`);
    }
    if (!icons.includes('monitoring')) {
        throw new Error('Required ligature "monitoring" missing from icon list.');
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

    for (const legacy of [
        'MaterialIcons-Regular.woff2',
        'MaterialIconsOutlined-Regular.woff2',
        'MaterialIconsRound-Regular.woff2',
    ]) {
        const p = path.join(FONTS_DIR, legacy);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`Removed legacy ${legacy}`);
        }
    }

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

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
