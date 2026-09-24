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
