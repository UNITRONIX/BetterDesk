'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('mobile i18n keys', () => {
    const langDir = path.join(__dirname, '../lang');
    const locales = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

    const requiredMobileNav = ['label', 'home', 'devices', 'remote', 'chat', 'more'];
    const requiredRemote = [
        'input_mode_touch',
        'input_mode_touchpad',
        'show_keyboard',
        'special_keys',
        'phone_unsupported_title',
        'phone_unsupported_body',
        'phone_unsupported_back_devices'
    ];

    for (const file of locales) {
        it(`${file} has mobile_nav and remote mobile keys`, () => {
            const data = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
            assert.ok(data.mobile_nav, `${file} missing mobile_nav`);
            for (const key of requiredMobileNav) {
                assert.ok(data.mobile_nav[key], `${file} mobile_nav.${key}`);
            }
            assert.ok(data.remote, `${file} missing remote`);
            for (const key of requiredRemote) {
                assert.ok(data.remote[key], `${file} remote.${key}`);
            }
        });
    }
});

function loadDeviceCapabilities(opts) {
    opts = opts || {};
    const width = opts.width !== undefined ? opts.width : 400;
    const window = {
        innerWidth: width,
        innerHeight: opts.height || 800,
        navigator: { maxTouchPoints: opts.touch ? 5 : 0 },
        matchMedia: opts.matchMedia || (() => ({ matches: false, media: 'not all', addEventListener: () => {} })),
        visualViewport: opts.visualViewport || null,
        addEventListener: () => {},
        dispatchEvent: () => true
    };
    const sandbox = {
        window,
        document: {
            readyState: 'complete',
            body: { classList: { toggle: () => {}, contains: () => false } },
            documentElement: { clientWidth: width },
            addEventListener: () => {}
        },
        DeviceCapabilities: null
    };
    sandbox.global = window;
    const code = fs.readFileSync(path.join(__dirname, '../public/js/device-capabilities.js'), 'utf8');
    vm.runInNewContext(code, sandbox);
    return sandbox.window.DeviceCapabilities;
}

describe('DeviceCapabilities', () => {
    it('exposes breakpoint constants and helpers', () => {
        const DC = loadDeviceCapabilities({ width: 400, touch: true });
        assert.strictEqual(DC.BP_PHONE, 767);
        assert.strictEqual(DC.isPhone(), true);
        assert.strictEqual(DC.isTablet(), false);
    });

    it('isPhone() is false when width is 0 (pre-layout / WebView)', () => {
        const DC = loadDeviceCapabilities({ width: 0 });
        assert.strictEqual(DC.isPhone(), false);
    });

    it('isPhone() is false on desktop with fine pointer and hover', () => {
        const DC = loadDeviceCapabilities({
            width: 1920,
            matchMedia: (q) => ({
                matches: q === '(hover: hover) and (pointer: fine)',
                media: q,
                addEventListener: () => {}
            })
        });
        assert.strictEqual(DC.isPhone(), false);
    });

    it('isPhone() is true on small touch viewport without hover', () => {
        const DC = loadDeviceCapabilities({ width: 400, touch: true });
        assert.strictEqual(DC.isPhone(), true);
    });

    it('isPhone() is false on tablet width', () => {
        const DC = loadDeviceCapabilities({ width: 900, touch: true });
        assert.strictEqual(DC.isPhone(), false);
        assert.strictEqual(DC.isTablet(), true);
    });

    it('getWidth uses visualViewport when innerWidth is 0', () => {
        const DC = loadDeviceCapabilities({
            width: 0,
            visualViewport: { width: 820, height: 600, addEventListener: () => {} }
        });
        assert.strictEqual(DC.isPhone(), false);
        assert.strictEqual(DC.isTablet(), true);
    });
});

describe('Devices row drag input detection', () => {
    const code = fs.readFileSync(path.join(__dirname, '../public/js/devices.js'), 'utf8');
    const detection = code.slice(
        code.indexOf('    function shouldDisableRowDrag()'),
        code.indexOf('    /** Floating hscroll')
    );

    it.each([
        ['touchscreen laptop with mouse', true, true, false, false, false],
        ['touchscreen laptop with narrow window', true, true, false, true, false],
        ['desktop with mouse', false, true, false, false, false],
        ['touch-only phone', true, false, true, true, true],
        ['touch-only tablet in desktop mode', true, false, true, false, true],
        ['coarse pointer without capability helper', null, false, true, false, true],
        ['desktop without media query support', false, null, false, false, false],
    ])('%s', (_name, touch, fine, coarse, mobile, disabled) => {
        const sandbox = {
            window: {
                DeviceCapabilities: touch === null ? undefined : { isTouch: () => touch },
                matchMedia: fine === null ? undefined : query => ({
                    matches: query === '(hover: hover) and (pointer: fine)' ? fine : coarse
                })
            },
            document: { body: { classList: { contains: () => mobile } } }
        };
        vm.runInNewContext(detection, sandbox);
        expect(sandbox.shouldDisableRowDrag()).toBe(disabled);
        expect(sandbox.preferSingleTapDetail()).toBe(disabled);
    });
});

describe('RDTouch tablet input', () => {
    function loadTouch() {
        const sandbox = {
            console,
            performance: { now: () => 100 },
            setTimeout,
            clearTimeout,
            RDInput: {
                MOUSE_TYPE_DOWN: 1,
                MOUSE_TYPE_UP: 2,
                MOUSE_TYPE_WHEEL: 3,
                MOUSE_BUTTON_LEFT: 1,
                MOUSE_BUTTON_RIGHT: 2,
                MOUSE_BUTTON_MIDDLE: 4,
            },
        };
        const code = fs.readFileSync(
            path.join(__dirname, '../public/js/rdclient/touch.js'),
            'utf8'
        );
        vm.runInNewContext(code + '\nthis.RDTouch = RDTouch;', sandbox);
        return sandbox.RDTouch;
    }

    function makeTouchHarness() {
        const listeners = {};
        const canvas = {
            style: {},
            addEventListener(type, handler) { listeners[type] = handler; },
            removeEventListener() {},
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
        };
        const renderer = {
            remoteWidth: 1920,
            remoteHeight: 1080,
            canvasToRemote: (x, y) => ({ x, y }),
        };
        const sent = [];
        const Touch = loadTouch();
        const touch = new Touch(canvas, renderer, (message) => sent.push(message));
        touch.start();
        return { touch, listeners, sent };
    }

    function eventFor(touchPoint, touches) {
        return {
            touches: touches || [touchPoint],
            changedTouches: [touchPoint],
            preventDefault() {},
        };
    }

    it('maps a single direct touch into a left click', () => {
        const { listeners, sent } = makeTouchHarness();
        const point = { identifier: 1, clientX: 100, clientY: 120 };

        listeners.touchstart(eventFor(point));
        listeners.touchend(eventFor(point, []));

        expect(sent.map((message) => message.mouseEvent.mask)).toEqual([9, 10]);
    });

    it('does not click after a touchpad drag', () => {
        const { touch, listeners, sent } = makeTouchHarness();
        touch.setMode('touchpad');
        const start = { identifier: 1, clientX: 100, clientY: 120 };
        const moved = { identifier: 1, clientX: 140, clientY: 120 };

        listeners.touchstart(eventFor(start));
        listeners.touchmove(eventFor(moved));
        listeners.touchend(eventFor(moved, []));

        expect(sent.some((message) => message.mouseEvent.mask === 9)).toBe(false);
        expect(sent.some((message) => message.mouseEvent.mask === 10)).toBe(false);
    });
});

describe('RDRenderer mobile resize', () => {
    function loadRenderer() {
        const sandbox = {
            console,
            window: null,
            devicePixelRatio: 2,
            document: {
                createElement: () => ({
                    getContext: () => ({})
                })
            }
        };
        sandbox.window = sandbox;
        const code = fs.readFileSync(
            path.join(__dirname, '../public/js/rdclient/renderer.js'),
            'utf8'
        );
        vm.runInNewContext(code, sandbox);
        return sandbox.RDRenderer;
    }

    function makeCanvas() {
        let width = 800;
        let height = 400;
        let assignments = 0;
        let rect = { width: 400, height: 200 };
        const canvas = {
            style: { width: '400px', height: '200px' },
            parentElement: {
                getBoundingClientRect: () => rect
            },
            getContext: () => ({
                fillRect() {},
                drawImage() {}
            })
        };
        Object.defineProperties(canvas, {
            width: {
                get: () => width,
                set: (value) => { width = value; assignments++; }
            },
            height: {
                get: () => height,
                set: (value) => { height = value; assignments++; }
            }
        });
        return {
            canvas,
            setRect: (next) => { rect = next; },
            getAssignments: () => assignments
        };
    }

    it('does not clear the canvas when visual viewport size is unchanged', () => {
        const Renderer = loadRenderer();
        const harness = makeCanvas();
        const renderer = new Renderer(harness.canvas);
        let refreshes = 0;
        renderer.onResizeRefresh = () => { refreshes++; };

        renderer.resize();
        expect(harness.getAssignments()).toBe(0);
        expect(refreshes).toBe(0);

        harness.setRect({ width: 420, height: 200 });
        renderer.resize();
        expect(harness.getAssignments()).toBe(2);
        expect(refreshes).toBe(1);
    });
});

describe('RDRenderer mosaic compositing', () => {
    function makeMosaicRenderer() {
        let fills = 0;
        let draws = 0;
        const ctx = {
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 0,
            fillRect() { fills++; },
            strokeRect() {},
            drawImage() { draws++; }
        };
        const sandbox = {
            console,
            window: { devicePixelRatio: 1 },
            devicePixelRatio: 1,
            requestAnimationFrame: () => 1,
            cancelAnimationFrame: () => {},
            performance: { now: () => 0 },
            document: {
                createElement: () => {
                    const canvas = { width: 0, height: 0 };
                    canvas.getContext = () => ({
                        drawImage() {}
                    });
                    return canvas;
                }
            }
        };
        sandbox.window = sandbox;
        const code = fs.readFileSync(
            path.join(__dirname, '../public/js/rdclient/renderer.js'),
            'utf8'
        );
        vm.runInNewContext(code, sandbox);
        const canvas = {
            width: 400,
            height: 200,
            style: {},
            parentElement: null,
            getContext: () => ctx
        };
        const renderer = new sandbox.RDRenderer(canvas);
        renderer.setRemoteSize(1920, 1080);
        return {
            renderer,
            getFills: () => fills,
            getDraws: () => draws
        };
    }

    const layout = [
        { idx: 0, x: 0, y: 0, width: 1920, height: 1080, deskX: 0, deskY: 0 },
        { idx: 2, x: 1920, y: 0, width: 1920, height: 1080, deskX: 3840, deskY: 0 }
    ];

    it('maps canvas points to absolute desktop coordinates', () => {
        const { renderer } = makeMosaicRenderer();
        renderer.setMosaicMode(true, layout);
        renderer._updateTransform();

        // Middle of the second tile (compacted at x=1920, physical x=3840).
        const rect = { scale: renderer.transform.scale, ox: renderer.transform.offsetX };
        const canvasX = (rect.ox + (1920 + 100) * rect.scale);
        const canvasY = (renderer.transform.offsetY + 100 * rect.scale);
        const pos = renderer._canvasToRemoteMosaic(canvasX, canvasY);

        expect(pos).not.toBeNull();
        expect(pos.displayIdx).toBe(2);
        expect(pos.x).toBe(3940);
        expect(pos.y).toBe(100);
    });

    it('does not clear or repaint the composite without new frames', () => {
        const { renderer, getFills, getDraws } = makeMosaicRenderer();
        renderer.setMosaicMode(true, layout);
        renderer._mosaicNeedsClear = false;
        renderer._mosaicDirty = false;

        renderer._renderTick();

        expect(getFills()).toBe(0);
        expect(getDraws()).toBe(0);
    });

    it('keeps the last tile picture and clears only once', () => {
        const { renderer, getFills, getDraws } = makeMosaicRenderer();
        renderer.setMosaicMode(true, layout);

        const frame = { displayWidth: 1920, displayHeight: 1080, close: () => {} };
        renderer.pushMosaicFrame(0, frame);
        renderer._renderMosaic();
        const fillsAfterFirst = getFills();
        const drawsAfterFirst = getDraws();
        expect(drawsAfterFirst).toBeGreaterThan(0);

        // A monitor that stops sending frames keeps its last picture.
        renderer._mosaicDirty = true;
        renderer._renderMosaic();
        expect(getFills()).toBe(fillsAfterFirst);
        expect(getDraws()).toBe(drawsAfterFirst * 2);
    });

    it('closes video frames it copies into tile buffers', () => {
        const { renderer } = makeMosaicRenderer();
        renderer.setMosaicMode(true, layout);
        const close = jest.fn();
        renderer.pushMosaicFrame(0, {
            displayWidth: 1920,
            displayHeight: 1080,
            close
        });
        expect(close).toHaveBeenCalled();
    });
});
