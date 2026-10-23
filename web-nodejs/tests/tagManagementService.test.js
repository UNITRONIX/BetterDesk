/**
 * Tag management helper unit tests
 */

const {
    sanitizeTagName,
    rewriteTagsRename,
    rewriteTagsDelete,
    renameTagAcrossScope,
    deleteTagAcrossScope
} = require('../services/tagManagementService');

describe('tagManagementService', () => {
    it('sanitizes tag names', () => {
        expect(sanitizeTagName('  Hello\x00  ')).toBe('Hello');
        expect(sanitizeTagName('x'.repeat(80))).toHaveLength(50);
        expect(sanitizeTagName(null)).toBe('');
    });

    it('renames tags case-insensitively and dedupes', () => {
        expect(rewriteTagsRename(['Linux', 'Kiosk'], 'linux', 'GNU')).toEqual({
            tags: ['GNU', 'Kiosk'],
            changed: true
        });
        expect(rewriteTagsRename(['GNU', 'Linux'], 'Linux', 'GNU')).toEqual({
            tags: ['GNU'],
            changed: true
        });
        expect(rewriteTagsRename(['Windows'], 'Linux', 'GNU').changed).toBe(false);
    });

    it('deletes tags case-insensitively', () => {
        expect(rewriteTagsDelete(['Temp', 'Keep'], 'temp')).toEqual({
            tags: ['Keep'],
            changed: true
        });
        expect(rewriteTagsDelete(['Keep'], 'Temp').changed).toBe(false);
    });

    it('renameTagAcrossScope updates devices and groups', async () => {
        const setPeerTags = jest.fn().mockResolvedValue({ success: true });
        const updateDeviceGroup = jest.fn().mockResolvedValue(undefined);
        const devices = [
            { id: '1', tags: ['A', 'B'] },
            { id: '2', tags: ['C'] }
        ];
        const groups = [
            { guid: 'g1', source_type: 'tag', tag_filter: 'A' },
            { guid: 'g2', source_type: 'manual', tag_filter: 'A' }
        ];

        const result = await renameTagAcrossScope({
            devices,
            groups,
            fromTag: 'A',
            toTag: 'Z',
            setPeerTags,
            updateDeviceGroup
        });

        expect(result.updatedDevices).toBe(1);
        expect(result.updatedGroups).toBe(1);
        expect(setPeerTags).toHaveBeenCalledWith('1', ['Z', 'B']);
        expect(updateDeviceGroup).toHaveBeenCalledWith('g1', { tag_filter: 'Z' });
        expect(groups[0].tag_filter).toBe('Z');
    });

    it('deleteTagAcrossScope strips tags and reports affected groups', async () => {
        const setPeerTags = jest.fn().mockResolvedValue({ success: true });
        const result = await deleteTagAcrossScope({
            devices: [
                { id: '1', tags: ['Temp'] },
                { id: '2', tags: ['Keep'] }
            ],
            groups: [{ guid: 'g', source_type: 'tag', tag_filter: 'Temp' }],
            tag: 'Temp',
            setPeerTags
        });

        expect(result.updatedDevices).toBe(1);
        expect(result.affectedGroups).toBe(1);
        expect(setPeerTags).toHaveBeenCalledWith('1', []);
    });
});
