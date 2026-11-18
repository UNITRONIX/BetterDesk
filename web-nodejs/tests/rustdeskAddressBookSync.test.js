/**
 * BetterDesk Console - RustDesk address book sync helper tests
 */

const sync = require('../services/rustdeskAddressBookSync');

describe('rustdeskAddressBookSync', () => {
    it('builds a per-peer alias map without filling aliases from panel names', () => {
        const aliases = sync.buildLegacyAliasMap(JSON.stringify({
            peers: [
                { id: 'A', alias: 'Office', display_name: 'Panel name' },
                { id: 'B', hostname: 'No alias' },
                { id: 'C', alias: 42 }
            ],
            tags: ['Office']
        }));

        expect(aliases.get('A')).toBe('Office');
        expect(aliases.get('B')).toBe('');
        expect(aliases.get('C')).toBe('');
        expect(aliases.has('missing')).toBe(false);
    });

    it('updates one legacy alias while preserving the complete AB document', () => {
        const raw = JSON.stringify({
            peers: [{
                id: 'A',
                alias: 'Old name',
                hash: 'secret-hash',
                tags: ['Office'],
                custom_field: 'keep me'
            }],
            tags: ['Office'],
            tag_colors: '{"Office":123}',
            rule: { mode: 'shared' }
        });

        const result = JSON.parse(sync.updateLegacyPeerAlias(raw, 'A', 'New name'));

        expect(result).toEqual({
            peers: [{
                id: 'A',
                alias: 'New name',
                hash: 'secret-hash',
                tags: ['Office'],
                custom_field: 'keep me'
            }],
            tags: ['Office'],
            tag_colors: '{"Office":123}',
            rule: { mode: 'shared' }
        });
    });

    it('adds a missing peer only when a non-empty alias is saved', () => {
        const added = JSON.parse(sync.updateLegacyPeerAlias('{}', 'NEW', 'New device'));
        const cleared = JSON.parse(sync.updateLegacyPeerAlias('{}', 'NEW', ''));

        expect(added.peers).toEqual([{ id: 'NEW', alias: 'New device' }]);
        expect(cleared.peers).toEqual([]);
    });

    it('sanitizes control characters and limits aliases to 128 characters', () => {
        const alias = sync.sanitizeAlias(`  Office\u0000 PC  ${'x'.repeat(200)}`);

        expect(alias).toBe(`Office PC  ${'x'.repeat(200)}`.slice(0, 128));
    });

    it('merges panel tags into existing address book peers without turning folders into tags', () => {
        const result = JSON.parse(sync.mergeAddressBookData(JSON.stringify({
            peers: [{ id: '123456789', tags: ['Existing'] }],
            tags: ['Existing']
        }), {
            devices: [
                { id: '123456789', hostname: 'PC-1', tags: ['Internal'], folder_id: 2 },
                { id: '987654321', hostname: 'PC-2', tags: 'External' }
            ],
            folders: [{ id: 2, name: 'Workstations' }],
            assignments: {},
            includeDevices: true
        }));

        expect(result.tags).toEqual(['Existing', 'Internal', 'External']);
        expect(result.peers).toHaveLength(2);
        expect(result.peers[0].tags).toEqual(['Existing', 'Internal']);
        expect(result.peers[1]).toMatchObject({
            id: '987654321',
            hostname: 'PC-2',
            tags: ['External']
        });
    });

    it('does not add new peers when includeDevices is false', () => {
        const result = JSON.parse(sync.mergeAddressBookData('{}', {
            devices: [{ id: '123456789', tags: ['Internal'] }],
            includeDevices: false
        }));

        expect(result.peers).toEqual([]);
        expect(result.tags).toEqual([]);
    });

    it('preserves address book tags that share names with folders', () => {
        const result = JSON.parse(sync.mergeAddressBookData(JSON.stringify({
            peers: [{ id: '123456789', tags: ['Servers', 'Windows'] }],
            tags: ['Servers', 'Windows']
        }), {
            devices: [{ id: '123456789', tags: ['Servers', 'Internal'] }],
            folders: [{ id: 1, name: 'Servers' }],
            includeDevices: false
        }));

        expect(result.tags).toEqual(['Servers', 'Windows', 'Internal']);
        expect(result.peers[0].tags).toEqual(['Servers', 'Windows', 'Internal']);
    });

    it('keeps visible device tags even when a folder has the same name', () => {
        const tags = sync.collectVisibleTags(
            [{ id: '123456789', tags: ['Servers'], folder_id: 1 }],
            [{ id: 1, name: 'Servers' }],
            { '123456789': 1 }
        );

        expect(tags).toEqual(['Servers']);
    });

    it('collects a sorted unique tag list for suggestions', () => {
        const tags = sync.collectVisibleTags(
            [
                { id: '123456789', tags: ['Internal', 'Windows'] },
                { id: '987654321', tags: 'External, Windows', folder_id: 4 }
            ],
            [{ id: 4, name: 'Laptops' }],
            {}
        );

        expect(tags).toEqual(['External', 'Internal', 'Windows']);
    });

    it('extracts peer tag updates from client address book data', () => {
        const updates = sync.collectPeerTagUpdates(JSON.stringify({
            peers: [
                { id: '123456789', tags: ['Client', 'Windows', 'Servers'] },
                { id: '987654321' }
            ],
            tags: ['Client']
        }), { folders: [{ id: 1, name: 'Servers' }] });

        expect(updates).toEqual([
            { id: '123456789', tags: ['Client', 'Windows', 'Servers'] }
        ]);
    });

    it('filters known out-of-scope peers while keeping typed remote IDs', () => {
        const result = JSON.parse(sync.filterAddressBookPeersByScope(JSON.stringify({
            peers: [
                { id: 'ALLOW1', alias: 'Ok' },
                { id: 'DENY1', alias: 'Hidden' },
                { id: 'REMOTE', alias: 'Typed' }
            ],
            tags: ['X']
        }), {
            visibleIds: new Set(['ALLOW1']),
            knownDeviceIds: ['ALLOW1', 'DENY1']
        }));

        expect(result.peers.map(p => p.id)).toEqual(['ALLOW1', 'REMOTE']);
    });

    it('leaves address book unchanged when visibleIds is null', () => {
        const raw = JSON.stringify({ peers: [{ id: 'A' }], tags: [] });
        expect(sync.filterAddressBookPeersByScope(raw, { visibleIds: null })).toBe(
            JSON.stringify({ peers: [{ id: 'A' }], tags: [] })
        );
    });
});
