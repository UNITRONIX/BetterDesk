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
    client._allDisplayIndices = RDClient.prototype._allDisplayIndices;
    client._sendCaptureDisplays = RDClient.prototype._sendCaptureDisplays;
    client._refreshDisplayVideo = RDClient.prototype._refreshDisplayVideo;
    client._syncMosaicLayout = RDClient.prototype._syncMosaicLayout;
    client.setOverviewMode = RDClient.prototype.setOverviewMode;
    client.setAllMonitorsView = RDClient.prototype.setAllMonitorsView;
    client.focusDisplay = RDClient.prototype.focusDisplay;
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
        expect(client.isOverviewMode()).toBe(true);
        expect(client.isAllMonitorsView()).toBe(true);
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
