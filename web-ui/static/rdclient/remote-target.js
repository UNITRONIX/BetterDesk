/**
 * BetterDesk Remote Target viewer.
 *
 * Minimal Guacamole protocol client kept local to BetterDesk. It deliberately
 * handles only the protocol primitives required for RDP/VNC screen, mouse,
 * keyboard and clipboard sessions; optional Guacamole capabilities are exposed
 * through capability flags instead of being silently emulated.
 */
(function (global) {
    'use strict';

    class RemoteTargetSession {
        constructor(canvas, opts) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.opts = opts || {};
            this.listeners = new Map();
            this.socket = null;
            this.parser = new Parser();
            this.args = [];
            this.stream = null;
            this.password = '';
            this.viewOnly = false;
            this.state = 'idle';
            this.renderer = { resize: () => this.resize() };
            this.capabilities = {
                clipboard: true,
                mouse: true,
                keyboard: true,
                fileTransfer: false,
                audio: false,
                multiMonitor: false,
                recording: false
            };
            this._bindInput();
        }

        on(name, callback) {
            if (!this.listeners.has(name)) this.listeners.set(name, []);
            this.listeners.get(name).push(callback);
            return this;
        }

        emit(name, ...args) {
            for (const callback of this.listeners.get(name) || []) {
                try { callback(...args); } catch (_) { /* UI listeners are isolated */ }
            }
        }

        setState(state) {
            this.state = state;
            this.emit('state', state);
        }

        connect() {
            const mode = String(global.__capabilities?.remote_target_config?.credential_mode || 'prompt');
            if (mode === 'prompt' && !this.password) {
                this.setState('waiting_password');
                this.emit('password_required');
                return Promise.resolve();
            }
            return this._open();
        }

        authenticate(password) {
            this.password = String(password || '');
            return this._open();
        }

        _open() {
            this.disconnect();
            this.setState('connecting');
            const id = encodeURIComponent(this.opts.deviceId || '');
            const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
            this.socket = new WebSocket(`${scheme}//${location.host}/ws/remote-target/${id}`);
            this.socket.onopen = () => {
                this._send('select', String(global.__capabilities?.remote_protocol || 'rdp'));
                this._send('size', String(this.canvas.clientWidth || 1024), String(this.canvas.clientHeight || 768), '96');
            };
            this.socket.onmessage = event => {
                const text = typeof event.data === 'string'
                    ? event.data
                    : new TextDecoder().decode(event.data);
                try {
                    for (const instruction of this.parser.feed(text)) this._handle(instruction);
                } catch (error) {
                    this.emit('error', error.message || 'Invalid remote target protocol');
                    this.disconnect();
                }
            };
            this.socket.onerror = () => {
                this.emit('error', 'RDP/VNC gateway connection failed');
                this.setState('error');
            };
            this.socket.onclose = () => {
                if (this.state !== 'error') this.setState('disconnected');
                this.emit('disconnected');
            };
            return Promise.resolve();
        }

        _handle(instruction) {
            const [opcode, ...args] = instruction;
            if (opcode === 'args') {
                this.args = args;
                this._sendConnect();
            } else if (opcode === 'ready') {
                this.setState('streaming');
                this.emit('session_start');
            } else if (opcode === 'img') {
                this.stream = {
                    kind: 'image',
                    mime: args[2] || 'image/png',
                    x: Number(args[3] || 0),
                    y: Number(args[4] || 0),
                    width: Number(args[5] || 0),
                    height: Number(args[6] || 0),
                    chunks: []
                };
            } else if (opcode === 'clipboard') {
                this.stream = { kind: 'clipboard', mime: args[1] || 'text/plain', chunks: [] };
            } else if (opcode === 'blob' && this.stream) {
                this.stream.chunks.push(args[1] || '');
            } else if (opcode === 'end' && this.stream) {
                if (this.stream.kind === 'clipboard') {
                    try {
                        const bytes = Uint8Array.from(atob(this.stream.chunks.join('')), c => c.charCodeAt(0));
                        navigator.clipboard?.writeText(new TextDecoder().decode(bytes));
                    } catch (_) { /* clipboard permission is browser-controlled */ }
                } else {
                    this._drawStream(this.stream);
                }
                this.stream = null;
            } else if (opcode === 'sync') {
                this._send('sync', args[0] || '0');
            } else if (opcode === 'error') {
                const message = args[1] || args[0] || 'RDP/VNC connection failed';
                const fingerprint = message.match(/(?:fingerprint|thumbprint)[:=\s]+([a-f0-9: -]{32,128})/i)?.[1]
                    ?.replace(/\s+/g, '').toLowerCase() || '';
                if (fingerprint) this.emit('certificate_required', { message, fingerprint });
                this.emit('login_error', message);
                this.emit('error', message);
                this.setState('error');
            }
        }

        _sendConnect() {
            const config = global.__capabilities?.remote_target_config || {};
            const values = this.args.map(name => {
                switch (String(name).toLowerCase()) {
                    case 'hostname':
                    case 'host':
                    case 'server': return '';
                    case 'port': return '';
                    case 'username':
                    case 'user': return config.username || '';
                    case 'password': return this.password;
                    case 'width': return String(this.canvas.clientWidth || 1024);
                    case 'height': return String(this.canvas.clientHeight || 768);
                    case 'dpi': return '96';
                    case 'ignore-cert': return 'false';
                    case 'timezone': return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
                    default: return '';
                }
            });
            this._send('connect', ...values);
        }

        _send(opcode, ...args) {
            if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
            this.socket.send(encodeInstruction([opcode, ...args]));
        }

        _drawStream(stream) {
            const binary = Uint8Array.from(atob(stream.chunks.join('')), c => c.charCodeAt(0));
            const blob = new Blob([binary], { type: stream.mime });
            createImageBitmap(blob).then(image => {
                this.ctx.drawImage(image, stream.x, stream.y, stream.width || image.width, stream.height || image.height);
                image.close();
            }).catch(() => {});
        }

        _bindInput() {
            this.canvas.addEventListener('mousemove', event => {
                if (this.viewOnly) return;
                const rect = this.canvas.getBoundingClientRect();
                this._send('mouse', String(Math.round(event.clientX - rect.left)), String(Math.round(event.clientY - rect.top)), '0');
            });
            this.canvas.addEventListener('mousedown', event => {
                if (this.viewOnly) return;
                this._send('mouse', String(event.offsetX), String(event.offsetY), String(1 << event.button));
            });
            this.canvas.addEventListener('mouseup', event => {
                if (this.viewOnly) return;
                this._send('mouse', String(event.offsetX), String(event.offsetY), '0');
            });
            this.canvas.addEventListener('wheel', event => {
                if (this.viewOnly) return;
                event.preventDefault();
                this._send('mouse', String(event.offsetX), String(event.offsetY), event.deltaY < 0 ? '8' : '16');
            }, { passive: false });
            this.canvas.addEventListener('keydown', event => {
                if (this.viewOnly) return;
                event.preventDefault();
                this._send('key', String(event.keyCode || 0), '1');
            });
            this.canvas.addEventListener('keyup', event => {
                if (this.viewOnly) return;
                event.preventDefault();
                this._send('key', String(event.keyCode || 0), '0');
            });
            this.canvas.addEventListener('paste', event => {
                if (this.viewOnly) return;
                const text = event.clipboardData?.getData('text/plain') || '';
                if (!text) return;
                event.preventDefault();
                const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
                this._send('clipboard', '0', 'text/plain');
                this._send('blob', '0', encoded);
                this._send('end', '0');
            });
        }

        resize() {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = Math.max(1, Math.round(rect.width || 1024));
            this.canvas.height = Math.max(1, Math.round(rect.height || 768));
        }

        setViewOnly(value) { this.viewOnly = !!value; }
        setScaleMode() {}
        setBackgroundFps() {}
        setQualityPreset() {}
        setFpsMode() {}
        setCodec() {}
        setKeyboardMode() {}
        disconnect() {
            if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
            this.socket = null;
        }
    }

    class Parser {
        constructor() { this.buffer = ''; }
        feed(data) {
            this.buffer += data;
            const output = [];
            let offset = 0;
            while (offset < this.buffer.length) {
                const fields = [];
                let index = offset;
                let complete = false;
                while (index < this.buffer.length) {
                    const dot = this.buffer.indexOf('.', index);
                    if (dot < 0) break;
                    const length = Number(this.buffer.slice(index, dot));
                    if (!Number.isInteger(length) || length < 0) throw new Error('Invalid Guacamole field');
                    const start = dot + 1;
                    const end = start + length;
                    if (end >= this.buffer.length) break;
                    const separator = this.buffer[end];
                    fields.push(this.buffer.slice(start, end));
                    index = end + 1;
                    if (separator === ';') { complete = true; break; }
                    if (separator !== ',') throw new Error('Invalid Guacamole separator');
                }
                if (!complete) break;
                output.push(fields);
                offset = index;
            }
            this.buffer = this.buffer.slice(offset);
            return output;
        }
    }

    function encodeInstruction(fields) {
        return fields.map(value => {
            const text = String(value ?? '');
            return `${new TextEncoder().encode(text).length}.${text}`;
        }).join(',') + ';';
    }

    global.RemoteTargetSession = RemoteTargetSession;
})(window);
