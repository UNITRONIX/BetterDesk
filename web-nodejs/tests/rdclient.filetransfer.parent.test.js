/**
 * Regression for #467: browsing up from C:\Users must land on the drive root
 * (C:\), not on bare "C:".
 *
 * Win32 resolves bare "C:" to the process working directory on that drive, so
 * the remote listing showed unrelated files (typically under Windows) instead
 * of C:\. The desktop client already used drive-root-aware parents; this pins
 * the Web Remote / Mesh behaviour.
 */

const { RDFileTransfer } = require('../../web-ui/static/rdclient/filetransfer');

describe('RDFileTransfer.parentRemotePath', () => {
    it('keeps the drive root separator when stepping up to it', () => {
        expect(RDFileTransfer.parentRemotePath('C:\\Users')).toBe('C:\\');
        expect(RDFileTransfer.parentRemotePath('C:\\Users\\usera')).toBe('C:\\Users');
    });

    it('never returns bare "C:" for any Windows path', () => {
        const paths = [
            'C:\\Users',
            'C:\\Users\\usera\\Documents',
            'C:\\Program Files\\Apps',
            'D:\\data',
        ];
        for (const p of paths) {
            expect(RDFileTransfer.parentRemotePath(p)).not.toBe('C:');
            expect(RDFileTransfer.parentRemotePath(p)).not.toBe('D:');
        }
    });

    it('returns an empty string at a drive root so the UI shows the drive list', () => {
        expect(RDFileTransfer.parentRemotePath('C:\\')).toBe('');
        expect(RDFileTransfer.parentRemotePath('C:')).toBe('');
        expect(RDFileTransfer.parentRemotePath('C:\\\\')).toBe('');
    });

    it('handles Unix roots and parent traversal', () => {
        expect(RDFileTransfer.parentRemotePath('/')).toBe('');
        expect(RDFileTransfer.parentRemotePath('/home')).toBe('/');
        expect(RDFileTransfer.parentRemotePath('/home/user/docs')).toBe('/home/user');
    });

    it('returns an empty string for empty input', () => {
        expect(RDFileTransfer.parentRemotePath('')).toBe('');
        expect(RDFileTransfer.parentRemotePath(null)).toBe('');
        expect(RDFileTransfer.parentRemotePath(undefined)).toBe('');
    });
});
