/**
 * Opening the viewer for a remote target (rt_<id>) that doesn't exist, or
 * while the Go server is down, answers 404 (BUGS.md R1). It used to throw
 * inside the async handler, which Express 4 never answers: the request hung.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/betterdeskApi', () => ({
    getRemoteTarget: jest.fn(),
    getPeer: jest.fn().mockResolvedValue(null)
}));

const betterdeskApi = require('../services/betterdeskApi');
const remoteRoutes = require('../routes/remote.routes');

function app() {
    const a = createTestApp();
    a.use((req, res, next) => {
        req.session.userId = 1;
        req.session.user = { id: 1, username: 'admin', role: 'super_admin' };
        res.render = (view) => res.send('rendered ' + view);
        next();
    });
    a.use(remoteRoutes);
    return a;
}

test.each([
    ['unknown', async () => null],
    ['Go down', async () => { throw new Error('connect ECONNREFUSED'); }]
])('a missing remote target (%s) answers 404', async (_name, impl) => {
    betterdeskApi.getRemoteTarget.mockImplementation(impl);
    const res = await request(app()).get('/remote/rt_missing1').timeout(3000);
    expect(res.status).toBe(404);
    expect(res.text).toBe('rendered errors/404');
});
