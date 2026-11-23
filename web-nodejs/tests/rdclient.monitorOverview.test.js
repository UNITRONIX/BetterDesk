'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadClientSandbox() {
    const filename = path.join(__dirname, '..', 'public/js/rdclient/client.js');
    const sandbox = {
        console,
        window: {},
        globalThis: {},
        RDVideo: {
            isSupported: () => true,
        },
        RDDisplayDecoderPool: function RDDisplayDecoderPool() {
            this.close = jest.fn();
            this.setBackgroundMode = jest.fn();
            this.decode = jest.fn();
        },
        RDConnection: function () {},
        RDProtocol: function () {},
        RDCrypto: function () {},
        RDAudio: function () {},
        RDRenderer: function () {
            this.setScaleMode = jest.fn();
            this.setFocusDisplay = jest.fn();
            this.setMosaicMode = jest.fn();
            this.pushFrame = jest.fn();
            this.pushMosaicFrame = jest.fn();
        },
        RDInput: function () {},
        RDFileTransfer: function () {},
        RDClipboard: {},
        RDCliprdr: { isSupported: () => false },
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox.window;
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
    return sandbox;
}

function makeClient(sandbox) {
    const RDClient = sandbox.RDClient;
    const client = Object.create(RDClient.prototype);
    client._state = 'streaming';
    client._overviewMode = false;
    client._allMonitorsView = false;
    client._combinedIndices = null;
    client._currentDisplay = 0;
    client._peerInfo = {
        displays: [
            { x: 0, y: 0, width: 1920, height: 1080, name: 'A' },
            { x: 1920, y: 0, width: 2560, height: 1080, name: 'B' },
        ],
        currentDisplay: 0,
    };
    client._listeners = {};
    client._thumbnailCanvases = new Map();
    client._displayDecoderPool = new sandbox.RDDisplayDecoderPool();
    client.video = { fallbackMode: false, _needKeyframe: false, initialized: true };
    client.renderer = {
        setFocusDisplay: jest.fn(),
        setMosaicMode: jest.fn(),
        pushFrame: jest.fn(),
        pushMosaicFrame: jest.fn(),
    };
    client.proto = {
        buildMisc: (field, value) => ({ misc: { [field]: value } }),
        detectVideoCodec: () => 'h264',
        getEncodedFrames: (vf) => vf._frames || [{ data: new Uint8Array([1]), key: true }],
    };
    client._sent = [];
    client._sendPeerMessage = (msg) => client._sent.push(msg);
    client._emit = jest.fn();
    client.canUseMonitorOverview = RDClient.prototype.canUseMonitorOverview;
    client.getMonitors = RDClient.prototype.getMonitors;
    client.getCurrentDisplay = RDClient.prototype.getCurrentDisplay;
    client.isOverviewMode = RDClient.prototype.isOverviewMode;
    client.isAllMonitorsView = RDClient.prototype.isAllMonitorsView;
    client.isCombinedView = RDClient.prototype.isCombinedView;
    client.getCombinedDisplays = RDClient.prototype.getCombinedDisplays;
    client._allDisplayIndices = RDClient.prototype._allDisplayIndices;
    client._isMosaicActive = RDClient.prototype._isMosaicActive;
    client._mosaicIncludes = RDClient.prototype._mosaicIncludes;
    client._needsMultiCapture = RDClient.prototype._needsMultiCapture;
    client._activeCaptureIndices = RDClient.prototype._activeCaptureIndices;
    client._sendCaptureDisplays = RDClient.prototype._sendCaptureDisplays;
    client._refreshDisplayVideo = RDClient.prototype._refreshDisplayVideo;
    client._syncMosaicLayout = RDClient.prototype._syncMosaicLayout;
    client.setOverviewMode = RDClient.prototype.setOverviewMode;
    client.setAllMonitorsView = RDClient.prototype.setAllMonitorsView;
    client.setCombinedDisplays = RDClient.prototype.setCombinedDisplays;
    client.clearCombinedDisplays = RDClient.prototype.clearCombinedDisplays;
    client.focusDisplay = RDClient.prototype.focusDisplay;
    client.setInputDisplay = RDClient.prototype.setInputDisplay;
    client.switchMonitor = RDClient.prototype.switchMonitor;
    client.sendRefreshScreen = RDClient.prototype.sendRefreshScreen;
    client.clearThumbnailCanvases = RDClient.prototype.clearThumbnailCanvases;
    client.setThumbnailCanvas = RDClient.prototype.setThumbnailCanvas;
    return client;
}

describe('RDClient monitor overview', () => {
    test('setOverviewMode requests CaptureDisplays for every monitor', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);

        expect(client.setOverviewMode(true)).toBe(true);
        expect(client.isOverviewMode()).toBe(true);

        const capture = client._sent.find((m) => m.misc && m.misc.captureDisplays);
        expect(capture.misc.captureDisplays.set).toEqual([0, 1]);
        expect(client._emit).toHaveBeenCalledWith('overview_changed', true, false);
    });

    test('focusDisplay keeps multi-capture while overview is on', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setOverviewMode(true);
        client._sent = [];

        client.focusDisplay(1);

        expect(client.getCurrentDisplay()).toBe(1);
        const capture = client._sent.find((m) => m.misc && m.misc.captureDisplays);
        expect(capture.misc.captureDisplays.set).toEqual([0, 1]);
        const switchMsg = client._sent.find((m) => m.misc && m.misc.switchDisplay);
        expect(switchMsg.misc.switchDisplay.display).toBe(1);
        expect(client._emit).toHaveBeenCalledWith('display_switched', 1);
    });

    test('switchMonitor narrows capture when overview is off', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client._sent = [];

        client.switchMonitor(1);

        const capture = client._sent.find((m) => m.misc && m.misc.captureDisplays);
        expect(capture.misc.captureDisplays.set).toEqual([1]);
    });

    test('setAllMonitorsView enables mosaic layout and overview capture', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);

        expect(client.setAllMonitorsView(true)).toBe(true);
        expect(client.isAllMonitorsView()).toBe(true);
        expect(client._isMosaicActive()).toBe(true);
        expect(client.renderer.setMosaicMode).toHaveBeenCalledWith(
            true,
            expect.arrayContaining([
                expect.objectContaining({ idx: 0, width: 1920, height: 1080 }),
                expect.objectContaining({ idx: 1, width: 2560, height: 1080 }),
            ])
        );
    });

    test('closing overview restores single-display capture', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setOverviewMode(true);
        client.focusDisplay(1);
        client._sent = [];

        client.setOverviewMode(false);

        expect(client.isOverviewMode()).toBe(false);
        expect(client.isAllMonitorsView()).toBe(false);
        const capture = client._sent.find((m) => m.misc && m.misc.captureDisplays);
        expect(capture.misc.captureDisplays.set).toEqual([1]);
        expect(client._displayDecoderPool.close).toHaveBeenCalled();
    });

    test('setCombinedDisplays stitches selected monitors by peer layout', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client._sent = [];

        expect(client.setCombinedDisplays([1, 0])).toBe(true);
        expect(client.isCombinedView()).toBe(true);
        expect(client.getCombinedDisplays()).toEqual([1, 0]);
        expect(client.renderer.setMosaicMode).toHaveBeenCalledWith(
            true,
            expect.arrayContaining([
                expect.objectContaining({ idx: 0, x: 0, width: 1920 }),
                expect.objectContaining({ idx: 1, x: 1920, width: 2560 }),
            ])
        );
        const capture = client._sent.find((m) => m.misc && m.misc.captureDisplays);
        expect(capture.misc.captureDisplays.set).toEqual([1, 0]);
    });

    test('clearCombinedDisplays leaves single-display capture', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setCombinedDisplays([0, 1]);
        client._sent = [];
        client.clearCombinedDisplays();
        expect(client.isCombinedView()).toBe(false);
        const capture = client._sent.find((m) => m.misc && m.misc.captureDisplays);
        expect(capture.misc.captureDisplays.set).toEqual([0]);
    });

    test('setInputDisplay keeps combined mosaic capture set', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setCombinedDisplays([0, 1]);
        client._sent = [];

        client.setInputDisplay(1);

        expect(client.isCombinedView()).toBe(true);
        expect(client.getCurrentDisplay()).toBe(1);
        expect(client.renderer.setFocusDisplay).toHaveBeenCalledWith(1);
        const switchMsg = client._sent.find((m) => m.misc && m.misc.switchDisplay);
        expect(switchMsg.misc.switchDisplay.display).toBe(1);
        expect(client._sent.find((m) => m.misc && m.misc.captureDisplays)).toBeUndefined();
        expect(client.renderer.setMosaicMode).not.toHaveBeenCalledWith(false, expect.anything());
    });

    test('setInputDisplay can skip peer switchDisplay on hover', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setCombinedDisplays([0, 1]);
        client._sent = [];

        client.setInputDisplay(1, { peerSwitch: false });

        expect(client.getCurrentDisplay()).toBe(1);
        expect(client.renderer.setFocusDisplay).toHaveBeenCalledWith(1);
        expect(client._sent.find((m) => m.misc && m.misc.switchDisplay)).toBeUndefined();
        expect(client.isCombinedView()).toBe(true);
    });

    test('getMonitors exposes aspect geometry for thumbnails', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        const monitors = client.getMonitors();
        expect(monitors).toHaveLength(2);
        expect(monitors[0]).toMatchObject({ idx: 0, width: 1920, height: 1080, x: 0, y: 0, primary: true });
        expect(monitors[1]).toMatchObject({ idx: 1, width: 2560, height: 1080, x: 1920, y: 0 });
    });

    test('overview unavailable without WebCodecs', () => {
        const sandbox = loadClientSandbox();
        sandbox.RDVideo.isSupported = () => false;
        const client = makeClient(sandbox);
        client.video.fallbackMode = true;

        expect(client.setOverviewMode(true)).toBe(false);
        expect(client._emit).toHaveBeenCalledWith('overview_unavailable', 'webcodecs');
        expect(client.isOverviewMode()).toBe(false);
    });
});

describe('RDClient compact mosaic layout', () => {
    function compactLayout(monitors) {
        const sandbox = loadClientSandbox();
        return sandbox.RDClient.buildCompactMosaicLayout(monitors);
    }

    test('closes the gap between non-adjacent monitors', () => {
        const layout = compactLayout([
            { idx: 0, x: 0, y: 0, width: 1920, height: 1080 },
            { idx: 2, x: 3840, y: 0, width: 1920, height: 1080 },
        ]);

        expect(layout).toHaveLength(2);
        expect(layout[0]).toMatchObject({ idx: 0, x: 0, y: 0, deskX: 0, deskY: 0 });
        expect(layout[1]).toMatchObject({ idx: 2, x: 1920, y: 0, deskX: 3840, deskY: 0 });
    });

    test('keeps stacked rows in order and packs them vertically', () => {
        const layout = compactLayout([
            { idx: 1, x: 0, y: 1080, width: 2560, height: 1440 },
            { idx: 0, x: 0, y: 0, width: 1920, height: 1080 },
            { idx: 2, x: 1920, y: 0, width: 1920, height: 1080 },
            { idx: 3, x: 2560, y: 1080, width: 1920, height: 1080 },
        ]);

        const byIdx = new Map(layout.map((d) => [d.idx, d]));
        expect(byIdx.get(0)).toMatchObject({ x: 0, y: 0 });
        expect(byIdx.get(2)).toMatchObject({ x: 1920, y: 0 });
        expect(byIdx.get(1)).toMatchObject({ x: 0, y: 1080 });
        expect(byIdx.get(3)).toMatchObject({ x: 2560, y: 1080 });
    });

    test('setCombinedDisplays hands the compact layout to the renderer', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client._peerInfo.displays = [
            { x: 0, y: 0, width: 1920, height: 1080, name: 'A' },
            { x: 1920, y: 0, width: 1920, height: 1080, name: 'B' },
            { x: 3840, y: 0, width: 1920, height: 1080, name: 'C' },
        ];
        client._sent = [];

        expect(client.setCombinedDisplays([0, 2])).toBe(true);

        const layout = client.renderer.setMosaicMode.mock.calls.at(-1)[1];
        expect(layout).toEqual([
            expect.objectContaining({ idx: 0, x: 0, deskX: 0 }),
            expect.objectContaining({ idx: 2, x: 1920, deskX: 3840 }),
        ]);
    });

    test('mosaic entry never sends a global refreshVideo', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client._sent = [];

        client.setCombinedDisplays([0, 1]);
        client.setAllMonitorsView(true);
        client._refreshDisplayVideo(0);

        const globals = client._sent.filter((m) => m.misc && m.misc.refreshVideo);
        expect(globals).toHaveLength(0);
        expect(client._sent.some((m) => m.misc
            && m.misc.refreshVideoDisplay !== undefined)).toBe(true);
    });

    test('single-display refresh keeps the legacy global request', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client._sent = [];

        client.switchMonitor(1);

        expect(client._sent.some((m) => m.misc && m.misc.refreshVideo)).toBe(true);
    });

    test('focused monitor also decodes through the per-display pool', async () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setCombinedDisplays([0, 1]);
        client.video.init = jest.fn();
        client.video.decode = jest.fn();
        client._displayDecoderPool.decode = jest.fn();

        const frames = [{ data: new Uint8Array([1]), key: true }];
        await client._handleVideoFrame({
            display: 0,
            h264s: { frames: frames.map(() => ({ data: new Uint8Array([1]), key: true })) },
        }).catch(() => {});

        expect(client._displayDecoderPool.decode).toHaveBeenCalled();
        expect(client.video.init).not.toHaveBeenCalled();
    });

    test('mosaic switchDisplay is throttled to one per burst', () => {
        const sandbox = loadClientSandbox();
        const client = makeClient(sandbox);
        client.setCombinedDisplays([0, 1]);
        client._sent = [];

        // Pointer moving/clicking between tiles must not re-subscribe the
        // capture service several times inside one gesture.
        client.setInputDisplay(1);
        client.setInputDisplay(0);
        client.setInputDisplay(1);
        client.setInputDisplay(1);

        const switches = client._sent.filter((m) => m.misc && m.misc.switchDisplay);
        expect(switches.map((m) => m.misc.switchDisplay.display)).toEqual([1]);
    });
});

describe('RDDisplayDecoderPool', () => {
    test('exports pool class alongside RDVideo', () => {
        const filename = path.join(__dirname, '..', 'public/js/rdclient/video.js');
        const sandbox = {
            console,
            window: {},
            performance: { now: () => Date.now() },
            requestAnimationFrame: () => 1,
            cancelAnimationFrame: () => {},
            document: {
                createElement: () => ({
                    style: {},
                    play: async () => {},
                    pause: () => {},
                    remove: () => {},
                    parentNode: null,
                }),
                body: { appendChild: () => {} },
            },
        };
        sandbox.window = sandbox;
        vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
        expect(typeof sandbox.RDVideo).toBe('function');
        expect(typeof sandbox.RDDisplayDecoderPool).toBe('function');

        const pool = new sandbox.RDDisplayDecoderPool();
        const slotA = pool._ensureSlot(0);
        const slotB = pool._ensureSlot(1);
        expect(slotA).not.toBe(slotB);
        expect(pool._slots.size).toBe(2);
        pool.close();
        expect(pool._slots.size).toBe(0);
    });
});
