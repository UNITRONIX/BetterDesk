'use strict';

/**
 * Regression contract for issue #514 ("Web Remote does nothing").
 *
 * Three independent defects made the button look dead:
 *   1. window.open() ran inside a 300 ms timer, outside the user gesture, so
 *      Chrome blocked it silently;
 *   2. the window was pointed at '/remote/' (the device picker), which never
 *      loads remote.js and therefore never consumed the queued session;
 *   3. an empty password + Connect returned without any feedback.
 *
 * These are source-level contracts: the code is browser-only, so the cheapest
 * reliable guard is to assert the shape that makes each defect impossible.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

/** Drop comments so documentation prose cannot satisfy or break a contract. */
function code(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('Web Remote viewer flow (#514)', () => {
    const devicesJs = read('public', 'js', 'devices.js');
    const dashboardJs = read('public', 'js', 'remote-dashboard.js');
    const remoteJs = read('public', 'js', 'remote.js');
    const devicesCode = code(devicesJs);
    const dashboardCode = code(dashboardJs);
    const remoteCode = code(remoteJs);

    it('never opens the picker as the viewer window', () => {
        // The anti-pattern from #514 was window.open('/remote/', 'betterdesk-rdviewer')
        // - the device picker reused as if it were the session viewer. The
        // mesh-files action legitimately opens /remote/<id>?panel=files, so
        // match the picker form specifically.
        for (const [name, source] of Object.entries({ devicesJs: devicesCode, dashboardJs: dashboardCode })) {
            assert.ok(
                !/window\.open\(\s*['"]\/remote\/['"]\s*,/.test(source),
                `${name} still opens the '/remote/' picker as a viewer window`
            );
        }
    });

    it('navigates to the device viewer URL instead of the picker', () => {
        assert.ok(
            /viewerUrl\s*=\s*'\/remote\/'\s*\+\s*encodeURIComponent/.test(devicesCode),
            'devices.js does not build the device viewer URL'
        );
        assert.ok(
            /viewerUrl\s*=\s*'\/remote\/'\s*\+\s*encodeURIComponent/.test(dashboardCode),
            'remote-dashboard.js does not build the device viewer URL'
        );
    });

    it('opens the window synchronously before any BroadcastChannel ping', () => {
        for (const [name, source] of Object.entries({ devicesJs: devicesCode, dashboardJs: dashboardCode })) {
            const openIndex = source.indexOf('betterdesk-rdviewer');
            const pingIndex = source.indexOf("{ type: 'ping' }");
            assert.ok(openIndex > -1 && pingIndex > -1, `${name} missing viewer open or ping`);
            assert.ok(
                openIndex < pingIndex,
                `${name} pings before opening a window, so the popup is blocked`
            );
        }
    });

    it('requests an explicit popup size so the small-screen gate is not tripped', () => {
        assert.match(devicesCode, /width=1600,height=950/);
        assert.match(dashboardCode, /width=1600,height=950/);
    });

    it('only navigates the timeout branch, never opens a second popup', () => {
        const timeoutBlock = devicesCode.slice(devicesCode.indexOf('}, 300);') - 600);
        assert.match(timeoutBlock, /viewerWindow\.location\.href = viewerUrl/);
        assert.ok(
            devicesCode.indexOf('window.open(viewerUrl, REMOTE_VIEWER_WINDOW') >
                devicesCode.indexOf('}, 300);') - 200,
            'timeout branch should navigate, not open a new window'
        );
    });

    it('shows a hint instead of returning silently on an empty password', () => {
        assert.ok(
            !/if \(!pw\) \{ session\.passwordInput\.focus\(\); return; \}/.test(remoteCode),
            'empty password still returns silently'
        );
        assert.match(remoteCode, /remote\.password_empty_hint/);
        assert.match(remoteCode, /session\.loginError\.style\.display = 'block'/);
    });

    it('clears the empty-password hint when the operator types', () => {
        assert.match(
            remoteCode,
            /session\.passwordInput\?\.addEventListener\('input',[\s\S]{0,160}session\.loginError\.style\.display = 'none'/
        );
    });
});
