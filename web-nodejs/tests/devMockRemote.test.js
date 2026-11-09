'use strict';

/**
 * The dev-only mock remote session must be unreachable unless the
 * environment sets BD_DEV_MOCK_REMOTE=1: the script route answers 404 and
 * ?mock=1 is ignored.
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const devMockRemote = require('../lib/devMockRemote');

const ROOT = path.join(__dirname, '..');
const FLAG = 'BD_DEV_MOCK_REMOTE';

function appWithRouter() {
    const app = express();
    app.use(devMockRemote.router);
    app.use((req, res) => res.status(404).send('not found'));
    return app;
}

describe('dev mock remote session guard', () => {
    let saved;
    beforeEach(() => { saved = process.env[FLAG]; delete process.env[FLAG]; });
    afterEach(() => {
        if (saved === undefined) delete process.env[FLAG];
        else process.env[FLAG] = saved;
    });

    it('answers 404 for the mock script without the flag', async () => {
        const res = await request(appWithRouter()).get('/dev/mock-remote.js');
        expect(res.status).toBe(404);
        expect(res.text).not.toMatch(/MockRemoteSession/);
    });

    it('answers 404 when the flag has any value other than 1', async () => {
        process.env[FLAG] = 'true';
        const res = await request(appWithRouter()).get('/dev/mock-remote.js');
        expect(res.status).toBe(404);
    });

    it('serves the mock script with the flag', async () => {
        process.env[FLAG] = '1';
        const res = await request(appWithRouter()).get('/dev/mock-remote.js');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/javascript/);
        expect(res.text).toMatch(/window\.MockRemoteSession = MockRemoteSession/);
    });

    it('ignores ?mock=1 without the flag', () => {
        expect(devMockRemote.forRequest({ query: { mock: '1', scenario: 'refused' } }, {})).toBeNull();
        expect(devMockRemote.forRequest({ query: { mock: '1' } }, { [FLAG]: '0' })).toBeNull();
    });

    it('gives the seeded demo and perf devices the mock without ?mock=1, only with the flag', () => {
        const env = { [FLAG]: '1' };
        // scripts/dev/seed-ui-data.js and seed-many-devices.js
        expect(devMockRemote.forRequest({ query: {} }, env, '900100012')).toEqual({ scenario: 'ok' });
        expect(devMockRemote.forRequest({ query: {} }, env, '950004321')).toEqual({ scenario: 'ok' });
        expect(devMockRemote.forRequest({ query: { scenario: 'password' } }, env, '900100001')).toEqual({ scenario: 'password' });
        // ?mock=0 reaches the real connection path
        expect(devMockRemote.forRequest({ query: { mock: '0' } }, env, '900100012')).toBeNull();
        // Other devices still need ?mock=1
        expect(devMockRemote.forRequest({ query: {} }, env, '123456789')).toBeNull();
        expect(devMockRemote.forRequest({ query: {} }, env, '9001000120')).toBeNull();
        expect(devMockRemote.forRequest({ query: {} }, env, 'rt_900100012')).toBeNull();
        // Never without the flag
        expect(devMockRemote.forRequest({ query: {} }, {}, '900100012')).toBeNull();
        expect(devMockRemote.forRequest({ query: { mock: '1' } }, {}, '950000001')).toBeNull();
    });

    it('turns the mock on with the flag and ?mock=1, with a known scenario', () => {
        const env = { [FLAG]: '1' };
        expect(devMockRemote.forRequest({ query: {} }, env)).toBeNull();
        expect(devMockRemote.forRequest({ query: { mock: '1' } }, env)).toEqual({ scenario: 'ok' });
        expect(devMockRemote.forRequest({ query: { mock: '1', scenario: 'fail-relay' } }, env)).toEqual({ scenario: 'fail-relay' });
        expect(devMockRemote.forRequest({ query: { mock: '1', scenario: '<script>' } }, env)).toEqual({ scenario: 'ok' });
    });

    it('passes the request through the guard in the viewer route', () => {
        const src = fs.readFileSync(path.join(ROOT, 'routes', 'remote.routes.js'), 'utf8');
        expect(src).toMatch(/mockRemote: devMockRemote\.forRequest\(req, process\.env, deviceId\)/);
        expect(src).toMatch(/router\.use\(devMockRemote\.router\)/);
    });

    it('is not switched on in any production compose file', () => {
        const repo = path.join(ROOT, '..');
        const composeFiles = fs.readdirSync(repo).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));
        expect(composeFiles.length).toBeGreaterThan(0);
        for (const f of composeFiles) {
            expect(fs.readFileSync(path.join(repo, f), 'utf8')).not.toMatch(/BD_DEV_MOCK_REMOTE/);
        }
    });
});
