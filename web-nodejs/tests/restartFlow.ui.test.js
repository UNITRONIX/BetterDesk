'use strict';

const fs = require('fs');
const path = require('path');

describe('restart failure recovery UI contract', () => {
    test.each([
        ['settings.js', 'dismissFailedRestart'],
        ['restart-flow.js', 'dismissFailure'],
    ])(
        'allows a failed restart transaction to be dismissed in %s',
        (fileName, dismissFunction) => {
            const source = fs.readFileSync(
                path.join(__dirname, '../public/js', fileName),
                'utf8'
            );

            expect(source).toContain("phase: 'failed'");
            expect(source).toContain('/api/settings/restart/complete');
            expect(source).toContain(dismissFunction);
        }
    );
});

describe('restart completion contract', () => {
    const root = path.join(__dirname, '..');

    test('mounts the completion endpoint behind auth and server-config permission', () => {
        const routes = fs.readFileSync(
            path.join(root, 'routes/settings.routes.js'),
            'utf8'
        );
        const index = fs.readFileSync(
            path.join(root, 'routes/index.js'),
            'utf8'
        );

        expect(routes).toMatch(
            /router\.post\(['"]\/api\/settings\/restart\/complete['"],\s*requireAuth,\s*requirePermission\(['"]server\.config['"]\)/
        );
        expect(index).toContain("router.use('/', settingsRoutes);");
    });

    test('keeps the liveness route public and before restart mutations', () => {
        const routes = fs.readFileSync(
            path.join(root, 'routes/settings.routes.js'),
            'utf8'
        );
        const statusIndex = routes.indexOf("router.get('/api/settings/restart-status'");
        const pendingIndex = routes.indexOf("router.get('/api/settings/restart/pending'");

        expect(statusIndex).toBeGreaterThanOrEqual(0);
        expect(pendingIndex).toBeGreaterThan(statusIndex);
        expect(routes.slice(statusIndex, pendingIndex)).not.toMatch(/requireAuth/);
    });

    test.each(['settings.js', 'restart-flow.js'])(
        'makes the ready action resilient to a skewed or unavailable console in %s',
        (fileName) => {
            const source = fs.readFileSync(
                path.join(root, 'public/js', fileName),
                'utf8'
            );
            const readyStart = source.indexOf('function showRestartReady')
                >= 0 ? source.indexOf('function showRestartReady')
                : source.indexOf('function showReady');
            const readyEnd = source.indexOf('function showRestartFailure')
                >= 0 ? source.indexOf('function showRestartFailure')
                : source.indexOf('function showFailure');
            const readyBlock = source.slice(readyStart, readyEnd);

            expect(source).toContain('completeAndLogin');
            expect(source).toContain('/api/settings/restart/complete');
            expect(readyBlock).toContain('onClick');
            expect(readyBlock).not.toContain('disabled');
        }
    );

    test('does not submit completion repeatedly while redirecting to login', () => {
        const source = fs.readFileSync(
            path.join(root, 'public/js/restart-flow.js'),
            'utf8'
        );

        expect(source).toContain('completionInFlight');
        expect(source).toContain('AbortController');
        expect(source).toContain("window.location.href = '/login'");
    });
});
