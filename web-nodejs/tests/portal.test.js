'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const express = require('express');
const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({}));
jest.mock('../services/betterdeskApi', () => ({}));
jest.mock('../services/genericAgentReleaseService', () => ({
    listCached: jest.fn(),
    resolveAsset: jest.fn(),
    root: jest.fn(() => require('path').join(__dirname, '..', 'data', 'modules', 'betterdesk-support-releases')),
}));

const releases = require('../services/genericAgentReleaseService');
const security = require('../middleware/security');
const routes = require('../routes/phase4_5.routes');
const script = fs.readFileSync(path.join(__dirname, '../public/js/portal.js'), 'utf8');
const installer = {
    platform: 'windows', arch: 'x64', format: 'exe',
    url: 'https://console.example/downloads/generic-agent/support-v0.0.4/agent.exe',
};

function buildApp() {
    const app = createTestApp();
    app.use(security);
    app.use(express.static(path.join(__dirname, '../public')));
    app.use(routes);
    return app;
}

// Reject HTML sinks so metadata must pass through text nodes in these tests.
function element(tag) {
    return {
        tag, children: [],
        set innerHTML(_value) { throw new Error('Unsafe HTML sink'); },
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
    };
}

async function render(data, response = {}) {
    const grid = element('div');
    const fetch = jest.fn();
    if (response instanceof Error) fetch.mockRejectedValue(response);
    else fetch.mockResolvedValue({ ok: true, json: async () => data, ...response });
    vm.runInNewContext(script, {
        document: { getElementById: () => grid, createElement: element },
        window: { location: { origin: 'https://console.example' } },
        URL, fetch, Object,
    });
    await new Promise(setImmediate);
    expect(fetch).toHaveBeenCalledWith('/api/portal/installers', { credentials: 'omit' });
    return grid;
}

describe('Public installer portal', () => {
    beforeEach(() => {
        releases.listCached.mockResolvedValue([]);
        releases.root.mockReturnValue(path.join(__dirname, '..', 'data', 'modules', 'betterdesk-support-releases'));
    });

    test('serves an anonymous page and same-origin script under restrictive CSP', async () => {
        const app = buildApp();
        const page = await request(app).get('/portal');
        expect(page.status).toBe(200);
        expect(page.text.match(/<script\b[^>]*>/gi)).toEqual(['<script src="/js/portal.js" defer>']);
        expect(page.text).not.toMatch(/\son\w+\s*=/i);
        const csp = page.headers['content-security-policy'];
        expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
        expect(csp).toContain("script-src-attr 'none'");
        expect(csp.match(/script-src ([^;]+)/)[1]).not.toContain('unsafe-');
        expect(page.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(page.headers['x-content-type-options']).toBe('nosniff');
        expect(page.headers['permissions-policy']).toContain('geolocation=()');
        const js = await request(app).get('/js/portal.js');
        expect(js.status).toBe(200);
        expect(js.headers['content-type']).toMatch(/javascript/);
        expect(js.text).toBe(script);
    });

    test('returns cached installer metadata without authentication', async () => {
        releases.listCached.mockResolvedValue([{ tag: 'support-v0.0.4', manifest: {
            assets: [{ platform: 'windows', arch: 'x64', format: 'exe', name: 'agent setup.exe' }],
        } }]);
        const res = await request(buildApp()).get('/api/portal/installers').set('Host', 'console.example');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            success: true,
            release: 'support-v0.0.4',
            reason: null,
            installers: [{
                ...installer, release: 'support-v0.0.4',
                url: 'http://console.example/downloads/generic-agent/support-v0.0.4/agent%20setup.exe',
            }],
        });
    });

    test('returns an empty list when no release is cached', async () => {
        const res = await request(buildApp()).get('/api/portal/installers');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.release).toBeNull();
        expect(res.body.installers).toEqual([]);
        expect(['no_release_imported', 'release_cache_incomplete']).toContain(res.body.reason);
    });

    test('keeps verified download assets publicly accessible', async () => {
        releases.resolveAsset.mockResolvedValueOnce(__filename);
        const res = await request(buildApp()).get('/downloads/generic-agent/support-v0.0.4/agent.exe');
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('attachment;');
        expect(releases.resolveAsset).toHaveBeenCalledWith('support-v0.0.4', 'agent.exe');
    });

    test.each(['/api/users/me/profile', '/api/agent-templates'])('keeps %s authenticated', async (url) => {
        expect((await request(buildApp()).get(url)).status).toBe(401);
    });

    test('renders installer cards and working download URLs', async () => {
        const grid = await render({ success: true, installers: [installer] });
        expect(grid.children).toHaveLength(1);
        const [heading, arch, link] = grid.children[0].children;
        expect(heading.textContent).toBe('Windows');
        expect(arch.textContent).toBe('x64 · exe');
        expect(link.href).toBe(installer.url);
    });

    test('renders the empty state', async () => {
        const grid = await render({ success: true, installers: [] });
        expect(grid.children[0].textContent).toBe('No installers available yet.');
    });

    test('renders diagnostic empty states from reason codes', async () => {
        const missing = await render({ success: true, reason: 'no_release_imported', installers: [] });
        expect(missing.children[0].textContent).toContain('published by your administrator');
        const incomplete = await render({ success: true, reason: 'release_cache_incomplete', installers: [] });
        expect(incomplete.children[0].textContent).toContain('files are incomplete');
    });

    test.each([
        [null, {}],
        [{ success: false, installers: [] }, {}],
        [{ success: true, installers: [] }, { ok: false }],
        [null, { json: async () => { throw new Error('Invalid JSON'); } }],
        [null, new Error('Network unavailable')],
    ])('renders an error for unsuccessful or malformed responses (%#)', async (data, response) => {
        const grid = await render(data, response);
        expect(grid.children[0].textContent).toBe('Failed to load installers.');
    });

    test('renders untrusted metadata as text', async () => {
        const metadata = '<img src=x onerror=alert(1)>';
        const grid = await render({ success: true, installers: [{ ...installer, platform: metadata, arch: metadata, format: metadata }] });
        const [heading, arch] = grid.children[0].children;
        expect(heading.textContent).toBe(metadata);
        expect(arch.textContent).toBe(metadata + ' · ' + metadata);
    });

    test.each(['javascript:alert(1)', 'https://evil.example/agent.exe', '//evil.example/agent.exe', '/api/users/me/profile'])('rejects unsafe download URL %s', async (url) => {
        const grid = await render({ success: true, installers: [{ ...installer, url }] });
        expect(grid.children[0].textContent).toBe('Failed to load installers.');
    });
});
