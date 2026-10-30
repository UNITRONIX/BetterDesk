'use strict';

/**
 * Guard against #393-class regressions: Material Symbols ligatures used in
 * views must exist in the self-hosted subset, or the raw icon name paints
 * as giant text instead of a glyph.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const viewsDir = path.join(root, 'views');
const versionPath = path.join(root, 'public', 'fonts', 'MATERIAL_SYMBOLS_VERSION.txt');

const LIGATURE_IN_ICON_SPAN =
    /material-icons(?:-round|-outlined)?\b[^>]*>\s*([a-z][a-z0-9_]{1,48})\s*</g;

function walkEjs(dir, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkEjs(full, out);
        else if (ent.name.endsWith('.ejs')) out.push(full);
    }
    return out;
}

describe('Material Symbols self-hosted subset', () => {
    it('includes every ligature used in view icon spans', () => {
        const version = fs.readFileSync(versionPath, 'utf8');
        const iconsLine = version.split(/\n/).find((line) => line.startsWith('ac_unit,'));
        assert.ok(iconsLine, 'MATERIAL_SYMBOLS_VERSION.txt missing icons list');
        const subset = new Set(iconsLine.split(',').map((s) => s.trim()).filter(Boolean));

        const missing = new Map();
        for (const file of walkEjs(viewsDir)) {
            const text = fs.readFileSync(file, 'utf8');
            LIGATURE_IN_ICON_SPAN.lastIndex = 0;
            let match;
            while ((match = LIGATURE_IN_ICON_SPAN.exec(text)) !== null) {
                const name = match[1];
                if (!subset.has(name)) {
                    if (!missing.has(name)) missing.set(name, []);
                    missing.get(name).push(path.relative(root, file));
                }
            }
        }

        assert.deepStrictEqual(
            Object.fromEntries([...missing.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
            {},
            'Icons missing from self-hosted subset — run: node scripts/update-material-symbols.mjs'
        );
    });

    it('keeps Devices toolbar icons from overflowing as raw ligature text', () => {
        const devicesCss = fs.readFileSync(path.join(root, 'public', 'css', 'devices.css'), 'utf8');
        assert.match(devicesCss, /\.toolbar-icon\s*\{[\s\S]*?overflow:\s*hidden/);
        assert.match(devicesCss, /\.toolbar-icon \.material-icons\s*\{[\s\S]*?overflow:\s*hidden/);
    });
});
