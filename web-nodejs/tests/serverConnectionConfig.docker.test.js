'use strict';

describe('serverConnectionConfigService Docker split mode', () => {
    let service;
    let apiClient;

    beforeEach(() => {
        jest.resetModules();
        process.env.BETTERDESK_DOCKER_LAYOUT = 'split';

        apiClient = {
            get: jest.fn().mockResolvedValue({
                data: {
                    mode: 'p2p_first',
                    p2p_fallback_ms: 2500,
                    same_nat_relay: true,
                    allow_shared_nat_initiator: false,
                    logged_in_only_initiator: true,
                    operator_only_outbound: false,
                },
            }),
            put: jest.fn().mockResolvedValue({
                data: {
                    config: {
                        mode: 'relay_only',
                        p2p_fallback_ms: 3500,
                        same_nat_relay: false,
                        allow_shared_nat_initiator: true,
                        logged_in_only_initiator: true,
                        operator_only_outbound: true,
                    },
                },
            }),
        };

        jest.doMock('../config/config', () => ({ isDocker: true }));
        jest.doMock('../services/betterdeskApi', () => ({ apiClient }));
        jest.doMock('../services/updateService', () => ({
            COMPONENTS: { server: { service: 'betterdesk-server' } },
            daemonReload: jest.fn(),
            restartService: jest.fn(),
        }));
        jest.doMock('../lib/privilegedUpdateHelper', () => ({
            canUsePrivilegedUpdate: jest.fn(() => false),
            invokePrivilegedUpdate: jest.fn(),
        }));

        service = require('../services/serverConnectionConfigService');
    });

    afterEach(() => {
        delete process.env.BETTERDESK_DOCKER_LAYOUT;
        jest.resetModules();
    });

    test('reads and writes the Go server configuration as writable', async () => {
        expect(service.isDockerSplitDeployment()).toBe(true);

        const current = await service.getConnectionMode();
        expect(current.source).toBe('go-api');
        expect(current.writable).toBe(true);
        expect(current.p2p_fallback_ms).toBe(2500);

        const result = await service.setConnectionMode({
            mode: 'relay_only',
            p2p_fallback_ms: 3500,
            same_nat_relay: false,
            allow_shared_nat_initiator: true,
            logged_in_only_initiator: true,
            operator_only_outbound: true,
        });

        expect(apiClient.put).toHaveBeenCalledWith('/connection/config', {
            mode: 'relay_only',
            p2p_fallback_ms: 3500,
            same_nat_relay: false,
            allow_shared_nat_initiator: true,
            logged_in_only_initiator: true,
            operator_only_outbound: true,
        });
        expect(result.source).toBe('go-api');
        expect(result.restart).toBeNull();
        expect(result.restartRequired).toBeNull();
        expect(result.settings.operator_only_outbound).toBe(true);
    });

    test('fails closed when the Go API is unavailable', async () => {
        apiClient.get.mockRejectedValueOnce(new Error('server unavailable'));

        const current = await service.getConnectionMode();

        expect(current.source).toBe('go-api');
        expect(current.writable).toBe(false);
    });
});
