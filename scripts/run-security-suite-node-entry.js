#!/usr/bin/env node
/**
 * Cross-platform entry for `npm run test:security:full` from web-nodejs/.
 * Spawns the PowerShell or bash runner at repo root.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const script = isWin
    ? path.join(root, 'scripts', 'run-security-suite.ps1')
    : path.join(root, 'scripts', 'run-security-suite.sh');

let result;
if (isWin) {
    result = spawnSync('pwsh', ['-NoProfile', '-File', script], { cwd: root, stdio: 'inherit' });
    if (result.error || result.status === null) {
        result = spawnSync('powershell', ['-NoProfile', '-File', script], {
            cwd: root,
            stdio: 'inherit',
        });
    }
} else {
    result = spawnSync('bash', [script], { cwd: root, stdio: 'inherit' });
}

if (result.error) {
    console.error(result.error);
    process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
