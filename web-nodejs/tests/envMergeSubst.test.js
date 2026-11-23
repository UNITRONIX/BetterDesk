'use strict';

const {
    buildEnvSubstitutions,
    applySubstitutions,
    mergeEnv,
    fillEmptyGeneratedSecrets
} = require('../lib/envMerge');

describe('buildEnvSubstitutions', () => {
    it('resolves template placeholders from existing env and config', () => {
        const existing = `PORT=5000
RUSTDESK_DIR=/opt/custom
SESSION_SECRET=keep-me
PANEL_TRUST_SECRET=existing-panel-trust
`;

        const subs = buildEnvSubstitutions({
            existingContent: existing,
            config: { goApiPort: 21114, apiPort: 21121, dataDir: '/app/data' }
        });

        expect(subs.RUSTDESK_DIR).toBe('/opt/custom');
        expect(subs.SESSION_SECRET).toBe('keep-me');
        expect(subs.PANEL_TRUST_SECRET).toBe('existing-panel-trust');
        expect(subs.GO_API_PORT).toBe('21114');
        expect(subs.HBBS_API_URL.includes('__')).toBe(false);

        const template = applySubstitutions(`TRUST_PROXY=false
HOST=0.0.0.0
SESSION_SECRET=__SESSION_SECRET__
PANEL_TRUST_SECRET=__PANEL_TRUST_SECRET__
`, subs);

        const { content, added } = mergeEnv(existing, template);
        expect(content).toContain('TRUST_PROXY=false');
        expect(content).toContain('HOST=0.0.0.0');
        expect(content).toContain('SESSION_SECRET=keep-me');
        expect(content).toContain('PANEL_TRUST_SECRET=existing-panel-trust');
        expect(content).not.toContain('__SESSION_SECRET__');
        expect(content).not.toContain('__PANEL_TRUST_SECRET__');
        expect(added).toContain('TRUST_PROXY');
    });

    it('generates PANEL_TRUST_SECRET when missing', () => {
        const subs = buildEnvSubstitutions({
            existingContent: 'PORT=5000\n',
            config: {}
        });
        expect(subs.PANEL_TRUST_SECRET).toMatch(/^[a-f0-9]{64}$/);
    });
});

describe('fillEmptyGeneratedSecrets', () => {
    it('fills blank PANEL_TRUST_SECRET and preserves existing', () => {
        const blank = 'PORT=5000\nPANEL_TRUST_SECRET=\n';
        const filled = fillEmptyGeneratedSecrets(blank);
        expect(filled.filled).toEqual(['PANEL_TRUST_SECRET']);
        expect(filled.content).toMatch(/PANEL_TRUST_SECRET=[a-f0-9]{64}/);

        const keep = fillEmptyGeneratedSecrets('PANEL_TRUST_SECRET=keep-me\n');
        expect(keep.filled).toEqual([]);
        expect(keep.content).toContain('PANEL_TRUST_SECRET=keep-me');
    });
});
