'use strict';

const test = global.test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const jsRoot = path.join(root, 'public/js');
const read = (name) => fs.readFileSync(path.join(jsRoot, name), 'utf8');

function setup() {
    const timers = new Map();
    let nextTimer = 0;
    const errors = [];
    const ctx = {
        window: {},
        Promise,
        document: { addEventListener() {} },
        console: {
            log() {},
            warn() {},
            error(e) {
                errors.push(e);
            },
        },
        setTimeout(fn, ms) {
            const id = ++nextTimer;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        LocalFiles: function () {},
    };
    vm.createContext(ctx);
    vm.runInContext(read('rdclient/file-connection.js'), ctx);
    vm.runInContext(read('rdclient/client.js'), ctx);
    vm.runInContext(read('rdclient/file-modal.js'), ctx);
    const FileClass = ctx.window.RDFileConnection;
    let file;
    ctx.window.RDFileConnection = function () {
        file = Object.create(FileClass.prototype);
        file._listeners = {};
        file._state = 'authenticating';
        file.proto = { buildAuth2FA: (code) => ({ auth_2fa: { code } }) };
        file.sent = [];
        file._sendPeerMessageRaw = (msg) => file.sent.push(msg);
        file.conn = { close() {} };
        file.connect = async function () {
            await this._waitForLogin('password');
            this._setState('ready');
            this._emit('ready');
        };
        return file;
    };
    vm.runInContext('RDFileConnection = window.RDFileConnection;', ctx);
    const client = Object.create(ctx.window.RDClient.prototype);
    Object.assign(client, {
        opts: {},
        deviceId: 'test',
        _listeners: {},
        _state: 'streaming',
        _fileConnection: null,
        _file2FAPending: false,
        _sessionActive: true,
        _viewOnly: false,
        proto: { loaded: true, buildAuth2FA: (code) => ({ auth_2fa: { code } }) },
        fileTransfer: {},
        desktopSent: [],
        input: {
            running: true,
            start() {
                this.running = true;
            },
            stop() {
                this.running = false;
            },
        },
        _loadFileTransferRuntime: async () => {},
        _debugRelay() {},
        _handleError(e) {
            throw e;
        },
        _sendPeerMessage(msg) {
            this.desktopSent.push(msg);
        },
    });
    const events = [];
    for (const event of [
        '2fa_required',
        '2fa_error',
        'login_error',
        '2fa_required_filetransfer',
        '2fa_error_filetransfer',
        '2fa_success_filetransfer',
        '2fa_cancelled_filetransfer',
        'filetransfer_error',
    ]) {
        client.on(event, (...args) => events.push({ event, args }));
    }
    function element() {
        return {
            style: { display: 'none' },
            value: '',
            textContent: '',
            callbacks: {},
            focus() {},
            blur() {},
            addEventListener(name, fn) {
                this.callbacks[name] = fn;
            },
        };
    }
    const verify = element();
    const session = {
        client,
        deviceId: 'test',
        state: 'streaming',
        tfaInput: element(),
        tfaError: element(),
        tfaOverlay: element(),
        statusText: element(),
        passwordInput: element(),
        passwordOverlay: element(),
        connectionOverlay: element(),
        panel: {
            querySelector(selector) {
                return selector === '.session-btn-verify-2fa' ? verify : null;
            },
        },
    };
    const modal = ctx.window.__fileTransferModal;
    modal._session = session;
    modal._el = { style: { display: 'flex' } };
    modal._hideContextMenu = () => {};
    modal._hideDragOverlay = () => {};
    const toasts = [];
    Object.assign(ctx, {
        isActive: () => true,
        setToolbarChromeVisible() {},
        syncToolbarChrome() {},
        hideToolbarChromeForSession() {},
        showToast: (...args) => toasts.push(args),
        _: (key) => key,
        updateTabState() {},
        syncToolbarToSession() {},
        handleSessionState(s, state) {
            s.state = state;
        },
    });
    const remote = read('remote.js');
    function extract(name) {
        const start = remote.indexOf('    function ' + name + '(');
        const end = remote.indexOf('\n    function ', start + 1);
        assert.ok(start >= 0 && end > start);
        return remote.slice(start, end);
    }
    vm.runInContext(extract('wireSessionEvents') + '\n' + extract('wireSessionDomEvents'), ctx);
    ctx.wireSessionEvents(session);
    ctx.wireSessionDomEvents(session);
    function submit(code) {
        session.tfaInput.value = code;
        verify.callbacks.click();
    }
    return {
        ctx,
        client,
        events,
        timers,
        errors,
        session,
        modal,
        toasts,
        submit,
        get file() {
            return file;
        },
        async connect() {
            const promise = client.ensureFileConnection();
            for (let i = 0; i < 10 && !file; i++) await Promise.resolve();
            assert.ok(file, 'file transport was created');
            return { promise };
        },
        fireTimer(ms) {
            const entry = [...timers].find(([, t]) => t.ms === ms);
            assert.ok(entry, 'timer exists: ' + ms);
            timers.delete(entry[0]);
            entry[1].fn();
        },
    };
}

function acceptDesktopOTP(s, code = '123456') {
    s.client._processPeerInfo = () => {};
    s.client._startSession = () => s.client._setState('streaming');
    s.client._handleLoginResponse({ error: '2FA Required' });
    s.submit(code);
    s.client._handleLoginResponse({});
}

test('desktop event and Verify API retain their behavior', () => {
    const s = setup();
    s.client._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.session.tfaSource, 'desktop');
    assert.equal(s.session.tfaOverlay.style.display, 'flex');
    s.submit('123456');
    assert.equal(s.client.desktopSent[0].auth_2fa.code, '123456');
    assert.equal(s.client.state, 'authenticating');
    assert.equal(s.events.filter((e) => e.event.endsWith('_filetransfer')).length, 0);
    assert.deepEqual(s.errors, []);
});

test('file challenge uses its own event and Verify answers only the file relay', async () => {
    const s = setup();
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.events.filter((e) => e.event === '2fa_required').length, 0);
    assert.equal(s.events.filter((e) => e.event === '2fa_required_filetransfer').length, 1);
    assert.equal(s.client.state, 'streaming');
    assert.equal(s.client.input.running, false);
    assert.equal(s.modal._el.style.visibility, 'hidden');
    s.submit('123456');
    assert.equal(s.file.sent[0].auth_2fa.code, '123456');
    assert.equal(s.client.desktopSent.length, 0);
    assert.equal(s.client.state, 'streaming');
    s.file._handleLoginResponse({ peerInfo: {} });
    await promise;
    assert.equal(s.file.state, 'ready');
    assert.equal(s.session.tfaOverlay.style.display, 'none');
    assert.equal(s.session.tfaSource, null);
    assert.equal(s.modal._el.style.visibility, '');
    assert.equal(s.client.input.running, true);
    assert.equal(s.timers.size, 0);
    assert.deepEqual(s.errors, []);
});

test('wrong OTP permits retry on the file relay and does not emit desktop errors', async () => {
    const s = setup();
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.submit('111111');
    s.file._handleLoginResponse({ error: 'Wrong 2FA Code' });
    assert.equal(s.file.state, 'waiting_2fa');
    assert.equal(s.session.tfaError.textContent, 'Wrong 2FA Code');
    assert.equal(s.events.filter((e) => e.event === '2fa_error').length, 0);
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.file.sent.length, 2);
    assert.equal(s.client.state, 'streaming');
    assert.deepEqual(s.errors, []);
});

test('duplicate Verify while a response is pending does not send another OTP', async () => {
    const s = setup();
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.submit('111111');
    s.submit('111111');
    assert.equal(s.file.sent.length, 1);
    s.file._handleLoginResponse({});
    await promise;
});

test('2FA timeout closes the OTP UI and preserves the streaming desktop', async () => {
    const s = setup();
    const { promise } = await s.connect();
    const rejected = assert.rejects(promise, /2FA timeout/);
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.deepEqual(
        [...s.timers.values()].map((t) => t.ms),
        [120000],
    );
    s.fireTimer(120000);
    await rejected;
    assert.equal(s.session.tfaOverlay.style.display, 'none');
    assert.equal(s.modal._el.style.visibility, '');
    assert.equal(s.client._fileConnection, null);
    assert.equal(s.client.state, 'streaming');
    assert.equal(s.timers.size, 0);
    assert.deepEqual(s.errors, []);
});

test('normal file login without 2FA does not show an OTP prompt', async () => {
    const s = setup();
    const { promise } = await s.connect();
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.session.tfaOverlay.style.display, 'none');
    assert.equal(s.events.filter((e) => e.event.endsWith('_filetransfer')).length, 0);
});

test('file login failure leaves the desktop password UI closed', async () => {
    const s = setup();
    const { promise } = await s.connect();
    const rejected = assert.rejects(promise, /Wrong Password/);
    s.file._handleLoginResponse({ error: 'Wrong Password' });
    await rejected;
    assert.equal(s.events.filter((e) => e.event === 'login_error').length, 0);
    assert.equal(s.client.state, 'streaming');
    assert.equal(s.session.passwordOverlay.style.display, 'none');
});

test('closing the file connection during 2FA cleans pending login and overlay', async () => {
    const s = setup();
    const { promise } = await s.connect();
    const rejected = assert.rejects(promise, /Disconnected/);
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.client.disconnectFileConnection();
    await rejected;
    assert.equal(s.client._file2FAPending, false);
    assert.equal(s.session.tfaOverlay.style.display, 'none');
    assert.equal(s.timers.size, 0);
});

test('file authentication completion does not resume input on inactive tabs', async () => {
    const s = setup();
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.client._sessionActive = false;
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.client.input.running, false);
});

test('the modal of another session is unaffected by this session authentication', () => {
    const s = setup();
    s.modal._session = { deviceId: 'other' };
    s.client._emit('2fa_required_filetransfer');
    assert.equal(s.modal._el.style.visibility, undefined);
    assert.deepEqual(s.errors, []);
});

test('stale file relay events cannot hijack the current authentication UI', async () => {
    const s = setup();
    const { promise } = await s.connect();
    const old = s.file;
    old._handleLoginResponse({});
    await promise;
    s.client._fileConnection = { state: 'ready' };
    old._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.client._file2FAPending, false);
    assert.equal(s.session.tfaOverlay.style.display, 'none');
});

test('file relay closure rejects OTP wait and preserves the desktop', async () => {
    const s = setup();
    const { promise } = await s.connect();
    const rejected = assert.rejects(promise, /Disconnected/);
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.file._setState('disconnected');
    s.file._emit('disconnected', 'Relay closed');
    await rejected;
    assert.equal(s.client.state, 'streaming');
    assert.equal(s.session.tfaOverlay.style.display, 'none');
    assert.equal(s.timers.size, 0);
});

test('an old rejected file login cannot close a replacement relay', async () => {
    const s = setup();
    const { promise } = await s.connect();
    const rejected = assert.rejects(promise, /Disconnected/);
    const replacement = {
        state: 'ready',
        disconnect() {
            throw new Error('replacement closed');
        },
    };
    const old = s.file;
    s.client._fileConnection = replacement;
    old.disconnect();
    await rejected;
    assert.equal(s.client._fileConnection, replacement);
});

test('accepted desktop OTP is used once for files without a second dialog', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.file.sent[0].auth_2fa.code, '123456');
    assert.equal(s.client.desktopSent.length, 1);
    assert.equal(s.events.filter((e) => e.event === '2fa_required_filetransfer').length, 0);
    assert.equal(s.session.tfaOverlay.style.display, 'none');
    assert.equal(s.client._desktopOTP, null);
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.client.state, 'streaming');
    assert.equal(s.client.input.running, true);
    assert.equal(s.timers.size, 0);
    assert.deepEqual(s.errors, []);
});

test('rejected automatic OTP opens the file dialog and allows a new code', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.file._handleLoginResponse({ error: 'Wrong 2FA Code' });
    assert.equal(s.session.tfaSource, 'filetransfer');
    assert.equal(s.session.tfaOverlay.style.display, 'flex');
    assert.equal(s.session.tfaError.textContent, 'Wrong 2FA Code');
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.file.sent.length, 2);
    assert.equal(s.file.sent[1].auth_2fa.code, '222222');
    assert.equal(s.client.desktopSent.length, 1);
    assert.equal(s.timers.size, 0);
});

test('15 second expiration erases the OTP and falls back to manual authentication', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    s.fireTimer(15000);
    assert.equal(s.client._desktopOTP, null);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.file.sent.length, 0);
    assert.equal(s.session.tfaOverlay.style.display, 'flex');
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
});

test('timestamp also rejects stale OTP if browser delayed the cleanup timer', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    s.client._desktopOTP.expiresAt = Date.now() - 1;
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.file.sent.length, 0);
    assert.equal(s.client._desktopOTP, null);
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
});

test('a desktop-rejected OTP is erased and never sent to the file relay', async () => {
    const s = setup();
    s.client._handleLoginResponse({ error: '2FA Required' });
    s.submit('111111');
    s.client._handleLoginResponse({ error: 'Wrong 2FA Code' });
    assert.equal(s.client._desktopOTP, null);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.file.sent.length, 0);
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
});

test('OTP is not reused until desktop login has actually succeeded', async () => {
    const s = setup();
    s.client._handleLoginResponse({ error: '2FA Required' });
    s.submit('111111');
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.file.sent.length, 0);
    assert.equal(s.client._desktopOTP, null);
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
});

test('automatic reply timeout shows manual dialog and permits retry', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.fireTimer(5000);
    assert.equal(s.session.tfaOverlay.style.display, 'flex');
    assert.equal(s.file.state, 'waiting_2fa');
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.file.sent.length, 2);
    assert.equal(s.client.desktopSent.length, 1);
    assert.equal(s.timers.size, 0);
});

test('a repeated challenge cannot automatically replay the consumed OTP again', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({ error: '2FA Required' });
    s.file._handleLoginResponse({ error: '2FA Required' });
    assert.equal(s.file.sent.length, 1);
    assert.equal(s.session.tfaOverlay.style.display, 'flex');
    s.submit('222222');
    s.file._handleLoginResponse({});
    await promise;
});

test('no-2FA file success and disconnect both erase any reusable OTP', async () => {
    const s = setup();
    acceptDesktopOTP(s);
    const { promise } = await s.connect();
    s.file._handleLoginResponse({});
    await promise;
    assert.equal(s.client._desktopOTP, null);
    assert.equal(s.timers.size, 0);
    s.client._rememberDesktopOTP('333333');
    s.client.disconnectFileConnection();
    assert.equal(s.client._desktopOTP, null);
    assert.equal(s.timers.size, 0);
});
