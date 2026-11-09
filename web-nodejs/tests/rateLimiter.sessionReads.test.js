/**
 * Reads by a signed-in person count against that person's own read budget,
 * not against the address they come from. Several people behind one address
 * (an office, or the browser tests) used to share 100 requests a minute for
 * every read the old path lists didn't name, so the users page alone hit 429
 * with a few dozen accounts. Sign-in, writes and requests without a session
 * keep the strict per-address limit.
 */

const express = require('express');
const request = require('supertest');

function app({ signedIn = true, userId = 7 } = {}) {
    let limiters;
    jest.isolateModules(() => {
        limiters = require('../middleware/rateLimiter');
    });
    const { sessionReadLimiter, widgetLimiter, apiLimiter } = limiters;
    const a = express();
    a.use((req, _res, next) => {
        req.session = signedIn ? { userId: req.get('x-user') || userId } : {};
        next();
    });
    a.use('/api/', sessionReadLimiter);
    a.use('/api/panel', widgetLimiter);
    a.use('/api/', apiLimiter);
    a.get('/api/users/:id/effective-scope', (_req, res) => res.json({ ok: true }));
    a.get('/api/panel/security-audit/overview', (_req, res) => res.json({ ok: true }));
    a.post('/api/users', (_req, res) => res.json({ ok: true }));
    return a;
}

async function statuses(a, n, make) {
    const out = [];
    for (let i = 0; i < n; i++) out.push((await make(request(a))).status);
    return out;
}

describe('read budget per signed-in person', () => {
    test('150 reads in a minute by one person are not refused', async () => {
        const s = await statuses(app(), 150, (r) => r.get('/api/users/3/effective-scope'));
        expect(s.filter((x) => x === 429)).toHaveLength(0);
    });

    test('people behind one address each have their own budget for /api/panel reads', async () => {
        const a = app();
        const one = await statuses(a, 350, (r) => r.get('/api/panel/security-audit/overview').set('x-user', '1'));
        const two = await statuses(a, 350, (r) => r.get('/api/panel/security-audit/overview').set('x-user', '2'));
        expect([...one, ...two].filter((x) => x === 429)).toHaveLength(0);
    });

    test('the per-person read budget still ends', async () => {
        const s = await statuses(app(), 610, (r) => r.get('/api/users/3/effective-scope'));
        expect(s.slice(0, 600).every((x) => x === 200)).toBe(true);
        expect(s.slice(600).every((x) => x === 429)).toBe(true);
    });

    test('reads without a session keep the per-address limit', async () => {
        const s = await statuses(app({ signedIn: false }), 110, (r) => r.get('/api/users/3/effective-scope'));
        expect(s.indexOf(429)).toBe(100);
    });

    test('writes keep the per-address limit', async () => {
        const s = await statuses(app(), 110, (r) => r.post('/api/users').send({}));
        expect(s.indexOf(429)).toBe(100);
    });
});
