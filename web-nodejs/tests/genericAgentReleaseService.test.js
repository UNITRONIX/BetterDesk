'use strict';

const {
    resolveAllowedGithubHost,
    GITHUB_FETCH_HOSTS,
} = require('../services/genericAgentReleaseService');

describe('genericAgentReleaseService GitHub redirect allowlist', () => {
    it('allows the same GitHub download hosts as supportGeneratorModule (incl. release-assets CDN)', () => {
        expect(resolveAllowedGithubHost('release-assets.githubusercontent.com'))
            .toBe('release-assets.githubusercontent.com');
        expect(resolveAllowedGithubHost('objects.githubusercontent.com'))
            .toBe('objects.githubusercontent.com');
        expect(resolveAllowedGithubHost('api.github.com')).toBe('api.github.com');
        expect(resolveAllowedGithubHost('github.com')).toBe('github.com');
        expect(Object.keys(GITHUB_FETCH_HOSTS).sort()).toEqual([
            'api.github.com',
            'github.com',
            'objects.githubusercontent.com',
            'release-assets.githubusercontent.com',
        ].sort());
    });

    it('rejects unrelated redirect hosts (SSRF guard)', () => {
        expect(resolveAllowedGithubHost('evil.example')).toBeNull();
        expect(resolveAllowedGithubHost('127.0.0.1')).toBeNull();
        expect(resolveAllowedGithubHost('')).toBeNull();
    });
});
