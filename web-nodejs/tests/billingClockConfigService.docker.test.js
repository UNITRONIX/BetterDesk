'use strict';

describe('billingClockConfigService Docker split mode', () => {
    let service;
    let apiClient;
    let sanitizeGoServerServiceConfig;

    beforeEach(() => {
        jest.resetModules();
        process.env.DOCKER = 'true';
        process.env.BETTERDESK_DOCKER_LAYOUT = 'split';

        apiClient = {
            get: jest.fn().mockResolvedValue({
                data: {
                    ntp_servers: 'pool.ntp.org',
                    max_skew_ms: 2000,
                    require_synced_clock: true,
                    trust_os_ntp: true,
                },
            }),
            put: jest.fn().mockResolvedValue({
                data: {
                    config: {
                        ntp_servers: 'time.example.com',
                        max_skew_ms: 3500,
                        require_synced_clock: false,
                        trust_os_ntp: false,
                    },
                    status: { synced: true },
                },
            }),
        };
        sanitizeGoServerServiceConfig = jest.fn();

        jest.doMock('../config/config', () => ({ isDocker: true }));
        jest.doMock('../services/betterdeskApi', () => ({ apiClient }));
        jest.doMock('../services/updateService', () => ({
            sanitizeGoServerServiceConfig,
        }));
        jest.doMock('../services/serverConnectionConfigService', () => ({
            restartServer: jest.fn(),
        }));

        service = require('../services/billingClockConfigService');
    });

    afterEach(() => {
        delete process.env.DOCKER;
        delete process.env.BETTERDESK_DOCKER_LAYOUT;
        jest.resetModules();
    });

    test('reads and writes the Go server configuration without native restart', async () => {
        expect(service.isDockerSplitDeployment()).toBe(true);

        const current = await service.getRuntimeClockSettings();
        expect(current.ntp_servers).toBe('pool.ntp.org');

        const result = await service.saveClockSettings({
            ntp_servers: 'time.example.com',
            max_skew_ms: 3500,
            require_synced_clock: false,
            trust_os_ntp: false,
        }, { restart: false });

        expect(apiClient.put).toHaveBeenCalledWith('/timesync/config', {
            ntp_servers: 'time.example.com',
            max_skew_ms: 3500,
            require_synced_clock: false,
            trust_os_ntp: false,
        });
        expect(result.dockerMode).toBe(true);
        expect(result.restart).toBeNull();
        expect(sanitizeGoServerServiceConfig).not.toHaveBeenCalled();
    });
});
