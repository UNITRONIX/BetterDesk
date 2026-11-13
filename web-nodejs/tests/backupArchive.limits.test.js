'use strict';

/**
 * Archive extraction limits (audit M4, 2026-11-13).
 *
 * `extractTarGz` used to call `zlib.gunzipSync` with no cap. The restore
 * endpoint accepts a 200 MB upload, so a highly compressible archive could
 * expand into gigabytes and take the console down.
 */

const zlib = require('zlib');
const { createTarGz, extractTarGz, MAX_ARCHIVE_ENTRIES } = require('../services/backupArchive');

function gzipOf(tar) {
    return zlib.gzipSync(tar, { level: 9 });
}

describe('extractTarGz limits', () => {
    it('round-trips a normal backup', () => {
        const archive = createTarGz([
            { name: 'console/data.json', data: '{"ok":true}' },
            { name: 'console/.env', data: 'PORT=5000\n' },
        ]);
        const files = extractTarGz(archive);
        expect(files.get('console/data.json').toString('utf8')).toBe('{"ok":true}');
        expect(files.get('console/.env').toString('utf8')).toBe('PORT=5000\n');
    });

    it('rejects an archive that expands beyond the byte budget', () => {
        // 4 MiB of zeros compresses to a few KB but expands past a 1 MiB budget.
        const archive = createTarGz([{ name: 'bomb.bin', data: Buffer.alloc(4 * 1024 * 1024) }]);
        expect(archive.length).toBeLessThan(64 * 1024);

        expect(() => extractTarGz(archive, { maxBytes: 1024 * 1024 }))
            .toThrow(/expands to|buffer/i);
    });

    it('rejects an archive with too many entries', () => {
        const entries = [];
        for (let i = 0; i < 12; i += 1) {
            entries.push({ name: `f-${i}.txt`, data: 'x' });
        }
        // createTarGz already returns gzip output.
        const archive = createTarGz(entries);

        expect(() => extractTarGz(archive, { maxEntries: 5 }))
            .toThrow(/more than 5 entries/);
    });

    it('rejects an entry whose declared size runs past the archive', () => {
        // Header claims 4096 bytes but the archive ends immediately after it.
        const header = Buffer.alloc(512, 0);
        header.write('truncated.bin', 0, 100, 'utf8');
        header.write('0000644\0', 100, 8, 'ascii');
        header.write('0000000\0', 108, 8, 'ascii');
        header.write('0000000\0', 116, 8, 'ascii');
        header.write('000010000\0', 124, 12, 'ascii'); // 4096 octal
        header.write('00000000000\0', 136, 12, 'ascii');
        header.write('        ', 148, 8, 'ascii');
        header.write('0', 156, 1, 'ascii');
        header.write('ustar\0', 257, 6, 'ascii');
        header.write('00', 263, 2, 'ascii');
        let sum = 0;
        for (const byte of header) sum += byte;
        header.write(sum.toString(8).padStart(6, '0').slice(-6), 148, 6, 'ascii');

        const archive = gzipOf(Buffer.concat([header]));

        expect(() => extractTarGz(archive)).toThrow(/past the end of the archive/);
    });

    it('keeps a documented entry ceiling', () => {
        expect(MAX_ARCHIVE_ENTRIES).toBeGreaterThanOrEqual(1000);
    });
});
