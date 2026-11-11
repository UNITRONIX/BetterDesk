'use strict';

/**
 * Panel catalog parity (strangler stage P3).
 *
 * The console used to define the panel sections and the role map itself, while
 * the Go server defined the permissions. Discussion #496 calls that the "second
 * copy of the permissions". Go now serves the catalog at /api/panel/catalog and
 * the console loads it; the bundled file is a fallback for an older server
 * binary.
 *
 * This test keeps the two definitions identical, so a change on either side
 * fails CI instead of silently giving a role different pages depending on which
 * copy answered.
 */

const fs = require('fs');
const path = require('path');

const { PANEL_ACCESS_CATALOG, PANEL_ACCESS_GROUPS, panelCatalog, resetPanelCatalog } = require('../lib/panelAccessCatalog');

const goSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'betterdesk-server', 'api', 'panel_catalog.go'),
    'utf8',
);

/** Parse the Go section list literal into the same shape the JS file uses. */
function goSections() {
    const block = goSource.slice(goSource.indexOf('var panelSectionCatalog'), goSource.indexOf('// panelSectionGroups'));
    const out = [];
    for (const line of block.split('\n')) {
        const match = line.match(/\{Key: "([^"]+)", Label: "([^"]+)", Group: "([^"]+)"/);
        if (!match) continue;
        const read = line.match(/ReadPermission: auth\.(\w+)/);
        const write = line.match(/WritePermission: auth\.(\w+)/);
        out.push({
            key: match[1],
            label: match[2],
            group: match[3],
            readPermission: read ? read[1] : null,
            writePermission: write ? write[1] : null,
        });
    }
    return out;
}

/** auth.<Const> → the permission string the constant stands for. */
function goPermissionConstants() {
    const permsSource = fs.readFileSync(
        path.join(__dirname, '..', '..', 'betterdesk-server', 'auth', 'permissions.go'),
        'utf8',
    );
    const map = {};
    for (const line of permsSource.split('\n')) {
        const match = line.match(/(Perm\w+)\s*=\s*"([^"]+)"/);
        if (match) map[match[1]] = match[2];
    }
    return map;
}

describe('panel catalog parity between the console and Go', () => {
    it('has the same sections, in the same order, with the same permissions', () => {
        const constants = goPermissionConstants();
        const fromGo = goSections().map((section) => ({
            key: section.key,
            label: section.label,
            group: section.group,
            readPermission: section.readPermission ? constants[section.readPermission] : null,
            writePermission: section.writePermission ? constants[section.writePermission] : null,
        }));

        const fromConsole = PANEL_ACCESS_CATALOG.map((entry) => ({
            key: entry.key,
            label: entry.label,
            group: entry.group,
            readPermission: entry.readPermission || null,
            writePermission: entry.writePermission || null,
        }));

        expect(fromGo.length).toBeGreaterThan(20);
        expect(fromGo).toEqual(fromConsole);
    });

    it('uses the same group list', () => {
        const goGroups = [];
        const block = goSource.slice(goSource.indexOf('var panelSectionGroups'), goSource.indexOf('// roleDefaults'));
        for (const line of block.split('\n')) {
            const match = line.match(/\{"key": "([^"]+)", "label": "([^"]+)"\}/);
            if (match) goGroups.push({ key: match[1], label: match[2] });
        }
        expect(goGroups).toEqual(PANEL_ACCESS_GROUPS.map((g) => ({ key: g.key, label: g.label })));
    });
});

describe('panel catalog loading', () => {
    afterEach(() => resetPanelCatalog());

    it('falls back to the bundled copy before anything is loaded', () => {
        const catalog = panelCatalog();
        expect(catalog.sections.length).toBe(PANEL_ACCESS_CATALOG.length);
        expect(Array.isArray(catalog.permissions)).toBe(true);
        expect(catalog.permissions.length).toBeGreaterThan(10);
    });

    it('keeps lookups working off the bundled copy', () => {
        const { getCatalogEntry } = require('../lib/panelAccessCatalog');
        expect(getCatalogEntry('devices')).toMatchObject({ key: 'devices', readPermission: 'device.view' });
        expect(getCatalogEntry('not-a-section')).toBeNull();
    });
});
