'use strict';

const builder = require('../services/localClientBuilder');

describe('localClientBuilder capability probe', () => {
    test('maps supported host architectures to provider architecture names', () => {
        expect(builder.providerArch('x64')).toBe('x86_64');
        expect(builder.providerArch('arm64')).toBe('aarch64');
    });

    test('never throws when probing the current host toolchain', () => {
        const capabilities = builder.getCapabilities();
        expect(capabilities).toMatchObject({
            mode: 'local',
            host: {
                platform: expect.stringMatching(/^(linux|windows|macos)$/),
                arch: expect.stringMatching(/^(x64|arm64)$/),
            },
            toolchain: {
                ready: expect.any(Boolean),
                missing: expect.any(Array),
            },
            targets: expect.any(Array),
        });
        if (capabilities.toolchain.ready) {
            expect(capabilities.targets.length).toBeGreaterThan(0);
            expect(capabilities.targets.every((target) => (
                target.platform === capabilities.host.platform
                && target.arch === capabilities.host.arch
            ))).toBe(true);
        }
    });
});
