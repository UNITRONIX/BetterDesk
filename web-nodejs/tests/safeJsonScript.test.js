'use strict';

/**
 * Inline script embedding (audit M11, CodeQL 367/368, 2026-11-13).
 *
 * `JSON.stringify` is not HTML-safe: a string containing `</script>` ends the
 * block early, and `<`/`>` can escape surrounding markup. Bootstrap payloads
 * (branding, translations, user, device id) are written with `<%- %>`, so the
 * escaping must happen in the helper.
 */

const fs = require('fs');
const path = require('path');
const { safeJsonScript, safeJsonScriptOr } = require('../lib/safeJsonScript');

const VIEWS_DIR = path.join(__dirname, '..', 'views');

describe('safeJsonScript', () => {
    it('escapes characters that can terminate a script block', () => {
        const payload = 'x</script><img src=x onerror=alert(1)>';
        const out = safeJsonScript({ name: payload });

        expect(out).not.toContain('<');
        expect(out).not.toContain('>');
        expect(out).toContain('\\u003c');
        expect(out).toContain('\\u003e');
    });

    it('stays valid JSON that round-trips to the original value', () => {
        const value = { a: '</script>', b: ['<b>', '&amp;'], c: 1, d: null };
        expect(JSON.parse(safeJsonScript(value))).toEqual(value);
    });

    it('escapes the ampersand and unicode line separators', () => {
        const out = safeJsonScript({ s: 'a&b\u2028c\u2029d' });
        expect(out).toContain('\\u0026');
        expect(out).toContain('\\u2028');
        expect(out).toContain('\\u2029');
    });

    it('serialises undefined as null instead of throwing', () => {
        expect(safeJsonScript(undefined)).toBe('null');
    });

    it('supports an explicit fallback', () => {
        expect(safeJsonScriptOr(undefined, [])).toBe('[]');
        expect(safeJsonScriptOr(null, {})).toBe('{}');
        expect(safeJsonScriptOr(0, 5)).toBe('0');
    });
});

describe('templates', () => {
    const ejsFiles = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.ejs')) ejsFiles.push(full);
        }
    };
    walk(VIEWS_DIR);

    it('never embed server data inside a script block with raw JSON.stringify', () => {
        const offenders = [];
        for (const file of ejsFiles) {
            const source = fs.readFileSync(file, 'utf8');
            // Sink form used by bootstrap payloads: `<%- JSON.stringify(` or
            // `= ${JSON.stringify(` inside a script element.
            if (/<%-\s*JSON\.stringify\(/.test(source) || /\$\{JSON\.stringify\(/.test(source)) {
                offenders.push(path.relative(VIEWS_DIR, file));
            }
        }
        expect(offenders).toEqual([]);
    });

    it('uses the escaping helper for the main layout bootstrap payload', () => {
        const source = fs.readFileSync(path.join(VIEWS_DIR, 'layouts', 'main.ejs'), 'utf8');
        // Templates call the server helper through a local alias (audit M11).
        expect(source).toMatch(/(?:safeJsonScript|bdJson)\(branding/);
        expect(source).toMatch(/(?:safeJsonScript|bdJson)\(user/);
        expect(source).toMatch(/(?:safeJsonScript|bdJson)\(translations/);
    });

    it('escapes the pairing host and exposes the helper from the layout server', () => {
        const pairing = fs.readFileSync(path.join(VIEWS_DIR, 'pairing.ejs'), 'utf8');
        // Escaped through a local alias of the server helper (audit M11).
        expect(pairing).toMatch(/\$\{(?:escapeHtml|bdEsc)\(suggested_host/);

        const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
        expect(server).toContain('res.locals.safeJsonScript = safeJsonScript');
        expect(server).toContain('res.locals.escapeHtml = escapeHtml');
    });
});
