'use strict';

jest.mock('../services/database', () => ({
    getSetting: jest.fn().mockResolvedValue(null),
    setSetting: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../services/backupService', () => ({
    createFullBackup: jest.fn(),
    validateFullBackup: jest.fn()
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const scheduledBackupService = require('../services/scheduledBackupService');

describe('scheduled backup service', () => {
    it('writes and removes a destination probe', async () => {
        const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-backup-test-'));
        try {
            const result = await scheduledBackupService.testDestination({
                destinationType: 'path',
                destinationPath: destination
            });
            expect(result.valid).toBe(true);
            expect(fs.readdirSync(destination)).toEqual([]);
        } finally {
            fs.rmSync(destination, { recursive: true, force: true });
        }
    });

    it('rejects the filesystem root as a custom destination', async () => {
        await expect(scheduledBackupService.testDestination({
            destinationType: 'path',
            destinationPath: path.parse(process.cwd()).root
        })).rejects.toThrow('filesystem root');
    });

    it('masks saved SMB passwords when reading settings', async () => {
        const db = require('../services/database');
        db.getSetting.mockResolvedValueOnce(JSON.stringify({
            host: 'nas.example',
            share: 'backups',
            username: 'backup',
            password: 'secret'
        }));
        const settings = await scheduledBackupService.getSmbSettings();
        expect(settings.password).toBe('********');
        expect(settings.username).toBe('backup');
    });
});
