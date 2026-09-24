/**
 * BetterDesk Web Remote Client - Connection Manager
 * Handles WebSocket connections to hbbs (rendezvous) and hbbr (relay)
 * via the Node.js WS proxy endpoints.
 */

// eslint-disable-next-line no-unused-vars
class RDConnection {
    /**
     * @param {Object} opts
     * @param {string} opts.baseUrl  - Base URL of the BetterDesk server (auto-detected)
     */
    constructor(opts = {}) {
        const loc = window.location;
        const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
        this.wsBase = opts.baseUrl || `${wsProtocol}//${loc.host}`;

        /** @type {WebSocket|null} */
        this.rendezvousWs = null;
        /** @type {WebSocket|null} */
        this.relayWs = null;

        this._state = 'disconnected'; // disconnected | rendezvous | relay | connected | error
        this._listeners = {};
        this._lastClose = null;
    }

    get state() { return this._state; }

    /**
     * Guest Access Link token for WS auth (?guest=) — do not rely only on cookie.
     * @returns {string}
     */
    _guestQuerySuffix() {
        try {
            const q = new URLSearchParams(window.location.search);
            const token = q.get('guest') || q.get('t') || window.__guestToken || '';
            if (token) return `?guest=${encodeURIComponent(token)}`;
        } catch (_) { /* ignore */ }
        return '';
    }

    // ---- Event emitter ----

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
        return this;
    }

    off(event, fn) {
        const arr = this._listeners[event];
        if (arr) this._listeners[event] = arr.filter(f => f !== fn);
        return this;
    }

    _emit(event, ...args) {
        const arr = this._listeners[event];
        if (arr) arr.forEach(fn => fn(...args));
    }

    _recordClose(kind, event) {
        const info = {
            kind,
            code: event && Number.isFinite(event.code) ? event.code : 0,
            reason: event && event.reason ? String(event.reason) : '',
            at: Date.now()
        };
        this._lastClose = info;
        return info;
    }

    // ---- Rendezvous connection ----

    /**
     * Connect to hbbs rendezvous server via WS proxy
     * @returns {Promise<WebSocket>}
     */
    connectRendezvous() {
        return new Promise((resolve, reject) => {
            this._setState('rendezvous');
            const url = `${this.wsBase}/ws/rendezvous${this._guestQuerySuffix()}`;

            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                this.rendezvousWs = ws;
                this._lastClose = null;
                this._emit('rendezvous:open');
                resolve(ws);
            };

            ws.onerror = (e) => {
                this._emit('rendezvous:error', e);
                reject(new Error('Rendezvous connection failed'));
            };

            ws.onclose = (e) => {
                this.rendezvousWs = null;
                const info = this._recordClose('rendezvous', e);
                this._emit('rendezvous:close', info.code, info.reason, info);
            };

            ws.onmessage = (e) => {
                this._emit('rendezvous:message', e.data);
            };
        });
    }

    /**
     * Send binary data to rendezvous server
     * @param {Uint8Array} data
     */
    sendRendezvous(data) {
        if (this.rendezvousWs && this.rendezvousWs.readyState === WebSocket.OPEN) {
            this.rendezvousWs.send(data);
        }
    }

    /**
     * Close rendezvous connection
     */
    closeRendezvous() {
        if (this.rendezvousWs) {
            this.rendezvousWs.close();
            this.rendezvousWs = null;
        }
    }

    // ---- Relay connection ----

    /**
     * Connect to hbbr relay server via WS proxy
     * @returns {Promise<WebSocket>}
     */
    connectRelay() {
        return new Promise((resolve, reject) => {
            this._setState('relay');
            const guestQuery = this._guestQuerySuffix();
            const url = `${this.wsBase}/ws/relay${guestQuery}${guestQuery ? '&' : '?'}transport=message`;

            const ws = new WebSocket(url);
            ws.binaryType = 'arraybuffer';

            ws.onopen = () => {
                this.relayWs = ws;
                this._lastClose = null;
                this._emit('relay:open');
                resolve(ws);
            };

            ws.onerror = (e) => {
                this._emit('relay:error', e);
                reject(new Error('Relay connection failed'));
            };

            ws.onclose = (e) => {
                this.relayWs = null;
                const info = this._recordClose('relay', e);
                this._emit('relay:close', info.code, info.reason, info);
                if (this._state === 'connected') {
                    this._setState('disconnected');
                    this._emit('disconnected', info.reason || 'Connection closed', info);
                }
            };

            ws.onmessage = (e) => {
                this._emit('relay:message', e.data);
            };
        });
    }

    /**
     * Send binary data to relay server
     * @param {Uint8Array} data
     */
    sendRelay(data) {
        if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
            this.relayWs.send(data);
        }
    }

    /**
     * Mark connection as established
     */
    setConnected() {
        this._setState('connected');
    }

    /**
     * Close all connections
     */
    close() {
        this.closeRendezvous();
        if (this.relayWs) {
            this.relayWs.close();
            this.relayWs = null;
        }
        this._setState('disconnected');
    }

    _setState(state) {
        if (this._state !== state) {
            const prev = this._state;
            this._state = state;
            this._emit('state', state, prev);
        }
    }
}

// Export for browser
window.RDConnection = RDConnection;
