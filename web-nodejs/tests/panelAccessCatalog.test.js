'use strict';

const {
    ACCESS_LEVELS,
    PANEL_ACCESS_CATALOG,
    CLIENT_FEATURES,
    getLegacySectionCeiling,
    normalizeAccessLevel,
} = require('../lib/panelAccessCatalog');

describe('panel access catalog', () => {
    test('maps legacy permissions to a read/write ceiling', () => {
        const permissions = new Set(['device.view', 'device.edit']);
        const hasPermission = (permission) => permissions.has(permission);

        expect(getLegacySectionCeiling('devices', hasPermission)).toBe(ACCESS_LEVELS.WRITE);
        expect(getLegacySectionCeiling('activity', hasPermission)).toBe(ACCESS_LEVELS.NONE);
        expect(getLegacySectionCeiling('devices', () => false, true)).toBe(ACCESS_LEVELS.WRITE);
    });

    test('contains stable entries for every client feature exposed to policy editors', () => {
        expect(PANEL_ACCESS_CATALOG.some((entry) => entry.key === 'commercialization')).toBe(true);
        expect(PANEL_ACCESS_CATALOG.some((entry) => entry.key === 'settings')).toBe(true);
        expect(CLIENT_FEATURES.map((feature) => feature.key)).toEqual(
            expect.arrayContaining(['file_transfer', 'clipboard', 'audio', 'tunnel'])
        );
    });

    test('normalizes invalid policy values to the restrictive default', () => {
        expect(normalizeAccessLevel('write')).toBe(ACCESS_LEVELS.WRITE);
        expect(normalizeAccessLevel(1)).toBe(ACCESS_LEVELS.READ);
        expect(normalizeAccessLevel('unexpected')).toBe(ACCESS_LEVELS.NONE);
    });
});
