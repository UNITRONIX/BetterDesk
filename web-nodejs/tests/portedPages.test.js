/**
 * Switch-over: the old URL of a page the new console serves redirects to the
 * same URL under /app, query kept; the server and the new console list the
 * same pages.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi } = require('../lib/webUi');
const { PORTED_PAGES, isPortedPath } = require('../lib/portedPages');

let dir;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-ported-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function app({ build = true, ported } = {}) {
    const a = createTestApp();
    a.use(createWebUi({ base: '/app', dir: build ? dir : path.join(dir, 'missing'), ported }));
    a.use((req, res) => res.status(200).send('old console ' + req.path));
    return a;
}

describe('old URLs of ported pages', () => {
    const ported = ['/', '/devices', '/organizations/*'];

    test('redirect to the new console with the query', async () => {
        const res = await request(app({ ported })).get('/devices?open=900100001');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/app/devices?open=900100001');
    });

    test('the dashboard and pages with an id in the path', async () => {
        expect((await request(app({ ported })).get('/?activateAgent=1')).headers.location).toBe('/app?activateAgent=1');
        expect((await request(app({ ported })).get('/organizations/7')).headers.location).toBe('/app/organizations/7');
    });

    test('pages not ported, API paths and missing builds stay with the old console', async () => {
        expect((await request(app({ ported })).get('/organizations')).text).toBe('old console /organizations');
        expect((await request(app({ ported })).get('/api/devices')).text).toBe('old console /api/devices');
        expect((await request(app({ ported, build: false })).get('/devices')).text).toBe('old console /devices');
    });

    test('writes are not redirected', async () => {
        const res = await request(app({ ported })).post('/devices').send({});
        expect(res.text).toBe('old console /devices');
    });
});

test('patterns', () => {
    expect(isPortedPath('/organizations/7', ['/organizations/*'])).toBe(true);
    expect(isPortedPath('/organizations', ['/organizations/*'])).toBe(false);
    expect(isPortedPath('/organizationsx', ['/organizations/*'])).toBe(false);
    expect(isPortedPath('/devices/x', ['/devices'])).toBe(false);
});

test('every switched page is one the new console has', () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'web-ui', 'src', 'lib', 'nav.ts'), 'utf8');
    const m = nav.match(/export const PORTED[^=]*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const list = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(list).toContain('/devices');
    expect(PORTED_PAGES.filter((p) => !list.includes(p))).toEqual([]);
});
