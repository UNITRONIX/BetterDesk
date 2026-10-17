'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { unlinkMulterFiles, isSafeMulterDiskPath } = require('../lib/multerCleanup');

describe('multerCleanup path confinement', () => {
    let tempFile;

    afterEach(() => {
        if (tempFile && fs.existsSync(tempFile)) {
            try { fs.unlinkSync(tempFile); } catch (_) { /* ignore */ }
        }
        tempFile = null;
    });

    test('allows files under os.tmpdir()', () => {
        tempFile = path.join(os.tmpdir(), `bd-multer-test-${process.pid}-${Date.now()}`);
        fs.writeFileSync(tempFile, 'x');
        expect(isSafeMulterDiskPath(tempFile)).toBe(true);
        unlinkMulterFiles({ file: { path: tempFile } });
        expect(fs.existsSync(tempFile)).toBe(false);
        tempFile = null;
    });

    test('rejects path traversal outside temp roots', () => {
        const evil = path.join(os.tmpdir(), '..', 'etc', 'passwd');
        expect(isSafeMulterDiskPath(evil)).toBe(false);
    });

    test('rejects empty or null paths', () => {
        expect(isSafeMulterDiskPath('')).toBe(false);
        expect(isSafeMulterDiskPath(null)).toBe(false);
    });
});
