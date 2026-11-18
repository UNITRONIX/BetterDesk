/**
 * Shared clipboard state for all remote sessions in one viewer window.
 * The browser clipboard is permission-gated, so this in-memory hub is also
 * the reliable hand-off point when a remote write cannot reach the OS.
 */

class RDClipboardHub {
    constructor() {
        this._latest = null;
        this._sequence = 0;
        this._listeners = new Set();
        this._sent = new Map();
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    getLatest() {
        return this._latest;
    }

    setFromRemote(entry, sourceSessionId) {
        return this._set(entry, 'remote', sourceSessionId);
    }

    setFromLocal(entry) {
        return this._set(entry, 'local', null);
    }

    markSent(sessionId, sequence) {
        if (sessionId && sequence) this._sent.set(String(sessionId), sequence);
    }

    shouldSendTo(sessionId) {
        if (!this._latest || !sessionId) return false;
        const id = String(sessionId);
        if (this._latest.sourceSessionId === id) return false;
        return this._sent.get(id) !== this._latest.sequence;
    }

    _set(entry, source, sourceSessionId) {
        const value = entry || {};
        const fingerprint = [
            value.text ? String(value.text) : '',
            value.html ? String(value.html) : '',
            value.pngBlob ? `${value.pngBlob.type || ''}:${value.pngBlob.size || 0}` : ''
        ].join('\u0000');
        if (this._latest && this._latest.fingerprint === fingerprint) {
            return this._latest;
        }
        const normalized = {
            text: value.text ? String(value.text) : '',
            html: value.html ? String(value.html) : '',
            pngBlob: value.pngBlob || null,
            source,
            sourceSessionId: sourceSessionId ? String(sourceSessionId) : null,
            timestamp: Date.now(),
            sequence: ++this._sequence,
            fingerprint
        };
        if (!normalized.text && !normalized.html && !normalized.pngBlob) return null;
        this._latest = normalized;
        this._sent.clear();
        for (const listener of this._listeners) {
            try { listener(normalized); } catch (err) { console.error(err); }
        }
        return normalized;
    }
}

window.RDClipboardHub = RDClipboardHub;
window.rdClipboardHub = window.rdClipboardHub || new RDClipboardHub();
