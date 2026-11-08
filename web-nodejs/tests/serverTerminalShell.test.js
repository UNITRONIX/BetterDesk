/**
 * Server terminal shell choice: the login shell first, then the fallbacks in
 * order, and only shells that exist. The Docker image is Alpine, which has no
 * bash, so starting /bin/bash there fails.
 */
const { resolveLoginShell } = require('../services/serverTerminalProxy');

const only = (...present) => ({ isExecutable: (file) => present.includes(file) });

const describePosix = process.platform === 'win32' ? describe.skip : describe;

describePosix('server terminal shell', () => {
    test('falls back to /bin/sh when no bash, zsh or ash exists', () => {
        expect(resolveLoginShell(undefined, only('/bin/sh'))).toBe('/bin/sh');
        expect(resolveLoginShell('/bin/bash', only('/bin/sh'))).toBe('/bin/sh');
    });

    test('prefers ash over sh on busybox images', () => {
        expect(resolveLoginShell(undefined, only('/bin/ash', '/bin/sh'))).toBe('/bin/ash');
    });

    test('uses the login shell when it exists', () => {
        expect(resolveLoginShell('/usr/bin/zsh', only('/usr/bin/zsh', '/bin/bash', '/bin/sh'))).toBe('/usr/bin/zsh');
        expect(resolveLoginShell('/bin/sh', only('/bin/bash', '/bin/sh'))).toBe('/bin/sh');
    });

    test('tries the fallbacks in order', () => {
        expect(resolveLoginShell(undefined, only('/usr/bin/bash', '/bin/zsh', '/bin/sh'))).toBe('/usr/bin/bash');
        expect(resolveLoginShell(undefined, only('/bin/bash', '/bin/sh'))).toBe('/bin/bash');
    });

    test('ignores login shells that are not known shells', () => {
        expect(resolveLoginShell('/usr/bin/python3', only('/usr/bin/python3', '/bin/sh'))).toBe('/bin/sh');
        expect(resolveLoginShell('/opt/../bin/bash', only('/opt/../bin/bash', '/bin/sh'))).toBe('/bin/sh');
    });

    test('checks the real file system by default', () => {
        const shell = resolveLoginShell('/nonexistent/bash');
        expect(shell).not.toBe('/nonexistent/bash');
        expect(require('fs').existsSync(shell)).toBe(true);
    });
});
