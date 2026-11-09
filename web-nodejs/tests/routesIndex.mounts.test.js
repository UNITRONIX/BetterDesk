/**
 * Each router is mounted once per path. The tickets router was mounted twice
 * at /api/tickets (BUGS.md R12), so every request that didn't match ran
 * through its middleware twice before the 404.
 */

const fs = require('fs');
const path = require('path');

test('no router is mounted twice at the same path', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'index.js'), 'utf8');
    const seen = new Map();
    const twice = [];
    for (const m of src.matchAll(/^\s*router\.use\(\s*'([^']+)'\s*,\s*(\w+)\s*\)/gm)) {
        const key = m[1] + ' ' + m[2];
        if (seen.has(key)) twice.push(key);
        seen.set(key, true);
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(twice).toEqual([]);
});
