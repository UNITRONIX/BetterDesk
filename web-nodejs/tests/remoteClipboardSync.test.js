'use strict';

/**
 * The web viewer must not read the clipboard on its own unless reading is
 * already allowed: Firefox shows a "Paste" prompt for every read, which put a
 * prompt on every click into the remote screen.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'remote.js'), 'utf8');

function extract(name) {
    const start = source.indexOf(`async function ${name}(`);
    if (start < 0) throw new Error(`${name} not found in remote.js`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`${name} has no end`);
}

/** Runs syncLocalClipboardToRemote with a fake browser and returns how often the clipboard was read */
async function readsWith(permissionQuery) {
    let reads = 0;
    const sent = [];
    const sandbox = {
        navigator: {
            permissions: { query: permissionQuery },
            clipboard: { readText: async () => { reads++; return 'local text'; } },
        },
        getActiveSession: () => ({ state: 'streaming', client: { viewOnly: false, sendClipboard: (t) => sent.push(t) } }),
        result: null,
    };
    const hasGate = source.includes('async function clipboardReadGranted(');
    const code = [
        'let _lastSyncedClipboard = \'\';',
        'let _clipboardReadGranted = null;',
        hasGate ? extract('clipboardReadGranted') : '',
        extract('syncLocalClipboardToRemote'),
        'result = syncLocalClipboardToRemote();',
    ].join('\n');
    vm.runInNewContext(code, sandbox);
    await sandbox.result;
    return { reads, sent };
}

describe('web viewer clipboard sync', () => {
    it('does not read the clipboard when the permission query throws (Firefox)', async () => {
        const { reads } = await readsWith(() => Promise.reject(new TypeError('not a valid PermissionName')));
        expect(reads).toBe(0);
    });

    it('does not read the clipboard while the browser would still ask', async () => {
        const { reads } = await readsWith(() => Promise.resolve({ state: 'prompt' }));
        expect(reads).toBe(0);
    });

    it('sends the local clipboard once reading is allowed', async () => {
        const { reads, sent } = await readsWith(() => Promise.resolve({ state: 'granted' }));
        expect(reads).toBe(1);
        expect(sent).toEqual(['local text']);
    });
});
