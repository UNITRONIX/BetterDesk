'use strict';

/**
 * The public /portal page must explain an empty installer list instead of
 * showing a bare "nothing here". A fresh install has not imported a release
 * yet, while a half-finished import leaves an incomplete cache directory.
 * Both states previously looked identical to the user (#439 / #475).
 */

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');

function buildApp(dataDir) {
    jest.resetModules();
    process.env.DATA_DIR = dataDir;
    const router = require('../routes/phase4_5.routes');
    const app = express();
    app.use('/', router);
    return app;
}

function tempDataDir(name) {
    const dir = path.join(os.tmpdir(), name);
    fs.rmSync(dir, { recursive: true, force: true });
    return dir;
}

describe('GET /api/portal/installers diagnostics', () => {
    const originalDataDir = process.env.DATA_DIR;

    afterEach(() => {
        if (originalDataDir === undefined) {
            delete process.env.DATA_DIR;
        } else {
            process.env.DATA_DIR = originalDataDir;
        }
        jest.resetModules();
    });

    it('reports no_release_imported when the cache directory does not exist', async () => {
        const dataDir = tempDataDir(`bd-portal-missing-${process.pid}`);
        const app = buildApp(dataDir);

        const res = await request(app).get('/api/portal/installers');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.installers).toEqual([]);
        expect(res.body.release).toBeNull();
        expect(res.body.reason).toBe('no_release_imported');
    });

    it('reports release_cache_incomplete when the directory exists but holds no usable release', async () => {
        const dataDir = tempDataDir(`bd-portal-partial-${process.pid}`);
        const cacheDir = path.join(dataDir, 'modules', 'betterdesk-support-releases');
        fs.mkdirSync(cacheDir, { recursive: true });
        const app = buildApp(dataDir);

        const res = await request(app).get('/api/portal/installers');

        expect(res.status).toBe(200);
        expect(res.body.installers).toEqual([]);
        expect(res.body.reason).toBe('release_cache_incomplete');

        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('returns installers without a reason when a verified release is cached', async () => {
        const dataDir = tempDataDir(`bd-portal-ready-${process.pid}`);
        const releaseDir = path.join(
            dataDir,
            'modules',
            'betterdesk-support-releases',
            'support-v0.0.9'
        );
        fs.mkdirSync(releaseDir, { recursive: true });
        fs.writeFileSync(
            path.join(releaseDir, 'manifest.json'),
            JSON.stringify({
                schema_version: 1,
                sku: 'betterdesk-support',
                assets: [
                    {
                        name: 'betterdesk-support-generic-windows-x86_64.zip',
                        platform: 'windows',
                        arch: 'x86_64',
                        format: 'portable',
                    },
                ],
            })
        );
        const app = buildApp(dataDir);

        const res = await request(app).get('/api/portal/installers');

        expect(res.status).toBe(200);
        expect(res.body.reason).toBeNull();
        expect(res.body.release).toBe('support-v0.0.9');
        expect(res.body.installers).toHaveLength(1);
        expect(res.body.installers[0].url).toContain(
            '/downloads/generic-agent/support-v0.0.9/betterdesk-support-generic-windows-x86_64.zip'
        );

        fs.rmSync(dataDir, { recursive: true, force: true });
    });
});
