/**
 * Pages that need a session send people to the sign-in page with the way
 * back (R3), and say "session expired" only when a session ended (R4).
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');
const { requireAuth } = require('../middleware/auth');

function app() {
    const a = createTestApp();
    a.get('/devices', requireAuth, (_req, res) => res.send('OK'));
    a.post('/form', requireAuth, (_req, res) => res.send('OK'));
    return a;
}

describe('requireAuth redirect', () => {
    test('a first visit keeps the page to come back to and gets no "expired" notice', async () => {
        const res = await request(app()).get('/devices?open=123');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?return=%2Fdevices%3Fopen%3D123');
    });

    test('a browser whose session ended is told so', async () => {
        const res = await request(app()).get('/devices').set('Cookie', 'bd.sid=s%3Agone.sig');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?expired=1&return=%2Fdevices');
    });

    test('a form post gets no return path', async () => {
        const res = await request(app()).post('/form').type('form').send({ a: 1 });
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login');
    });
});
