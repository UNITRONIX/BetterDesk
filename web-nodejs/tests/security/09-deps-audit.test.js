/**
 * Minimum dependency versions for audited advisories (DEP-01…DEP-04).
 */
'use strict';

function pkgVersion(name) {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    return require(`${name}/package.json`).version;
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

describe('[sec/09] Dependency audit floors (DEP-01…04)', () => {
    it('proxy-addr >= 2.0.8 (GHSA-jqcg-44mw-7w3h)', () => {
        expect(gte(pkgVersion('proxy-addr'), '2.0.8')).toBe(true);
    });

    it('axios >= 1.20.0', () => {
        expect(gte(pkgVersion('axios'), '1.20.0')).toBe(true);
    });

    it('brace-expansion >= 5.0.12', () => {
        expect(gte(pkgVersion('brace-expansion'), '5.0.12')).toBe(true);
    });

    it('multer >= 2.4.0 (orphaned upload DoS)', () => {
        expect(gte(pkgVersion('multer'), '2.4.0')).toBe(true);
    });
});
