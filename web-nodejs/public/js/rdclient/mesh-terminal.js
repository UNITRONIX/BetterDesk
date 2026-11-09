/**
 * MeshCentral remote terminal (relay p=1) for MeshAgent devices.
 */
(function () {
    'use strict';

    var XTERM_VERSION = '5.5.0';
    var XTERM_CSS_URL = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@' + XTERM_VERSION + '/css/xterm.min.css';
    var XTERM_JS_URL = 'https://cdn.jsdelivr.net/npm/@xterm/xterm@' + XTERM_VERSION + '/lib/xterm.min.js';
    // addon-fit has its own version line (0.10.0 goes with xterm 5.5.0)
    var XTERM_FIT_VERSION = '0.10.0';
    var XTERM_FIT_URL = 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@' + XTERM_FIT_VERSION + '/lib/addon-fit.min.js';
    var CTRL = '102938';
    var PROTOCOL = '1';

    var xtermLoaded = false;
    var xtermLoading = null;
    var activeModal = null;

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

    function loadXterm() {
        if (xtermLoaded) return Promise.resolve();
        if (xtermLoading) return xtermLoading;
        xtermLoading = new Promise(function (resolve, reject) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = XTERM_CSS_URL;
            document.head.appendChild(link);
            var script = document.createElement('script');
            script.src = XTERM_JS_URL;
            script.onload = function () {
                var fitScript = document.createElement('script');
                fitScript.src = XTERM_FIT_URL;
                fitScript.onload = function () { xtermLoaded = true; resolve(); };
                fitScript.onerror = function () { reject(new Error('xterm-addon-fit load failed')); };
                document.head.appendChild(fitScript);
            };
            script.onerror = function () { reject(new Error('xterm load failed')); };
            document.head.appendChild(script);
        });
        return xtermLoading;
    }

    function ctrlMsg(type, fields) {
        var o = { ctrlChannel: CTRL, type: type };
        if (fields) Object.assign(o, fields);
        return JSON.stringify(o);
    }

    // Status line of the sheet (Modal.setStatus) while this terminal is the open one
    function setStatus(session, message, tone) {
        if (!session || activeModal !== session || typeof Modal === 'undefined') return;
        Modal.setStatus(message, tone);
    }

    // Disconnect and free the terminal. Unless closeSheet is false, also close
    // its sheet (when the sheet was closed some other way it is already going).
    function closeModal(closeSheet) {
        if (!activeModal) return;
        var session = activeModal;
        activeModal = null;
        if (session.watcher) session.watcher.disconnect();
        if (session.ws) {
            try { session.ws.close(); } catch { /* ignore */ }
        }
        if (session.resizeObserver) session.resizeObserver.disconnect();
        if (session.term) session.term.dispose();
        if (closeSheet !== false && session.sheetId && typeof Modal !== 'undefined' && document.getElementById(session.sheetId)) {
            Modal.close(session.sheetId);
        }
    }

    async function openMeshTerminal(deviceId) {
        if (activeModal) closeModal();

        try {
            await loadXterm();
        } catch (err) {
            if (typeof Notifications !== 'undefined') {
                Notifications.error(err.message);
            }
            return;
        }

        var Terminal = window.Terminal;
        var FitAddon = window.FitAddon && window.FitAddon.FitAddon;
        if (!Terminal || !FitAddon) {
            if (typeof Notifications !== 'undefined') Notifications.error('Terminal library unavailable');
            return;
        }

        // A wide side sheet (GUIDE.md "Dialogs and sheets"): Escape, focus return
        // and the close button come from modal.js. Escape inside the terminal
        // belongs to the shell; Shift+Escape closes the sheet from there.
        var session = {
            sheetId: null,
            term: null,
            fitAddon: null,
            ws: null,
            relayReady: false,
        };
        activeModal = session;
        session.sheetId = Modal.sheet({
            title: t('mesh.terminal_title_named', 'Remote terminal on {id}').replace('{id}', deviceId),
            subtitle: t('mesh.terminal_sheet_desc', 'A shell on the device through its MeshAgent. Escape goes to the shell, Shift+Escape closes the terminal.'),
            content: '<div class="terminal-box mesh-terminal-host" role="region" aria-label="' +
                Utils.escapeHtml(t('mesh.terminal_title', 'Remote terminal')) + '"></div>',
            wide: true,
            status: true,
            className: 'mesh-terminal-sheet',
            buttons: [
                { label: t('actions.close', 'Close'), class: 'btn-secondary', onClick: function () { closeModal(); } }
            ],
            onClose: function () { if (activeModal === session) closeModal(false); }
        });
        var overlay = document.getElementById(session.sheetId);
        if (!overlay) {
            activeModal = null;
            return;
        }
        // Closed without onClose (replaced by another sheet or dialog): disconnect too
        session.watcher = new MutationObserver(function () {
            if (!document.contains(overlay) && activeModal === session) closeModal(false);
        });
        session.watcher.observe(overlay.parentNode, { childList: true });

        var host = overlay.querySelector('.mesh-terminal-host');
        var fitAddon = new FitAddon();
        var term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: "'IBM Plex Mono', 'Cascadia Code', 'Consolas', monospace",
            // The colours of .terminal-box: dark in both themes
            // ANSI red and yellow lightened to stay above 4.5:1 on that background
            theme: { background: '#111414', foreground: '#e3e6e6', red: '#ff8a80', brightRed: '#ffb4ab', yellow: '#f0d264', brightYellow: '#ffe08a' },
            scrollback: 5000,
        });
        term.loadAddon(fitAddon);
        term.open(host);
        session.term = term;
        session.fitAddon = fitAddon;
        // Escape goes to the shell; Shift+Escape reaches modal.js and closes the sheet
        term.attachCustomKeyEventHandler(function (e) {
            return !(e.key === 'Escape' && e.shiftKey);
        });
        host.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !e.shiftKey) e.stopPropagation();
        });
        var connecting = t('mesh.port_connecting', 'Connecting…');
        term.writeln('\x1b[33m' + connecting + '\x1b[0m');
        setStatus(session, connecting);
        try { fitAddon.fit(); } catch { /* ignore */ }
        term.focus();

        var resizeObserver = new ResizeObserver(function () {
            try {
                fitAddon.fit();
                sendTermSize(session);
            } catch { /* ignore */ }
        });
        resizeObserver.observe(host);
        session.resizeObserver = resizeObserver;

        try {
            var relayBase = window.location.origin + '/';
            var resp = await fetch(
                '/api/mesh/devices/' + encodeURIComponent(deviceId) + '/terminal?relay_base=' + encodeURIComponent(relayBase),
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: csrfHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
                }
            );
            if (!resp.ok) {
                var errBody = await resp.json().catch(function () { return {}; });
                throw new Error(errBody.error || 'Terminal tunnel failed');
            }
            var data = await resp.json();
            var url = data.browser_url || data.data && data.data.browser_url;
            if (!url) throw new Error('No relay URL');
            var wsUrl = url.indexOf('http') === 0 ? url.replace(/^http/, 'ws') : window.location.origin + url;
            var ws = new WebSocket(wsUrl);
            ws.binaryType = 'arraybuffer';
            session.ws = ws;

            ws.onmessage = function (ev) {
                if (typeof ev.data === 'string') {
                    if (ev.data === 'c' || ev.data === 'cr') {
                        if (!session.relayReady) {
                            session.relayReady = true;
                            ws.send(PROTOCOL);
                            term.clear();
                            sendTermSize(session);
                            term.focus();
                            setStatus(session, t('mesh.terminal_connected', 'Connected.'), 'ok');
                        }
                        return;
                    }
                    try {
                        var msg = JSON.parse(ev.data);
                        if (msg.ctrlChannel === CTRL && msg.type === 'console' && msg.msg) {
                            term.writeln('\x1b[33m' + msg.msg + '\x1b[0m');
                        }
                    } catch { /* ignore */ }
                    return;
                }
                var buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(ev.data.buffer);
                term.write(buf);
            };

            ws.onerror = function () {
                var text = t('mesh.port_error', 'WebSocket error');
                term.writeln('\x1b[31m' + text + '\x1b[0m');
                setStatus(session, text, 'error');
            };
            ws.onclose = function () {
                if (activeModal !== session) return;
                var text = t('mesh.port_closed', 'Disconnected');
                term.writeln('\x1b[33m' + text + '\x1b[0m');
                setStatus(session, text);
            };

            term.onData(function (data) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(new TextEncoder().encode(data));
                }
            });
            term.onResize(function () { sendTermSize(session); });
        } catch (err) {
            term.writeln('\x1b[31m' + err.message + '\x1b[0m');
            setStatus(session, err.message, 'error');
        }
    }

    function sendTermSize(session) {
        if (!session.ws || session.ws.readyState !== WebSocket.OPEN || !session.relayReady) return;
        session.ws.send(ctrlMsg('termsize', {
            cols: session.term.cols,
            rows: session.term.rows,
        }));
    }

    window.openMeshTerminal = openMeshTerminal;
    window.closeMeshTerminal = function () { closeModal(); };
})();
