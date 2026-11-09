/**
 * PunchHoleResponse success/failure interpretation for RdClient web.
 *
 * Proto3 `failure` defaults to 0 (ID_NOT_EXIST) when unset, so success cannot
 * be inferred from failure alone. Server #405 may return Failure=OFFLINE with
 * relay_server still set — explicit non-zero failure must win over hasRelay.
 *
 * Dual-use: browser global + Node require for tests.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.RDPunchHoleResponse = factory();
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FAILURE = {
        ID_NOT_EXIST: 0,
        OFFLINE: 2,
        LICENSE_MISMATCH: 3,
        LICENSE_OVERUSE: 4
    };

    const FAILURE_NAMES = {
        0: 'Device not found',
        2: 'Device offline',
        3: 'License mismatch',
        4: 'Too many connections'
    };

    /**
     * @param {object|null|undefined} resp - decoded PunchHoleResponse
     * @returns {{ error: string } | { relayServer: string, uuid: string, pk: *, natType: * }}
     */
    function interpretPunchHoleResponse(resp) {
        if (!resp || typeof resp !== 'object') {
            return { error: 'Empty PunchHoleResponse' };
        }

        const failure = Number(resp.failure);
        const failureCode = Number.isFinite(failure) ? failure : 0;
        const otherFailure = String(resp.otherFailure || resp.other_failure || '').trim();
        const relayServer = String(resp.relayServer || resp.relay_server || '');
        const socketAddr = resp.socketAddr || resp.socket_addr || null;
        const hasRelay = relayServer.length > 0;
        const hasSocket = !!(socketAddr && socketAddr.length);

        // Explicit non-zero Failure (#405 OFFLINE / license) — even with relay_server.
        if (
            failureCode === FAILURE.OFFLINE
            || failureCode === FAILURE.LICENSE_MISMATCH
            || failureCode === FAILURE.LICENSE_OVERUSE
            || otherFailure
        ) {
            return {
                error: otherFailure || FAILURE_NAMES[failureCode] || `Unknown error (code: ${failureCode})`
            };
        }

        if (hasRelay || hasSocket) {
            const natType = resp.natType != null ? resp.natType : resp.nat_type;
            return {
                relayServer,
                uuid: resp.uuid || '',
                pk: resp.pk || null,
                natType
            };
        }

        return {
            error: otherFailure || FAILURE_NAMES[FAILURE.ID_NOT_EXIST] || 'Device not found'
        };
    }

    return {
        FAILURE,
        FAILURE_NAMES,
        interpretPunchHoleResponse
    };
}));
