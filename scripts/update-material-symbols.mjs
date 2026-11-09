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
 * Names come from icon spans, Utils.ICONS and other icon maps, `icon` properties
 * and variables, and CSS `content` ligatures, in the old console (web-nodejs)
 * and the new one (web-ui/src: `<Icon name="…">`, `icon="…"`, `icon={…}`). collectCandidateIcons() and
 * collectIcons() are exported so a check can compare the list with the font.
 *
 * Writes the same files into both consoles' font folders
 * (web-nodejs/public/fonts/ and web-ui/static/fonts/):
 *   MaterialSymbolsOutlined.woff2, MaterialSymbolsRounded.woff2,
 *   MATERIAL_SYMBOLS_VERSION.txt
 * and the ?v= cache busters in both consoles' CSS and web-ui/src/app.html.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const WEB = path.join(REPO_ROOT, 'web-nodejs');
const UI = path.join(REPO_ROOT, 'web-ui');
const FONTS_DIR = path.join(WEB, 'public', 'fonts');
const UI_FONTS_DIR = path.join(UI, 'static', 'fonts');
const SCAN_ROOTS = [WEB, path.join(UI, 'src')];
const SCAN_EXTS = new Set(['.ejs', '.js', '.html', '.css', '.json', '.svelte', '.ts']);
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
    /* Used in markup; keep even if a scan pattern misses them */
    'label',
    'assignment',
    'my_location',
];

const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Only lowercase Material-style ligatures inside icon spans. */
const LIGATURE_IN_ICON_SPAN =
    /material-icons(?:-round|-outlined)?\b[^>]*>\s*([a-z][a-z0-9_]{1,48})\s*</g;

const NAME_RE = /^[a-z][a-z0-9_]{1,48}$/;
const ICON_PROPERTY = /\bicon\s*:\s*['"]([a-z][a-z0-9_]{1,48})['"]/g;
const ICON_RETURN = /\breturn\s+['"]([a-z][a-z0-9_]{1,48})['"]/g;
const PLATFORM_ICON_MAP =
    /\b(?:windows|linux|mac|macos|android|ios)\s*:\s*['"]([a-z][a-z0-9_]{1,48})['"]/g;
const ICON_HELPER_LINE = /\b(?:createWindowCtrlBtn|createMaterialIconSpan)\b[^;\n]*/g;
const TEXT_CONTENT_LINE = /\btextContent\s*=[^;\n]*/g;
/* A line that builds an icon span: names in ternaries such as
   `material-icons">' + (isDir ? 'folder' : 'insert_drive_file') + '<` */
const ICON_SPAN_LINE = /^.*material-(?:icons|symbols)[^\n]*$/gm;
/* Assignments to an icon variable: `var icon = running ? 'play_circle' : 'stop_circle'` */
const ICON_VAR_LINE = /\b\w*[iI]con\w*\s*=(?![=>])[^;\n]*/g;
/* Meaning-to-name maps: `ICONS: { … }`, `const iconMap = { … }`, `SVC_ICONS = { … }` */
const ICON_MAP_BLOCK = /\b\w*icons?\w*\s*[:=]\s*(?:Object\.freeze\(\s*)?\{([^{}]*)\}/gi;
const MAP_VALUE = /:\s*['"]([a-z][a-z0-9_]{1,48})['"]/g;
/* Ligatures drawn from CSS, e.g. the disclosure chevron `content: "expand_more"` */
const CSS_CONTENT = /\bcontent\s*:\s*['"]([a-z][a-z0-9_]{1,48})['"]/g;
const QUOTED_ICON_NAME = /['"]([a-z][a-z0-9_]{1,48})['"]/g;
/* Svelte: <Icon name="devices" />, and icon={online ? 'wifi' : 'wifi_off'} on any component */
const ICON_COMPONENT = /<Icon\b[^>]*?\bname=["']([a-z][a-z0-9_]{1,48})["']/g;
const ICON_ATTR_EXPR = /\b\w*[iI]con\w*=\{[^}\n]*\}/g;

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'vendor', 'tests', 'data']);

function walkFiles(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(ent.name)) {
            continue;
        }
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            walkFiles(full, out);
        } else if (SCAN_EXTS.has(path.extname(ent.name)) && !ent.name.endsWith('.min.js')) {
            out.push(full);
        }
    }
    return out;
}

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

/** Every ligature name the console may draw, with the files that use it. */
export function collectCandidateIcons() {
    const icons = new Map(EXTRA_ICONS.map((n) => [n, new Set(['(EXTRA_ICONS)'])]));
    const add = (name, file) => {
        if (!icons.has(name)) icons.set(name, new Set());
        icons.get(name).add(path.relative(REPO_ROOT, file).split(path.sep).join('/'));
    };
    const files = SCAN_ROOTS.filter((dir) => fs.existsSync(dir)).flatMap((dir) => walkFiles(dir));
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const patterns = [LIGATURE_IN_ICON_SPAN, ICON_PROPERTY, ICON_RETURN, PLATFORM_ICON_MAP, ICON_COMPONENT];
        if (file.endsWith('.css')) patterns.push(CSS_CONTENT);
        for (const pattern of patterns) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text)) !== null) {
                add(match[1], file);
            }
        }

        // Desktop controls and a few widgets assign icon ligatures through
        // textContent or helper calls instead of literal <span> markup.
        for (const pattern of [ICON_HELPER_LINE, TEXT_CONTENT_LINE, ICON_SPAN_LINE, ICON_VAR_LINE, ICON_ATTR_EXPR]) {
            pattern.lastIndex = 0;
            let line;
            while ((line = pattern.exec(text)) !== null) {
                QUOTED_ICON_NAME.lastIndex = 0;
                let match;
                while ((match = QUOTED_ICON_NAME.exec(line[0])) !== null) {
                    add(match[1], file);
                }
            }
        }

        // Meaning maps (Utils.ICONS and page-local icon tables).
        if (!file.endsWith('.css')) {
            ICON_MAP_BLOCK.lastIndex = 0;
            let block;
            while ((block = ICON_MAP_BLOCK.exec(text)) !== null) {
                MAP_VALUE.lastIndex = 0;
                let match;
                while ((match = MAP_VALUE.exec(block[1])) !== null) {
                    add(match[1], file);
                }
            }
        }
    }
    return icons;
}

/** Candidates that are real Material Symbols names, sorted; the rest is reported. */
export function collectIcons(valid, candidates = collectCandidateIcons()) {
    const icons = [];
    const skipped = [];
    for (const name of candidates.keys()) {
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

function updateFontCacheBusters(outlined, rounded) {
    // The reworked console declares the font in ui/base.css, the new one in
    // its base.css, and app.html preloads it.
    for (const basePath of [
        path.join(WEB, 'public', 'css', 'ui', 'base.css'),
        path.join(UI, 'src', 'lib', 'styles', 'base.css'),
        path.join(UI, 'src', 'app.html'),
    ]) {
        if (!fs.existsSync(basePath)) continue;
        const base = fs.readFileSync(basePath, 'utf8').replace(
            /MaterialSymbolsOutlined\.woff2(?:\?v=[^'")]+)?/g,
            `MaterialSymbolsOutlined.woff2?v=${outlined.sha256.slice(0, 12)}`
        );
        fs.writeFileSync(basePath, base, 'utf8');
    }
    const cssPath = path.join(WEB, 'public', 'css', 'material-icons-local.css');
    if (!fs.existsSync(cssPath)) return;
    let css = fs.readFileSync(cssPath, 'utf8');
    css = css
        .replace(
            /MaterialSymbolsOutlined\.woff2(?:\?v=[^'")]+)?/g,
            `MaterialSymbolsOutlined.woff2?v=${outlined.sha256.slice(0, 12)}`
        )
        .replace(
            /MaterialSymbolsRounded\.woff2(?:\?v=[^'")]+)?/g,
            `MaterialSymbolsRounded.woff2?v=${rounded.sha256.slice(0, 12)}`
        );
    fs.writeFileSync(cssPath, css, 'utf8');
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
    updateFontCacheBusters(outlined, rounded);

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
    if (fs.existsSync(UI_FONTS_DIR)) {
        for (const name of [outlined.outName, rounded.outName, 'MATERIAL_SYMBOLS_VERSION.txt']) {
            fs.copyFileSync(path.join(FONTS_DIR, name), path.join(UI_FONTS_DIR, name));
        }
        console.log(`Copied the fonts to ${path.relative(REPO_ROOT, UI_FONTS_DIR)}`);
    }
    console.log('Done. Review hashes, then commit fonts + CSS together.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
