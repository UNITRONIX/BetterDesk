'use strict';

const svc = require('../services/serverConnectionConfigService');

describe('serverConnectionConfigService', () => {
    const sampleSystemd = `[Unit]
Description=BetterDesk Server

[Service]
Type=simple
ExecStart=/opt/betterdesk/betterdesk-server -mode all
Environment=P2P_FIRST=Y
Environment=ALWAYS_USE_RELAY=N
Restart=always

[Install]
WantedBy=multi-user.target
`;

    const sampleCompose = `services:
  server:
    image: betterdesk-server:local
    environment:
      - ENCRYPTED_ONLY=1
      - DB_URL=/opt/rustdesk/db_v2.sqlite3
      - P2P_FIRST=Y
  console:
    environment:
      - NODE_ENV=production
`;

    it('derives connection mode from env vars', () => {
        expect(svc.modeFromEnvVars({ P2P_FIRST: 'Y', ALWAYS_USE_RELAY: 'N' })).toBe('p2p_first');
        expect(svc.modeFromEnvVars({ P2P_FIRST: 'N', ALWAYS_USE_RELAY: 'Y' })).toBe('relay_only');
        expect(svc.modeFromEnvVars({ ALWAYS_USE_RELAY: 'Y' })).toBe('relay_only');
    });

    it('builds env vars from settings', () => {
        const relayVars = svc.envVarsFromSettings({
            mode: 'relay_only',
            p2p_fallback_ms: 3000,
            same_nat_relay: false,
            allow_shared_nat_initiator: true,
            logged_in_only_initiator: true,
            operator_only_outbound: true
        });
        expect(relayVars.P2P_FIRST).toBe('N');
        expect(relayVars.ALWAYS_USE_RELAY).toBe('Y');
        expect(relayVars.P2P_FALLBACK_MS).toBe('3000');
        expect(relayVars.SAME_NAT_RELAY).toBe('N');
        expect(relayVars.ALLOW_SHARED_NAT_INITIATOR).toBe('Y');
        expect(relayVars.LOGGED_IN_ONLY_INITIATOR).toBe('Y');
        expect(relayVars.OPERATOR_ONLY_OUTBOUND).toBe('Y');
    });

    it('parses and patches systemd environment blocks', () => {
        const systemdEnv = svc.parseSystemdEnvironment(sampleSystemd);
        expect(systemdEnv.P2P_FIRST).toBe('Y');
        expect(systemdEnv.ALWAYS_USE_RELAY).toBe('N');

        const relayVars = svc.envVarsFromSettings({
            mode: 'relay_only',
            p2p_fallback_ms: 3000,
            same_nat_relay: false,
            logged_in_only_initiator: true,
            operator_only_outbound: true
        });
        const patchedSystemd = svc.patchSystemdEnvironment(sampleSystemd, relayVars);
        expect(patchedSystemd).toContain('Environment=P2P_FIRST=N');
        expect(patchedSystemd).toContain('Environment=ALWAYS_USE_RELAY=Y');
        expect(patchedSystemd).toContain('Environment=LOGGED_IN_ONLY_INITIATOR=Y');
        expect(patchedSystemd).toContain('Environment=OPERATOR_ONLY_OUTBOUND=Y');
        expect(patchedSystemd.match(/Environment=P2P_FIRST=Y/m)).toBeNull();
    });

    it('parses and patches docker-compose server environment only', () => {
        const composeEnv = svc.parseDockerComposeEnvironment(sampleCompose);
        expect(composeEnv.P2P_FIRST).toBe('Y');
        expect(composeEnv.ALWAYS_USE_RELAY).toBeUndefined();

        const relayVars = svc.envVarsFromSettings({
            mode: 'relay_only',
            p2p_fallback_ms: 3000,
            same_nat_relay: false,
            logged_in_only_initiator: true,
            operator_only_outbound: true
        });
        const patchedCompose = svc.patchDockerComposeEnvironment(sampleCompose, relayVars);
        expect(patchedCompose).toContain('- P2P_FIRST=N');
        expect(patchedCompose).toContain('- ALWAYS_USE_RELAY=Y');
        expect(patchedCompose).toContain('- LOGGED_IN_ONLY_INITIATOR=Y');
        expect(patchedCompose).toContain('- OPERATOR_ONLY_OUTBOUND=Y');
        expect(patchedCompose).toContain('- ENCRYPTED_ONLY=1');
        expect(patchedCompose).not.toMatch(/console:\n    environment:\n      - P2P_FIRST/);
    });

    it('parses login-only initiator setting', () => {
        const settings = svc.settingsFromEnv(
            { P2P_FIRST: 'Y', LOGGED_IN_ONLY_INITIATOR: 'Y' },
            'systemd'
        );
        expect(settings.logged_in_only_initiator).toBe(true);
    });

    it('parses operator-only outbound setting', () => {
        const settings = svc.settingsFromEnv(
            { P2P_FIRST: 'Y', OPERATOR_ONLY_OUTBOUND: 'Y' },
            'systemd'
        );
        expect(settings.operator_only_outbound).toBe(true);
    });

    it('exports systemd connection drop-in path', () => {
        expect(svc.SYSTEMD_CONNECTION_DROPIN).toContain('betterdesk-server.service.d');
        expect(svc.SYSTEMD_CONNECTION_DROPIN).toContain('50-betterdesk-connection.conf');
    });
});
