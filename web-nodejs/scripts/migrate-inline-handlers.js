#!/usr/bin/env node
'use strict';

/**
 * Convert onclick=/onchange= attributes to data-bd-call for CSP scriptSrcAttr none.
 * Supports simple Module.method('arg', ...) and Module.method() forms.
 */
const fs = require('fs');
const path = require('path');

const roots = [
    path.join(__dirname, '..', 'views'),
    path.join(__dirname, '..', 'public', 'js'),
];

const ATTR_RE = /\b(on)(click|change)\s*=\s*(["'])([\s\S]*?)\3/gi;

function convertHandler(eventName, code) {
    let c = String(code || '').trim();
    let selfOnly = false;
    const selfMatch = c.match(/^if\s*\(\s*event\.target\s*===\s*this\s*\)\s*(.+)$/i);
    if (selfMatch) {
        selfOnly = true;
        c = selfMatch[1].trim();
    }

    // Module.method(this.value) / Module.method('x', this.value)
    let useValue = false;
    if (/\bthis\.value\b/.test(c)) {
        useValue = true;
        c = c.replace(/,\s*this\.value\s*/g, '').replace(/\(\s*this\.value\s*\)/g, '()');
    }

    const m = c.match(/^([A-Za-z_$][\w.$]*)\((.*)\)\s*;?\s*$/);
    if (!m) return null;
    const callPath = m[1];
    let argsRaw = m[2].trim();
    const args = [];
    if (argsRaw) {
        // Split on commas not inside quotes (simple)
        const parts = [];
        let cur = '';
        let q = null;
        for (let i = 0; i < argsRaw.length; i++) {
            const ch = argsRaw[i];
            if (q) {
                cur += ch;
                if (ch === q && argsRaw[i - 1] !== '\\') q = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                q = ch;
                cur += ch;
                continue;
            }
            if (ch === ',') {
                parts.push(cur.trim());
                cur = '';
                continue;
            }
            cur += ch;
        }
        if (cur.trim()) parts.push(cur.trim());
        for (const p of parts) {
            if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) {
                args.push(JSON.parse(p.replace(/^'/, '"').replace(/'$/, '"')));
            } else if (/^-?\d+(\.\d+)?$/.test(p)) {
                args.push(Number(p));
            } else if (p === 'true' || p === 'false') {
                args.push(p === 'true');
            } else if (p === 'this' || p.startsWith('this.')) {
                return null; // unsupported
            } else {
                return null;
            }
        }
    }

    let out = `data-bd-call="${callPath}"`;
    if (args.length) out += ` data-bd-args='${JSON.stringify(args)}'`;
    if (eventName === 'change') out += ' data-bd-on="change"';
    if (useValue) out += ' data-bd-value="1"';
    if (selfOnly) out += ' data-bd-self-only="1"';
    return out;
}

function transform(content) {
    let changed = 0;
    const next = content.replace(ATTR_RE, (full, _on, evt, _q, code) => {
        const converted = convertHandler(evt.toLowerCase(), code);
        if (!converted) return full;
        changed += 1;
        return converted;
    });
    return { next, changed };
}

function walk(dir, files = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, files);
        else if (/\.(ejs|js)$/.test(ent.name)) files.push(p);
    }
    return files;
}

let total = 0;
for (const root of roots) {
    for (const file of walk(root)) {
        if (file.includes(`${path.sep}vendor${path.sep}`)) continue;
        if (file.endsWith('bd-actions.js') || file.endsWith('migrate-inline-handlers.js')) continue;
        const src = fs.readFileSync(file, 'utf8');
        if (!/\bon(click|change)\s*=/.test(src)) continue;
        const { next, changed } = transform(src);
        if (changed) {
            fs.writeFileSync(file, next, 'utf8');
            total += changed;
            console.log(`${changed}  ${path.relative(path.join(__dirname, '..'), file)}`);
        }
    }
}
console.log(`Converted ${total} handlers`);
