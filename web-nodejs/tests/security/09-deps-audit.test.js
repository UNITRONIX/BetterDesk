/**
 * Minimum dependency versions for audited advisories (DEP-01…DEP-07).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function pkgVersion(name) {
    try {
        // eslint-disable-next-line import/no-dynamic-require, global-require
        return require(`${name}/package.json`).version;
    } catch {
        let current = path.dirname(require.resolve(name));
        while (current !== path.dirname(current)) {
            try {
                const version = JSON.parse(fs.readFileSync(path.join(current, 'package.json'), 'utf8')).version;
                if (version) return version;
            } catch {
            }
            current = path.dirname(current);
        }
        throw new Error(`Unable to find package.json for ${name}`);
    }
}

function parseSemver(v) {
    const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(actual, minimum) {
    const a = parseSemver(actual);
    const b = parseSemver(minimum);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return true;
        if (a[i] < b[i]) return false;
    }
    return true;
}

describe('[sec/09] Dependency audit floors (DEP-01…07)', () => {
    it('proxy-addr >= 2.0.8 (GHSA-jqcg-44mw-7w3h)', () => {
        expect(gte(pkgVersion('proxy-addr'), '2.0.8')).toBe(true);
    });

    it('axios >= 1.20.0', () => {
        expect(gte(pkgVersion('axios'), '1.20.0')).toBe(true);
    });

    it('follow-redirects >= 1.16.2 (GHSA-mrwp-f3q8-3g9p)', () => {
        expect(gte(pkgVersion('follow-redirects'), '1.16.2')).toBe(true);
    });

    it('bcrypt >= 6.0.0 (removes vulnerable node-pre-gyp chain)', () => {
        expect(gte(pkgVersion('bcrypt'), '6.0.0')).toBe(true);
    });

    it('ejs >= 7.0.2 (removes vulnerable jake/filelist chain)', () => {
        expect(gte(pkgVersion('ejs'), '7.0.2')).toBe(true);
    });

    it('brace-expansion >= 5.0.12', () => {
        expect(gte(pkgVersion('brace-expansion'), '5.0.12')).toBe(true);
    });

    it('multer >= 2.4.0 (orphaned upload DoS)', () => {
        expect(gte(pkgVersion('multer'), '2.4.0')).toBe(true);
    });
});
