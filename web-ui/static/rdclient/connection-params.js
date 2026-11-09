/**
 * Normalize Go /api/health `connection` snapshot for RdClient web timeouts.
 * Dual-use: browser global + Node require for tests.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RDConnectionParams = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULTS = {
        p2p_first: true,
        always_use_relay: false,
        p2p_fallback_ms: 2000,
        same_nat_relay: true,
        allow_shared_nat_initiator: false,
        relay_servers: ''
    };

    /**
     * @param {object|null|undefined} connection
     * @returns {typeof DEFAULTS}
     */
    function normalizeConnection(connection) {
        const src = connection && typeof connection === 'object' ? connection : {};
        const fallbackRaw = Number(src.p2p_fallback_ms);
        return {
            p2p_first: src.p2p_first !== false && src.p2p_first !== 'false',
            always_use_relay: src.always_use_relay === true || src.always_use_relay === 'true',
            p2p_fallback_ms: Number.isFinite(fallbackRaw) && fallbackRaw >= 0
                ? fallbackRaw
                : DEFAULTS.p2p_fallback_ms,
            same_nat_relay: src.same_nat_relay !== false && src.same_nat_relay !== 'false',
            allow_shared_nat_initiator: src.allow_shared_nat_initiator === true
                || src.allow_shared_nat_initiator === 'true',
            relay_servers: String(src.relay_servers || '')
        };
    }

    /**
     * Browser Web Remote always force-relays; still size waits from server fallback.
     * @param {object|null|undefined} connection
     * @returns {{ rendezvousMs: number, signalRelayMs: number, connection: object }}
     */
    function resolveConnectTimeouts(connection) {
        const normalized = normalizeConnection(connection);
        const waitMs = Math.max(15000, normalized.p2p_fallback_ms + 10000);
        return {
            rendezvousMs: waitMs,
            signalRelayMs: waitMs,
            connection: normalized
        };
    }

    return {
        DEFAULTS,
        normalizeConnection,
        resolveConnectTimeouts
    };
}));
