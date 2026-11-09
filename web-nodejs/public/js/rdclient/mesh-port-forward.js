/**
 * MeshCentral TCP/UDP port relay — browser WebSocket tunnel to remote host via MeshAgent.
 */
(function () {
    'use strict';

    var active = null;

    // POST requests need the console's CSRF token (as Utils.api sends it)
    function csrfHeaders(headers) {
        var token = window.BetterDesk && window.BetterDesk.csrfToken;
        if (token) headers['X-CSRF-Token'] = token;
        return headers;
    }

    function t(key, fallback) {
        if (typeof window.t === 'function') {
            var val = window.t(key);
            if (val && val !== key) return val;
        }
        return fallback !== undefined ? fallback : key;
    }

    function esc(value) {
        return (typeof Utils !== 'undefined' && Utils.escapeHtml) ? Utils.escapeHtml(String(value)) : String(value);
    }

    // Status line of the sheet while this relay is the open one
    function setStatus(session, message, tone) {
        if (!session || active !== session || typeof Modal === 'undefined') return;
        Modal.setStatus(message, tone);
    }

    // Disconnect. Unless closeSheet is false, also close the sheet (when it
    // was closed some other way it is already going).
    function closeRelay(closeSheet) {
        if (!active) return;
        var session = active;
        active = null;
        if (session.watcher) session.watcher.disconnect();
        if (session.ws) {
            try { session.ws.close(); } catch { /* ignore */ }
        }
        if (closeSheet !== false && session.sheetId && typeof Modal !== 'undefined' && document.getElementById(session.sheetId)) {
            Modal.close(session.sheetId);
        }
    }

    // A side sheet (GUIDE.md "Dialogs and sheets"): host and port, Connect in
    // the footer, then what goes over the connection and a field to send text.
    async function openMeshPortForward(deviceId, udp) {
        closeRelay();

        const title = (udp
            ? t('mesh.port_udp_title_named', 'UDP port relay through {id}')
            : t('mesh.port_tcp_title_named', 'TCP port relay through {id}')).replace('{id}', deviceId);
        const content =
            '<form class="form-stack mesh-port-form" novalidate>' +
            '<div class="form-group">' +
            '<label class="form-label" for="mesh-port-host">' + esc(t('mesh.port_host', 'Host')) + '</label>' +
            '<input type="text" id="mesh-port-host" class="form-input is-host mesh-port-host" value="127.0.0.1" autocomplete="off" spellcheck="false" aria-describedby="mesh-port-host-hint">' +
            '<p class="form-hint" id="mesh-port-host-hint">' + esc(t('mesh.port_host_hint', 'As seen from the device. 127.0.0.1 is the device itself.')) + '</p>' +
            '</div>' +
            '<div class="form-group">' +
            '<label class="form-label" for="mesh-port-port">' + esc(t('mesh.port_port', 'Port')) + '</label>' +
            '<input type="number" id="mesh-port-port" class="form-input is-short mesh-port-port" min="1" max="65535" value="3389" inputmode="numeric">' +
            '</div>' +
            '<section class="form-section" aria-labelledby="mesh-port-traffic-title">' +
            '<h3 class="form-section-title" id="mesh-port-traffic-title">' + esc(t('mesh.port_traffic', 'Traffic')) + '</h3>' +
            '<div class="terminal-box mesh-port-log" role="log" aria-live="polite" aria-labelledby="mesh-port-traffic-title" tabindex="0"></div>' +
            '<div class="form-group">' +
            '<label class="form-label" for="mesh-port-send">' + esc(t('mesh.port_send_label', 'Text to send')) + '</label>' +
            '<div class="mesh-port-send-row">' +
            '<input type="text" id="mesh-port-send" class="form-input mesh-port-send-input" autocomplete="off" spellcheck="false" aria-describedby="mesh-port-send-hint">' +
            '<button type="button" class="btn mesh-port-send-btn">' + esc(t('mesh.port_send', 'Send')) + '</button>' +
            '</div>' +
            '<p class="form-hint" id="mesh-port-send-hint">' + esc(t('mesh.port_send_hint', 'Sent as it is once the relay is ready.')) + '</p>' +
            '</div>' +
            '</section>' +
            '<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>' +
            '</form>';

        const session = { sheetId: null, ws: null, ready: false, udp: udp };
        active = session;
        session.sheetId = Modal.sheet({
            title: title,
            subtitle: t('mesh.port_sheet_desc', 'Opens a connection from the device\'s MeshAgent to a host and port and shows what comes back.'),
            content: content,
            status: true,
            className: 'mesh-port-sheet',
            buttons: [
                { label: t('actions.close', 'Close'), class: 'btn-secondary', start: true, onClick: function () { closeRelay(); } },
                { label: t('mesh.port_connect', 'Connect'), class: 'btn-primary mesh-port-connect-btn', onClick: function () { connect(); } }
            ],
            onClose: function () { if (active === session) closeRelay(false); }
        });
        const overlay = document.getElementById(session.sheetId);
        if (!overlay) {
            active = null;
            return;
        }
        // Closed without onClose (replaced by another sheet or dialog): disconnect too
        session.watcher = new MutationObserver(function () {
            if (!document.contains(overlay) && active === session) closeRelay(false);
        });
        session.watcher.observe(overlay.parentNode, { childList: true });

        const form = overlay.querySelector('.mesh-port-form');
        const logEl = overlay.querySelector('.mesh-port-log');
        const hostInput = overlay.querySelector('.mesh-port-host');
        const portInput = overlay.querySelector('.mesh-port-port');
        const sendInput = overlay.querySelector('.mesh-port-send-input');

        function log(line, cls) {
            const div = document.createElement('div');
            div.className = 'mesh-port-log-line' + (cls ? ' ' + cls : '');
            div.textContent = line;
            logEl.appendChild(div);
            logEl.scrollTop = logEl.scrollHeight;
        }

        async function connect() {
            if (active !== session) return;
            const host = hostInput.value.trim() || '127.0.0.1';
            const port = parseInt(portInput.value, 10);
            portInput.removeAttribute('aria-invalid');
            if (!port || port < 1 || port > 65535) {
                const text = t('mesh.port_invalid', 'Invalid port');
                log(text, 'error');
                portInput.setAttribute('aria-invalid', 'true');
                portInput.focus();
                setStatus(session, text, 'error');
                return;
            }
            if (session.ws) {
                try { session.ws.close(); } catch { /* ignore */ }
                session.ws = null;
                session.ready = false;
            }
            try {
                const path = udp ? 'udp' : 'tcp';
                const relayBase = encodeURIComponent(window.location.origin + '/');
                setStatus(session, t('mesh.port_connecting', 'Connecting…'));
                const resp = await fetch('/api/mesh/devices/' + encodeURIComponent(deviceId) + '/' + path + '?relay_base=' + relayBase, {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: csrfHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
                    body: JSON.stringify({ host, port }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.error || 'Tunnel failed');
                }
                const data = await resp.json();
                const url = data.browser_url || data.data && data.data.browser_url;
                if (!url) throw new Error('No relay URL');
                const wsUrl = url.indexOf('http') === 0 ? url.replace(/^http/, 'ws') : window.location.origin + url;
                const ws = new WebSocket(wsUrl);
                ws.binaryType = 'arraybuffer';
                session.ws = ws;
                log(t('mesh.port_connecting', 'Connecting…'));

                ws.onmessage = (ev) => {
                    if (typeof ev.data === 'string') {
                        if (ev.data === 'c' || ev.data === 'cr') {
                            if (!session.ready) {
                                session.ready = true;
                                ws.send('14');
                                const text = t('mesh.port_connected', 'Relay ready — binary mode');
                                log(text);
                                setStatus(session, text, 'ok');
                            }
                            return;
                        }
                        log('[text] ' + ev.data);
                        return;
                    }
                    const buf = new Uint8Array(ev.data);
                    let text = '';
                    try {
                        text = new TextDecoder().decode(buf);
                    } catch {
                        text = '[' + buf.length + ' bytes]';
                    }
                    log('[rx] ' + text);
                };
                ws.onerror = () => {
                    const text = t('mesh.port_error', 'WebSocket error');
                    log(text, 'error');
                    setStatus(session, text, 'error');
                };
                ws.onclose = () => {
                    if (session.ws !== ws) return;
                    session.ready = false;
                    const text = t('mesh.port_closed', 'Disconnected');
                    log(text);
                    setStatus(session, text);
                };
            } catch (err) {
                const text = err.message || String(err);
                log(text, 'error');
                setStatus(session, text, 'error');
            }
        }

        function send() {
            if (active !== session) return;
            if (!session.ws || session.ws.readyState !== WebSocket.OPEN || !session.ready) {
                setStatus(session, t('mesh.port_not_ready', 'Connect first, then send.'), 'error');
                return;
            }
            const text = sendInput.value;
            if (!text) return;
            session.ws.send(new TextEncoder().encode(text));
            log('[tx] ' + text);
            sendInput.value = '';
        }

        overlay.querySelector('.mesh-port-send-btn').addEventListener('click', send);
        // Enter in the text field sends it; Enter in host or port connects
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (document.activeElement === sendInput) send();
            else connect();
        });
    }

    window.openMeshPortForward = openMeshPortForward;
    window.closeMeshPortForward = function () { closeRelay(); };
})();
