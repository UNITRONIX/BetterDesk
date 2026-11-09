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
            path.join(__dirname, '../../web-ui/static/rdclient/touch.js'),
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
            path.join(__dirname, '../../web-ui/static/rdclient/renderer.js'),
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
