'use strict';

const https = require('https');

describe('updateService local server build', () => {
    let updateService;

    beforeEach(() => {
        jest.restoreAllMocks();
        delete require.cache[require.resolve('../services/updateService')];
        updateService = require('../services/updateService');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete require.cache[require.resolve('../services/updateService')];
    });

    it('exposes local build readiness without GitHub binary delivery helpers', () => {
        expect(updateService.getServerUpdateInfo()).toMatchObject({
            canAutoUpdate: true,
            buildMethod: 'local',
            canInstallGo: true,
        });
        expect(updateService.getPrebuiltInfo).toBeUndefined();
        expect(updateService.checkPrebuiltAvailable).toBeUndefined();
        expect(updateService.downloadPrebuiltBinary).toBeUndefined();
        expect(updateService.downloadGithubBuffer).toBeUndefined();
    });

    it('keeps the server build result explicitly local', () => {
        expect(updateService.getServerUpdateInfo().buildMethod).toBe('local');
    });

    it('accepts only HTTPS GitHub API/raw hosts for update requests', () => {
        expect(updateService.parseAllowedGithubUrl(
            '/repos/UNITRONIX/BetterDesk/commits/main',
            'api.github.com'
        ).hostname).toBe('api.github.com');
        expect(updateService.parseAllowedGithubUrl(
            'https://raw.githubusercontent.com/UNITRONIX/BetterDesk/main/VERSION',
            'raw.githubusercontent.com'
        ).hostname).toBe('raw.githubusercontent.com');

        expect(() => updateService.parseAllowedGithubUrl(
            'https://evil.example/payload',
            'api.github.com'
        )).toThrow(/host is not allowed/i);
        expect(() => updateService.parseAllowedGithubUrl(
            'http://api.github.com/insecure',
            'api.github.com'
        )).toThrow(/host is not allowed/i);
        expect(() => updateService.parseAllowedGithubUrl(
            'https://api.github.com:8443/alternate-port',
            'api.github.com'
        )).toThrow(/host is not allowed/i);
    });

    it('limits GitHub redirect handling to a bounded redirect set', () => {
        expect(updateService.MAX_GITHUB_REDIRECTS).toBe(3);
        expect(updateService.isGithubRedirectStatus(301)).toBe(true);
        expect(updateService.isGithubRedirectStatus(308)).toBe(true);
        expect(updateService.isGithubRedirectStatus(200)).toBe(false);
    });

    it('enumerates only the requested GitHub subtree', async () => {
        const commit = 'a'.repeat(40);
        const rootTree = 'b'.repeat(40);
        const serverTree = 'c'.repeat(40);
        const routes = new Map([
            [
                `/repos/UNITRONIX/BetterDesk/git/commits/${commit}`,
                { tree: { sha: rootTree } },
            ],
            [
                `/repos/UNITRONIX/BetterDesk/git/trees/${rootTree}`,
                { tree: [{ type: 'tree', path: 'betterdesk-server', sha: serverTree }] },
            ],
            [
                `/repos/UNITRONIX/BetterDesk/git/trees/${serverTree}?recursive=1`,
                { tree: [
                    { type: 'blob', path: 'go.mod' },
                    { type: 'blob', path: 'api/server.go' },
                ] },
            ],
        ]);
        const requested = [];
        jest.spyOn(https, 'get').mockImplementation((options, callback) => {
            const route = typeof options === 'string' ? new URL(options).pathname : options.path;
            requested.push(route);
            const body = routes.get(route);
            process.nextTick(() => callback({
                statusCode: body ? 200 : 404,
                headers: {},
                on(event, handler) {
                    if (event === 'data' && body) process.nextTick(() => handler(Buffer.from(JSON.stringify(body))));
                    if (event === 'end') process.nextTick(handler);
                },
            }));
            return {
                on: jest.fn(),
                setTimeout: jest.fn(),
                destroy: jest.fn(),
            };
        });

        await expect(updateService.listRepoBlobPathsUnderPrefix(commit, 'betterdesk-server/'))
            .resolves.toEqual(['betterdesk-server/go.mod', 'betterdesk-server/api/server.go']);
        expect(requested).not.toContain(`/repos/UNITRONIX/BetterDesk/git/trees/${commit}?recursive=1`);
    });
});
