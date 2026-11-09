/**
 * Dev-only mock remote session (served at /dev/mock-remote.js only when
 * BD_DEV_MOCK_REMOTE=1). It stands in for RDClient: same events, same
 * methods, no network. It goes through the connecting steps with short
 * delays, then draws a made-up desktop into the viewer's own canvas through
 * the real RDRenderer, so scaling, full screen, recording and every control
 * of the viewer can be reviewed without a device.
 *
 * Scenarios (?mock=1&scenario=...): ok, slow, password (accepts "demo"),
 * 2fa (password "demo", code 123456), fail-relay, refused, offline,
 * timeout, ended, dropped. The scenario applies to the first device; tabs
 * opened later with "New connection" connect normally.
 */
/* global RDRenderer */
(function () {
    'use strict';

    var cfg = window.__mockRemote || {};
    var FIRST_ID = window.__initialDeviceId || '';

    function scenarioFor(deviceId) {
        return deviceId === FIRST_ID ? (cfg.scenario || 'ok') : 'ok';
    }

    // ---- A small fake file system on the "device" ----

    var KB = 1024;
    var MB = 1024 * 1024;

    function remoteTree() {
        return {
            '/home/demo': [
                { name: 'Documents', isDir: true },
                { name: 'Downloads', isDir: true },
                { name: 'Pictures', isDir: true },
                { name: '.bashrc', isDir: false, size: 3 * KB, hidden: true },
                { name: 'build.log', isDir: false, size: 248 * KB },
                { name: 'notes.txt', isDir: false, size: 2 * KB },
                { name: 'release-1.4.2.tar.gz', isDir: false, size: 86 * MB },
            ],
            '/home/demo/Documents': [
                { name: 'handover.pdf', isDir: false, size: 1.2 * MB },
                { name: 'inventory.csv', isDir: false, size: 40 * KB },
                { name: 'setup-guide.odt', isDir: false, size: 380 * KB },
            ],
            '/home/demo/Downloads': [
                { name: 'driver-update.zip', isDir: false, size: 24 * MB },
                { name: 'printer-manual.pdf', isDir: false, size: 3.4 * MB },
            ],
            '/home/demo/Pictures': [
                { name: 'office-plan.png', isDir: false, size: 920 * KB },
                { name: 'screenshot-0412.png', isDir: false, size: 610 * KB },
            ],
        };
    }

    // Files on "this computer" for the left pane (no real disk access in the mock)
    function MockLocalFiles() {
        this._mode = 'mock';
        this._path = 'Review files';
        this._stack = [];
        this._tree = {
            'Review files': [
                { name: 'Scripts', isDir: true },
                { name: 'checklist.txt', isDir: false, size: 4 * KB },
                { name: 'config-backup.json', isDir: false, size: 18 * KB },
                { name: 'support-tool.exe', isDir: false, size: 12 * MB },
            ],
            'Review files/Scripts': [
                { name: 'cleanup.ps1', isDir: false, size: 6 * KB },
                { name: 'collect-logs.sh', isDir: false, size: 3 * KB },
            ],
        };
    }
    Object.defineProperty(MockLocalFiles.prototype, 'hasRoot', { get: function () { return true; } });
    Object.defineProperty(MockLocalFiles.prototype, 'currentPath', { get: function () { return this._path; } });
    MockLocalFiles.prototype.pickRoot = async function () { this._path = 'Review files'; this._stack = []; return this._path; };
    MockLocalFiles.prototype.listCurrent = async function () { return (this._tree[this._path] || []).slice(); };
    MockLocalFiles.prototype.enterDir = async function (entry) {
        this._stack.push(this._path);
        this._path = this._path + '/' + entry.name;
        return this._path;
    };
    MockLocalFiles.prototype.goUp = async function () { if (this._stack.length) this._path = this._stack.pop(); return this._path; };
    MockLocalFiles.prototype.goHome = async function () { this._path = 'Review files'; this._stack = []; return this._path; };
    MockLocalFiles.prototype.readFile = async function (entry) { return { name: entry.name, size: entry.size || 0, type: '' }; };
    MockLocalFiles.prototype.walkFolder = async function (entry) {
        var path = this._path + '/' + entry.name;
        var files = (this._tree[path] || []).filter(function (e) { return !e.isDir; })
            .map(function (e) { return { relPath: entry.name + '/' + e.name, file: { name: e.name, size: e.size } }; });
        return { rootName: entry.name, dirs: [], files: files };
    };
    MockLocalFiles.prototype.saveDownload = async function () { return true; };

    // ---- File transfer with fake progress ----

    function MockFileTransfer(client) {
        this._client = client;
        this.enabled = false;
        this.showHidden = false;
        this.currentPath = '';
        this._tree = remoteTree();
        this._nextId = 1;
        this._jobs = new Map();
        this._saveDownload = null;
    }

    MockFileTransfer.prototype._emit = function () { this._client._emit.apply(this._client, arguments); };
    MockFileTransfer.prototype.enable = function () { this.enabled = true; };
    MockFileTransfer.prototype.setShowHidden = function (on) { this.showHidden = !!on; this.browseDir(this.currentPath); };

    MockFileTransfer.prototype.browseDir = function (path) {
        var self = this;
        var target = path || '/home/demo';
        if (!this._tree[target]) target = '/home/demo';
        this._emit('file_connecting');
        this._emit('file_browsing');
        setTimeout(function () {
            self.currentPath = target;
            var entries = self._tree[target].filter(function (e) { return self.showHidden || !e.hidden; });
            self._emit('file_dir', { path: target, entries: entries.map(function (e) { return { name: e.name, isDir: e.isDir, size: Math.round(e.size || 0), modified: Date.now() - 86400000 }; }) });
        }, 350);
    };

    MockFileTransfer.prototype.browseParent = function () {
        var p = this.currentPath || '/home/demo';
        var up = p.replace(/\/[^/]+$/, '') || '/home/demo';
        this.browseDir(this._tree[up] ? up : '/home/demo');
    };

    MockFileTransfer.prototype.createDir = function (path) {
        var name = String(path).split('/').pop();
        (this._tree[this.currentPath] || []).push({ name: name, isDir: true });
        this._tree[this.currentPath + '/' + name] = [];
        this._emit('file_action');
    };

    MockFileTransfer.prototype._removeEntry = function (path) {
        var dir = path.replace(/\/[^/]+$/, '');
        var name = path.split('/').pop();
        this._tree[dir] = (this._tree[dir] || []).filter(function (e) { return e.name !== name; });
        this._emit('file_action');
    };
    MockFileTransfer.prototype.removeFile = function (path) { this._removeEntry(path); };
    MockFileTransfer.prototype.removeDir = function (path) { this._removeEntry(path); };
    MockFileTransfer.prototype.rename = function (path, newName) {
        var dir = path.replace(/\/[^/]+$/, '');
        var name = path.split('/').pop();
        (this._tree[dir] || []).forEach(function (e) { if (e.name === name) e.name = newName; });
        this._emit('file_action');
    };

    // One job: start, progress in steps, done. Big files take a few seconds.
    MockFileTransfer.prototype._run = function (type, fileName, size, onDone, isFolder) {
        var self = this;
        var id = this._nextId++;
        var total = Math.max(1, Math.round(size || 1));
        var job = { id: id, done: 0, total: total, timer: null };
        this._jobs.set(id, job);
        this._emit('file_transfer_start', { id: id, fileName: fileName, fileSize: total, type: type, isFolder: !!isFolder });
        var steps = total > 20 * MB ? 40 : 14;
        var n = 0;
        job.timer = setInterval(function () {
            n++;
            job.done = Math.min(total, Math.round(total * n / steps));
            self._emit('file_transfer_progress', { id: id, percent: Math.round(100 * job.done / total), transferred: job.done, fileSize: total, isFolder: !!isFolder });
            if (n >= steps) {
                clearInterval(job.timer);
                self._jobs.delete(id);
                self._emit('file_transfer_complete', { id: id, fileName: fileName, isFolder: !!isFolder });
                if (onDone) onDone();
            }
        }, 150);
        return id;
    };

    MockFileTransfer.prototype.uploadFile = function (file, dir) {
        var self = this;
        var name = (file && file.name) || 'file';
        var size = (file && file.size) || 64 * KB;
        var target = dir || this.currentPath || '/home/demo';
        this._run('upload', name, size, function () {
            var list = self._tree[target] || (self._tree[target] = []);
            if (!list.some(function (e) { return e.name === name; })) list.push({ name: name, isDir: false, size: size });
            self._emit('file_action');
        });
    };

    MockFileTransfer.prototype.uploadFolder = function (walk, dir) {
        var self = this;
        var target = dir || this.currentPath || '/home/demo';
        var size = (walk.files || []).reduce(function (a, f) { return a + ((f.file && f.file.size) || 0); }, 0) || 64 * KB;
        this._run('upload', walk.rootName || 'folder', size, function () {
            var list = self._tree[target] || (self._tree[target] = []);
            if (!list.some(function (e) { return e.name === walk.rootName; })) list.push({ name: walk.rootName, isDir: true });
            self._tree[target + '/' + walk.rootName] = (walk.files || []).map(function (f) { return { name: f.file.name, isDir: false, size: f.file.size }; });
            self._emit('file_action');
        }, true);
    };

    MockFileTransfer.prototype.downloadFile = function (dir, entry) {
        this._run('download', entry.name, entry.size || 64 * KB, null);
    };

    MockFileTransfer.prototype.downloadFolder = function (dir, entry) {
        this._run('download', entry.name, 5 * MB, null, true);
    };

    MockFileTransfer.prototype.cancelTransfer = function (id) {
        var job = this._jobs.get(id);
        if (job) { clearInterval(job.timer); this._jobs.delete(id); }
        this._emit('file_transfer_cancelled', { id: id });
    };
    MockFileTransfer.prototype.resumeTransfer = function () { /* nothing fails in the mock */ };
    MockFileTransfer.prototype.confirmOverwrite = function () { /* no overwrite prompts in the mock */ };
    MockFileTransfer.prototype.stopAll = function () {
        this._jobs.forEach(function (job) { clearInterval(job.timer); });
        this._jobs.clear();
    };

    // ---- The made-up desktop ----

    var FONT = '"IBM Plex Sans", system-ui, sans-serif';
    var MONO = '"IBM Plex Mono", ui-monospace, Consolas, monospace';
    var TITLE_H = 34;
    var TASKBAR_H = 48;

    function pad2(n) { return String(n).padStart(2, '0'); }

    function MockDesktop(host) {
        this.host = host;
        this.monitors = [
            { idx: 0, name: 'Display 1', width: 1920, height: 1080, primary: true, wall: ['#123a46', '#0d2530'] },
            { idx: 1, name: 'Display 2', width: 1280, height: 1024, primary: false, wall: ['#2d2a46', '#1b1930'] },
        ];
        this.virtual = [];
        this.current = 0;
        this.windows = [
            { id: 'files', title: 'Files - /home/demo', kind: 'files', monitor: 0, x: 120, y: 90, w: 760, h: 520 },
            { id: 'term', title: 'Terminal - demo@build-server', kind: 'terminal', monitor: 0, x: 820, y: 300, w: 900, h: 560 },
            { id: 'web', title: 'Web browser - Build status', kind: 'browser', monitor: 1, x: 80, y: 70, w: 1080, h: 780 },
        ];
        this.z = ['files', 'term', 'web'];
        this.focusId = 'term';
        this.term = [
            'Welcome to the BetterDesk review desktop. Nothing here is real.',
            'Type "help" for the few commands this terminal knows.',
            '',
            'demo@build-server:~$ uptime',
            ' 14:02:11 up 12 days,  3:41,  1 user,  load average: 0.21, 0.30, 0.28',
        ];
        this.input = '';
        this.notes = [];
        this.overlay = null; // 'cad' | 'lock'
        this.banners = {};
        this.drag = null;
    }

    MockDesktop.prototype.monitor = function () {
        return this.monitors.concat(this.virtual)[this.current] || this.monitors[0];
    };

    MockDesktop.prototype.allMonitors = function () { return this.monitors.concat(this.virtual); };

    MockDesktop.prototype.note = function (text) {
        this.notes.push({ text: text, until: Date.now() + 3500 });
        if (this.notes.length > 3) this.notes.shift();
    };

    MockDesktop.prototype.windowsOn = function (m) {
        var self = this;
        return this.z.map(function (id) { return self.windows.find(function (w) { return w.id === id; }); })
            .filter(function (w) { return w && w.monitor === m; });
    };

    MockDesktop.prototype.hit = function (x, y) {
        var list = this.windowsOn(this.current);
        for (var i = list.length - 1; i >= 0; i--) {
            var w = list[i];
            if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
                return { win: w, title: y <= w.y + TITLE_H };
            }
        }
        return null;
    };

    MockDesktop.prototype.raise = function (w) {
        this.z = this.z.filter(function (id) { return id !== w.id; }).concat([w.id]);
        this.focusId = w.id;
    };

    MockDesktop.prototype.typeKey = function (key) {
        if (this.overlay === 'lock') { this.overlay = null; this.note('Signed in again'); return; }
        if (this.overlay === 'cad') { if (key === 'Escape') this.overlay = null; return; }
        var term = this.windows.find(function (w) { return w.id === 'term'; });
        if (this.focusId !== 'term' && term) { this.raise(term); if (term.monitor !== this.current) this.note('Typing goes to the terminal on Display ' + (term.monitor + 1)); }
        if (key === 'Enter') { this.run(this.input); this.input = ''; return; }
        if (key === 'Backspace') { this.input = this.input.slice(0, -1); return; }
        if (key.length === 1 && this.input.length < 120) this.input += key;
    };

    MockDesktop.prototype.run = function (cmd) {
        var c = cmd.trim();
        this.term.push('demo@build-server:~$ ' + cmd);
        if (!c) return;
        var out;
        switch (c) {
        case 'help': out = ['help, ls, whoami, date, uname -a, clear']; break;
        case 'ls': out = ['Documents  Downloads  Pictures  build.log  notes.txt  release-1.4.2.tar.gz']; break;
        case 'whoami': out = ['demo']; break;
        case 'date': out = [new Date().toString()]; break;
        case 'uname -a': out = ['Linux build-server 6.8.0 #1 SMP x86_64 GNU/Linux (mock)']; break;
        case 'clear': this.term = []; return;
        default: out = [c.split(' ')[0] + ': command not found (this is the review desktop)'];
        }
        Array.prototype.push.apply(this.term, out);
        if (this.term.length > 200) this.term.splice(0, this.term.length - 200);
    };

    MockDesktop.prototype.draw = function (ctx, w, h, opts) {
        var m = this.monitor();
        var now = new Date();
        // Wallpaper: two tones and a few soft shapes
        var g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, m.wall[0]);
        g.addColorStop(1, m.wall[1]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(w * 0.78, h * 0.22, h * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(w * 0.15, h * 0.85, h * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '600 22px ' + FONT;
        ctx.fillText(m.name + ' · ' + m.width + ' × ' + m.height + ' · review desktop', 28, 44);

        if (this.overlay === 'lock') { this.drawLock(ctx, w, h, now); return; }

        var self = this;
        this.windowsOn(this.current).forEach(function (win) { self.drawWindow(ctx, win, now); });
        this.drawTaskbar(ctx, w, h, now, opts);
        this.drawBanners(ctx, w);
        this.drawNotes(ctx, w, h);
        if (this.overlay === 'cad') this.drawCad(ctx, w, h);
    };

    MockDesktop.prototype.drawWindow = function (ctx, win, now) {
        var focused = this.focusId === win.id;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 6;
        ctx.fillStyle = '#f4f5f5';
        ctx.fillRect(win.x, win.y, win.w, win.h);
        ctx.restore();
        // Title bar
        ctx.fillStyle = focused ? '#2b3236' : '#4a5357';
        ctx.fillRect(win.x, win.y, win.w, TITLE_H);
        ctx.fillStyle = '#e8ecec';
        ctx.font = '500 15px ' + FONT;
        ctx.fillText(win.title, win.x + 14, win.y + 22);
        ['#d9534f', '#e0a33a', '#5cb85c'].forEach(function (c, i) {
            ctx.fillStyle = c;
            ctx.beginPath(); ctx.arc(win.x + win.w - 22 - i * 22, win.y + TITLE_H / 2, 6, 0, Math.PI * 2); ctx.fill();
        });
        var bx = win.x, by = win.y + TITLE_H, bw = win.w, bh = win.h - TITLE_H;
        ctx.save();
        ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
        if (win.kind === 'terminal') this.drawTerminal(ctx, bx, by, bw, bh, now, focused);
        else if (win.kind === 'files') this.drawFiles(ctx, bx, by, bw, bh);
        else this.drawBrowser(ctx, bx, by, bw, bh, now);
        ctx.restore();
    };

    MockDesktop.prototype.drawTerminal = function (ctx, x, y, w, h, now, focused) {
        ctx.fillStyle = '#101414';
        ctx.fillRect(x, y, w, h);
        ctx.font = '15px ' + MONO;
        var lineH = 22;
        var maxLines = Math.floor((h - 24) / lineH) - 1;
        var lines = this.term.slice(-maxLines);
        ctx.fillStyle = '#c8d3d3';
        var self = this;
        lines.forEach(function (l, i) { ctx.fillText(l.slice(0, 110), x + 14, y + 26 + i * lineH); });
        var py = y + 26 + lines.length * lineH;
        ctx.fillStyle = '#7fd4a8';
        var prompt = 'demo@build-server:~$ ';
        ctx.fillText(prompt, x + 14, py);
        var pw = ctx.measureText(prompt).width;
        ctx.fillStyle = '#e8ecec';
        ctx.fillText(self.input, x + 14 + pw, py);
        if (focused && Math.floor(now.getTime() / 530) % 2 === 0) {
            var iw = ctx.measureText(self.input).width;
            ctx.fillRect(x + 14 + pw + iw + 1, py - 15, 9, 19);
        }
    };

    MockDesktop.prototype.drawFiles = function (ctx, x, y, w, h) {
        ctx.fillStyle = '#e6e9ea';
        ctx.fillRect(x, y, 190, h);
        ctx.font = '15px ' + FONT;
        ctx.fillStyle = '#2b3236';
        ['Home', 'Documents', 'Downloads', 'Pictures', 'Trash'].forEach(function (s, i) {
            if (i === 0) { ctx.fillStyle = '#cdd6d8'; ctx.fillRect(x + 8, y + 12, 174, 30); ctx.fillStyle = '#2b3236'; }
            ctx.fillText(s, x + 22, y + 33 + i * 38);
        });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 190, y, w - 190, h);
        ctx.fillStyle = '#566064';
        ctx.font = '600 13px ' + FONT;
        ctx.fillText('Name', x + 210, y + 28);
        ctx.fillText('Size', x + w - 120, y + 28);
        var rows = [
            ['Documents', '-'], ['Downloads', '-'], ['Pictures', '-'], ['build.log', '248 kB'],
            ['notes.txt', '2 kB'], ['release-1.4.2.tar.gz', '86 MB'],
        ];
        ctx.font = '15px ' + FONT;
        rows.forEach(function (r, i) {
            var ry = y + 44 + i * 36;
            ctx.fillStyle = i % 2 ? '#ffffff' : '#f5f7f7';
            ctx.fillRect(x + 190, ry, w - 190, 36);
            ctx.fillStyle = r[1] === '-' ? '#2f6f8a' : '#8a96a0';
            ctx.fillRect(x + 210, ry + 10, 16, 14);
            ctx.fillStyle = '#1b1e1f';
            ctx.fillText(r[0], x + 238, ry + 23);
            ctx.fillStyle = '#566064';
            ctx.fillText(r[1], x + w - 120, ry + 23);
        });
    };

    MockDesktop.prototype.drawBrowser = function (ctx, x, y, w, h, now) {
        ctx.fillStyle = '#e6e9ea';
        ctx.fillRect(x, y, w, 46);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + 14, y + 9, w - 28, 28);
        ctx.fillStyle = '#566064';
        ctx.font = '14px ' + FONT;
        ctx.fillText('https://intranet.example/build-status', x + 26, y + 28);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y + 46, w, h - 46);
        ctx.fillStyle = '#1b1e1f';
        ctx.font = '600 28px ' + FONT;
        ctx.fillText('Build status', x + 40, y + 100);
        ctx.font = '16px ' + FONT;
        ctx.fillStyle = '#566064';
        ctx.fillText('Last refresh ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()), x + 40, y + 130);
        var jobs = [['main', 'passed', '#1c7a3b', 1.0], ['release-1.4', 'passed', '#1c7a3b', 0.86], ['nightly', 'running', '#1b62cf', 0.4 + 0.3 * Math.abs(Math.sin(now.getTime() / 3000))], ['docs', 'failed', '#b3261e', 0.62]];
        jobs.forEach(function (j, i) {
            var ry = y + 170 + i * 70;
            ctx.fillStyle = '#1b1e1f';
            ctx.font = '600 17px ' + FONT;
            ctx.fillText(j[0], x + 40, ry + 20);
            ctx.font = '15px ' + FONT;
            ctx.fillStyle = j[2];
            ctx.fillText(j[1], x + 200, ry + 20);
            ctx.fillStyle = '#e8ebeb';
            ctx.fillRect(x + 320, ry + 6, w - 380, 18);
            ctx.fillStyle = j[2];
            ctx.fillRect(x + 320, ry + 6, (w - 380) * j[3], 18);
        });
        ctx.fillStyle = '#8a96a0';
        for (var i = 0; i < 6; i++) ctx.fillRect(x + 40, y + 470 + i * 28, (w - 120) * (0.5 + ((i * 37) % 50) / 100), 12);
    };

    MockDesktop.prototype.drawTaskbar = function (ctx, w, h, now, opts) {
        var y = h - TASKBAR_H;
        ctx.fillStyle = 'rgba(16,20,20,0.92)';
        ctx.fillRect(0, y, w, TASKBAR_H);
        ctx.fillStyle = '#e8ecec';
        ctx.font = '600 16px ' + FONT;
        ctx.fillText('Apps', 22, y + 30);
        var self = this;
        var x = 100;
        this.windows.forEach(function (win) {
            var on = win.monitor === self.current;
            ctx.fillStyle = self.focusId === win.id ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
            ctx.fillRect(x, y + 8, 200, TASKBAR_H - 16);
            ctx.fillStyle = on ? '#e8ecec' : '#9aa4a8';
            ctx.font = '14px ' + FONT;
            ctx.fillText(win.title.split(' - ')[0], x + 12, y + 29);
            win._task = { x: x, y: y + 8, w: 200, h: TASKBAR_H - 16 };
            x += 210;
        });
        // Tray: what the viewer asked for, then the clock (ticks every second)
        var tray = (opts.codec || 'Auto') + ' · ' + opts.quality + ' · ' + opts.fps;
        ctx.font = '14px ' + FONT;
        ctx.fillStyle = '#9aa4a8';
        ctx.textAlign = 'right';
        ctx.fillText(tray, w - 140, y + 29);
        ctx.fillStyle = '#e8ecec';
        ctx.font = '600 16px ' + MONO;
        ctx.fillText(pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds()), w - 22, y + 30);
        ctx.textAlign = 'left';
    };

    MockDesktop.prototype.drawBanners = function (ctx, w) {
        var list = Object.keys(this.banners).map(function (k) { return this.banners[k]; }, this).filter(Boolean);
        list.forEach(function (text, i) {
            ctx.fillStyle = 'rgba(135,91,0,0.92)';
            ctx.fillRect(w / 2 - 330, 16 + i * 44, 660, 36);
            ctx.fillStyle = '#ffffff';
            ctx.font = '600 15px ' + FONT;
            ctx.textAlign = 'center';
            ctx.fillText(text, w / 2, 39 + i * 44);
            ctx.textAlign = 'left';
        });
    };

    MockDesktop.prototype.drawNotes = function (ctx, w, h) {
        var now = Date.now();
        this.notes = this.notes.filter(function (n) { return n.until > now; });
        this.notes.forEach(function (n, i) {
            var y = h - TASKBAR_H - 90 - i * 70;
            ctx.fillStyle = 'rgba(31,35,35,0.95)';
            ctx.fillRect(w - 440, y, 410, 58);
            ctx.fillStyle = '#58a6ff';
            ctx.fillRect(w - 440, y, 4, 58);
            ctx.fillStyle = '#e8ecec';
            ctx.font = '15px ' + FONT;
            ctx.fillText(n.text.slice(0, 48), w - 422, y + 34);
        });
    };

    MockDesktop.prototype.drawCad = function (ctx, w, h) {
        ctx.fillStyle = 'rgba(10,14,16,0.94)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#e8ecec';
        ctx.font = '600 30px ' + FONT;
        ctx.fillText('Ctrl+Alt+Del received', w / 2 - 200, h / 2 - 120);
        ctx.font = '20px ' + FONT;
        ['Lock', 'Switch user', 'Sign out', 'Task manager', 'Cancel (press Esc or click)'].forEach(function (s, i) {
            ctx.fillText(s, w / 2 - 200, h / 2 - 60 + i * 42);
        });
    };

    MockDesktop.prototype.drawLock = function (ctx, w, h, now) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.font = '300 120px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText(pad2(now.getHours()) + ':' + pad2(now.getMinutes()), w / 2, h / 2 - 20);
        ctx.font = '22px ' + FONT;
        ctx.fillText('Locked. Click or press a key to sign in again.', w / 2, h / 2 + 40);
        ctx.textAlign = 'left';
    };

    // ---- The transport stand-in ----

    var QUALITY_SCALE = { best: 1, balanced: 0.75, speed: 0.5 };

    function MockRemoteSession(canvas, opts) {
        opts = opts || {};
        this.deviceId = opts.deviceId;
        this.opts = opts;
        this.scenario = scenarioFor(this.deviceId);
        this.canvas = canvas;
        this.renderer = new RDRenderer(canvas);
        this.renderer.setScaleMode(opts.scaleMode || 'fit');
        this.input = null;
        this.video = null;
        this.audio = null;
        this.fileTransfer = new MockFileTransfer(this);
        this.desktop = new MockDesktop(this);
        this._state = 'idle';
        this._listeners = {};
        this._timers = [];
        this._peerInfo = null;
        this._viewOnly = false;
        this._active = true;
        this._quality = opts.qualityPreset || 'best';
        this._fpsMode = opts.fpsMode || 'adaptive';
        this._backgroundFps = 1;
        this._codec = opts.preferCodec && opts.preferCodec !== 'Auto' ? opts.preferCodec : 'VP9';
        this._keyboardMode = 'Auto';
        this._needsPassword = this.scenario === 'password' || this.scenario === '2fa';
        this._frameCanvas = document.createElement('canvas');
        this._frameCtx = this._frameCanvas.getContext('2d');
        this._lastFrame = 0;
        this._raf = 0;
        this._bound = false;
        this._sessionStartedAt = null;
        var self = this;
        this.renderer.onCursorReady = function (ready) {
            var c = self.canvas.parentElement;
            if (c) c.classList.toggle('has-remote-cursor', !!ready);
        };
        // The file sheet shows this computer's side from the mock too
        var modal = window.__fileTransferModal;
        if (modal && (!modal._local || modal._local._mode !== 'mock')) {
            var local = new MockLocalFiles();
            modal._local = local;
            modal._localEntries = local._tree[local.currentPath].slice();
            var open = modal.open;
            modal.open = function () {
                open.apply(modal, arguments);
                var pathEl = modal._el && modal._el.querySelector('.ft-local-path');
                if (pathEl) pathEl.textContent = local.currentPath;
            };
        }
    }

    var P = MockRemoteSession.prototype;

    Object.defineProperty(P, 'state', { get: function () { return this._state; } });
    Object.defineProperty(P, 'peerInfo', { get: function () { return this._peerInfo; } });
    Object.defineProperty(P, 'viewOnly', { get: function () { return this._viewOnly; } });

    P.on = function (event, fn) {
        (this._listeners[event] = this._listeners[event] || []).push(fn);
        return this;
    };
    P.off = function (event, fn) {
        var arr = this._listeners[event];
        if (arr) this._listeners[event] = arr.filter(function (f) { return f !== fn; });
        return this;
    };
    P._emit = function (event) {
        var args = Array.prototype.slice.call(arguments, 1);
        (this._listeners[event] || []).slice().forEach(function (fn) {
            try { fn.apply(null, args); } catch (e) { console.error(e); }
        });
    };
    P._setState = function (s) {
        if (this._state === s) return;
        var prev = this._state;
        this._state = s;
        this._emit('state', s, prev);
    };
    P._after = function (ms, fn) {
        var self = this;
        var id = setTimeout(function () {
            self._timers = self._timers.filter(function (t) { return t !== id; });
            fn();
        }, ms);
        this._timers.push(id);
    };
    P._clearTimers = function () {
        this._timers.forEach(clearTimeout);
        this._timers = [];
    };

    // The same log lines RDClient writes, so the viewer maps them to its steps
    P.connect = async function () {
        var self = this;
        var slow = this.scenario === 'slow';
        var t = 0;
        var at = function (ms, fn) { t += slow ? ms * 2.5 : ms; self._after(t, fn); };
        this._setState('connecting');
        this._emit('log', 'Loading protocol definitions...');
        at(350, function () { self._emit('log', 'Connecting to rendezvous server...'); });
        at(450, function () { self._emit('log', 'Requesting connection to ' + self.deviceId + '...'); });
        if (this.scenario === 'offline') {
            at(900, function () { self._fail('Connection refused: Device offline'); });
            return;
        }
        if (this.scenario === 'timeout') {
            at(5000, function () { self._fail('Rendezvous response timeout (30s) - target device may be offline'); });
            return;
        }
        at(500, function () { self._emit('log', 'Requesting relay (uuid: 6f1c2a9e...)...'); });
        at(450, function () { self._emit('log', 'Connecting to relay server...'); });
        at(400, function () {
            self._emit('log', 'Waiting for peer handshake...');
            self._setState('waiting_password');
        });
        if (this.scenario === 'fail-relay') {
            at(2600, function () {
                self._disconnect('Relay connection closed (WebSocket 1005)', { source: 'relay', closeCode: 1005, closeReason: '' });
            });
            return;
        }
        if (this.scenario === 'refused') {
            at(2200, function () { self._fail('Relay refused: the remote user declined the connection'); });
            return;
        }
        // Slow: the device answers only after the "someone has to accept" hint shows
        at(slow ? 5600 : 700, function () { self._emit('log', 'Peer identified: ' + self.deviceId); });
        at(300, function () { self._emit('log', 'Key exchange prepared, waiting for peer to decide encryption mode...'); });
        at(400, function () {
            if (self._needsPassword) {
                self._emit('log', 'Password required');
                self._setState('waiting_password');
                self._emit('password_required');
            } else {
                self._emit('log', 'No password required');
                self._startSession();
            }
        });
    };

    P.authenticate = async function (password) {
        var self = this;
        this._setState('authenticating');
        this._emit('log', 'Authenticating...');
        this._after(700, function () {
            if (password !== 'demo') {
                self._emit('login_error', 'Wrong Password');
                self._setState('waiting_password');
                return;
            }
            if (self.scenario === '2fa') {
                self._setState('waiting_2fa');
                self._emit('2fa_required');
                return;
            }
            self._loginOk();
        });
    };

    P.submit2FA = async function (code) {
        var self = this;
        this._setState('authenticating');
        this._emit('log', 'Verifying 2FA code...');
        this._after(600, function () {
            if (String(code) !== '123456') {
                self._setState('waiting_2fa');
                self._emit('2fa_error', 'Wrong 2FA Code');
                return;
            }
            self._loginOk();
        });
    };

    P._loginOk = function () {
        this._emit('log', 'Login successful');
        this._emit('login_success', {});
        this._startSession();
    };

    P._startSession = function () {
        var self = this;
        this._peerInfo = { platform: '', displays: this.getMonitors() };
        this._emit('peer_info', this._peerInfo);
        this._after(this.scenario === 'slow' ? 1500 : 300, function () {
            self._sessionStartedAt = Date.now();
            self._setState('streaming');
            self._bindInput();
            self._installCursor();
            self.renderer.startRenderLoop();
            self._loop();
            self._emit('session_start');
            self._emit('log', 'Video codec: ' + self._codec);
            self._latencyTimer = setInterval(function () {
                self._emit('latency', 16 + Math.round(Math.random() * 14));
                self._emit('stats', self.getStats());
            }, 2000);
            if (self.scenario === 'ended') {
                self._after(7000, function () {
                    self._disconnect('Remote: Closed manually by the peer', { source: 'peer', peerReason: 'Closed manually by the peer' });
                });
            }
            if (self.scenario === 'dropped') {
                self._after(7000, function () {
                    self._disconnect('Relay connection closed (WebSocket 1006)', { source: 'relay', closeCode: 1006, closeReason: '' });
                });
            }
        });
    };

    P._fail = function (msg) {
        this._stop();
        this._emit('diagnostics', { type: 'error', message: msg, at: Date.now() });
        this._emit('error', msg, { cdapFallback: false });
        this._setState('error');
    };

    P._disconnect = function (reason, meta) {
        this._stop();
        var info = Object.assign({ type: 'disconnect', reason: reason, at: Date.now(), transport: 'mock' }, meta || {});
        this._emit('diagnostics', info);
        this._emit('log', 'Disconnected: ' + reason);
        this._setState('disconnected');
        this._emit('disconnected', reason, info);
    };

    P._stop = function () {
        this._clearTimers();
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        if (this._latencyTimer) clearInterval(this._latencyTimer);
        this._latencyTimer = null;
        this.renderer.stopRenderLoop();
        this.fileTransfer.stopAll();
        this._unbindInput();
    };

    P.disconnect = function () {
        this._stop();
        this._setState('disconnected');
        this._emit('log', 'Disconnected');
    };

    // ---- Frames: the desktop drawn into a canvas, handed to the real renderer ----

    P._frameInterval = function () {
        if (!this._active) return 1000 / Math.max(1, this._backgroundFps);
        if (this._fpsMode === '60') return 1000 / 60;
        return 1000 / 30;
    };

    P._loop = function () {
        var self = this;
        var tick = function (ts) {
            if (self._state !== 'streaming') return;
            if (!self._lastFrame || ts - self._lastFrame >= self._frameInterval() - 2) {
                self._lastFrame = ts;
                self._pushFrame();
            }
            self._raf = requestAnimationFrame(tick);
        };
        this._raf = requestAnimationFrame(tick);
    };

    P._pushFrame = function () {
        var m = this.desktop.monitor();
        var scale = QUALITY_SCALE[this._quality] || 1;
        var fw = Math.round(m.width * scale);
        var fh = Math.round(m.height * scale);
        var c = this._frameCanvas;
        if (c.width !== fw || c.height !== fh) { c.width = fw; c.height = fh; }
        var ctx = this._frameCtx;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        var qualityName = { best: 'Best', balanced: 'Balanced', speed: 'Low' }[this._quality] || this._quality;
        var fpsName = this._fpsMode === 'adaptive' ? 'adaptive' : this._fpsMode + ' fps';
        this.desktop.draw(ctx, m.width, m.height, { codec: this._codec, quality: qualityName, fps: fpsName });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.renderer.pushFrame({ displayWidth: m.width, displayHeight: m.height, _source: c, _isNew: true, close: function () {} });
    };

    // A plain arrow, drawn once, sent as the remote cursor
    P._installCursor = function () {
        var cw = 18, ch = 26;
        var cc = document.createElement('canvas');
        cc.width = cw; cc.height = ch;
        var x = cc.getContext('2d');
        x.fillStyle = '#ffffff';
        x.strokeStyle = '#000000';
        x.lineWidth = 1.5;
        x.beginPath();
        x.moveTo(1, 1); x.lineTo(1, 21); x.lineTo(6, 16); x.lineTo(10, 25); x.lineTo(13, 24); x.lineTo(9, 15); x.lineTo(16, 15);
        x.closePath(); x.fill(); x.stroke();
        var data = x.getImageData(0, 0, cw, ch).data;
        this.renderer.updateCursor({ colors: new Uint8Array(data.buffer.slice(0)), width: cw, height: ch, hotx: 1, hoty: 1 });
        var m = this.desktop.monitor();
        this.renderer.updateCursorPosition({ x: Math.round(m.width / 2), y: Math.round(m.height / 2) });
    };

    // ---- Input: mouse moves the remote cursor and drags windows, keys go to the terminal ----

    P._pos = function (e) {
        var rect = this.canvas.getBoundingClientRect();
        return this.renderer.canvasToRemote(e.clientX - rect.left, e.clientY - rect.top);
    };

    P._inputAllowed = function () {
        return this._state === 'streaming' && this._active && !this._viewOnly;
    };

    P._bindInput = function () {
        if (this._bound) return;
        var self = this;
        var d = this.desktop;
        this._onMove = function (e) {
            if (!self._inputAllowed()) return;
            var p = self._pos(e);
            self.renderer.updateCursorPosition(p);
            if (d.drag) {
                var m = d.monitor();
                d.drag.win.x = Math.max(-d.drag.win.w + 80, Math.min(m.width - 80, p.x - d.drag.dx));
                d.drag.win.y = Math.max(0, Math.min(m.height - TASKBAR_H - TITLE_H, p.y - d.drag.dy));
            }
        };
        this._onDown = function (e) {
            if (!self._inputAllowed()) return;
            e.preventDefault();
            self.canvas.focus();
            if (e.button !== 0) return;
            var p = self._pos(e);
            if (d.overlay) {
                if (d.overlay === 'lock') d.note('Signed in again');
                d.overlay = null;
                return;
            }
            var m = d.monitor();
            if (p.y >= m.height - TASKBAR_H) {
                var hitTask = d.windows.find(function (w) { return w._task && p.x >= w._task.x && p.x <= w._task.x + w._task.w; });
                if (hitTask) {
                    d.raise(hitTask);
                    if (hitTask.monitor !== d.current) d.note(hitTask.title.split(' - ')[0] + ' is on Display ' + (hitTask.monitor + 1));
                }
                return;
            }
            var hit = d.hit(p.x, p.y);
            if (!hit) return;
            d.raise(hit.win);
            if (hit.title) d.drag = { win: hit.win, dx: p.x - hit.win.x, dy: p.y - hit.win.y };
        };
        this._onUp = function () { d.drag = null; };
        this._onKey = function (e) {
            if (!self._inputAllowed()) return;
            if (/^F\d+$/.test(e.key)) return; // F8 / F11 stay with the viewer
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            e.preventDefault();
            d.typeKey(e.key);
        };
        this.canvas.addEventListener('mousemove', this._onMove);
        this.canvas.addEventListener('mousedown', this._onDown);
        window.addEventListener('mouseup', this._onUp);
        this.canvas.addEventListener('keydown', this._onKey);
        this.canvas.addEventListener('contextmenu', this._onContext = function (e) { e.preventDefault(); });
        this._bound = true;
    };

    P._unbindInput = function () {
        if (!this._bound) return;
        this.canvas.removeEventListener('mousemove', this._onMove);
        this.canvas.removeEventListener('mousedown', this._onDown);
        window.removeEventListener('mouseup', this._onUp);
        this.canvas.removeEventListener('keydown', this._onKey);
        this.canvas.removeEventListener('contextmenu', this._onContext);
        this._bound = false;
    };

    // ---- The controls the viewer calls ----

    P.sendCtrlAltDel = function () { this.desktop.overlay = 'cad'; };
    P.sendLockScreen = function () { this.desktop.overlay = 'lock'; };
    P.sendRefreshScreen = function () { this.desktop.note('Screen refreshed'); };
    P.sendRestartRemoteDevice = function () {
        var self = this;
        this.desktop.note('Restarting...');
        this._after(1200, function () {
            self._disconnect('Remote: The device is restarting', { source: 'peer', peerReason: 'restart' });
        });
    };
    P.resetKeyboard = function () { this.desktop.note('Keyboard state reset'); };
    P.setKeyboardMode = function (mode) {
        if (mode !== this._keyboardMode) this.desktop.note('Keyboard mode: ' + mode);
        this._keyboardMode = mode;
    };
    P.sendClipboard = function (text) {
        this.desktop.note('Clipboard: ' + String(text).replace(/\s+/g, ' ').slice(0, 36));
    };
    P.sendText = function (text) {
        var self = this;
        var chars = Array.from(String(text));
        chars.forEach(function (ch, i) {
            self._after(30 * i, function () { self.desktop.typeKey(ch === '\n' ? 'Enter' : ch); });
        });
        return true;
    };
    P.sendChat = function (text) {
        var self = this;
        this.desktop.note('Message: ' + String(text).slice(0, 38));
        this._after(1400, function () {
            self._emit('chat', 'Seen on the device: "' + String(text).slice(0, 60) + '" (mock reply)');
        });
    };
    P.setBlockInput = function (on) { this.desktop.banners.block = on ? 'Input on the device is blocked' : null; };
    P.setPrivacyMode = function (on) { this.desktop.banners.privacy = on ? 'Privacy mode: the device\'s own screen is dark' : null; };
    P.setLockAfterSession = function (on) { this.desktop.note(on ? 'Will lock when the session ends' : 'Will not lock when the session ends'); };
    P.setDisableClipboard = function (on) { this.desktop.note(on ? 'Clipboard sharing off' : 'Clipboard sharing on'); };
    P.setShowRemoteCursor = function (on) { this.renderer.showCursor = !!on; };
    P.setViewOnly = function (on) {
        this._viewOnly = !!on;
        this.desktop.banners.view = on ? 'View only: your mouse and keyboard are not sent' : null;
        this._emit('view_only', this._viewOnly);
    };
    P.setQualityPreset = function (preset) { this._quality = QUALITY_SCALE[preset] ? preset : 'best'; this._emit('quality_changed', preset); };
    P.setImageQuality = function (q) { this.setQualityPreset(String(q).toLowerCase()); };
    P.setFpsMode = function (mode) { this._fpsMode = String(mode || 'adaptive'); };
    P.setCustomFps = function () { /* the frame rate follows the mode */ };
    P.setCodec = function (codec) { this._codec = codec === 'Auto' ? 'VP9' : codec; this._emit('codec_changed', this._codec); };
    P.setScaleMode = function (mode) { this.renderer.setScaleMode(mode); };
    P.setAudioMuted = function (muted) { this._muted = !!muted; };
    P.setVolume = function () {};
    P.setDisableAudio = function () {};
    P.setBackgroundFps = function (fps) { this._backgroundFps = Number(fps) || 1; };
    P.setSessionActive = function (active) { this._active = !!active; };
    P.syncCliprdrFiles = function () {};
    P.syncCliprdrPaths = function () {};
    P.isFileConnectionReady = function () { return true; };
    P.ensureFileConnection = async function () {};
    P.disconnectFileConnection = function () {};

    P.getMonitors = function () {
        var cur = this.desktop.current;
        return this.desktop.allMonitors().map(function (m, i) {
            return { idx: i, name: m.name, width: m.width, height: m.height, primary: !!m.primary, current: i === cur };
        });
    };
    P.getCurrentDisplay = function () { return this.desktop.current; };
    P.switchMonitor = function (idx) {
        this.desktop.current = Math.max(0, Math.min(this.desktop.allMonitors().length - 1, Number(idx) || 0));
        this.desktop.drag = null;
        this._emit('display_switched', this.desktop.current);
    };
    P.getVirtualDisplaySupport = function () {
        return { supported: true, impl: 'rustdesk_idd', rustdeskDisplays: this.desktop.virtual.map(function (v) { return v.vIndex; }) };
    };
    P.toggleVirtualDisplay = function (index, on) {
        var d = this.desktop;
        if (index === -1) d.virtual = [];
        else if (on && !d.virtual.some(function (v) { return v.vIndex === index; })) {
            d.virtual.push({ vIndex: index, name: 'Virtual display ' + index, width: 1600, height: 900, wall: ['#2a3a2a', '#182418'] });
        } else if (!on) d.virtual = d.virtual.filter(function (v) { return v.vIndex !== index; });
        if (d.current >= d.allMonitors().length) d.current = 0;
        this._emit('virtual_display_toggled', { index: index, on: !!on });
    };
    P.getWindowsSessions = function () {
        return { sessions: [{ sid: 1, name: 'Console (demo)' }, { sid: 2, name: 'Remote session 2 (alex)' }], currentSid: this._sid || 1 };
    };
    P.selectWindowsSession = function (sid) { this._sid = sid; this.desktop.note('Switched to session ' + sid); this._emit('windows_session_selected', sid); };

    P.getStats = function () {
        return {
            state: this._state,
            video: { codec: this._codec },
            audio: {},
            renderer: this.renderer.getStats(),
            connection: 'mock',
            diagnostics: {},
        };
    };

    window.MockRemoteSession = MockRemoteSession;
})();
