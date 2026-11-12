'use strict';

/**
 * Panel grouping owner switch (strangler stage P2).
 *
 * The console may only ever have one writer for device groups, ACL, folders and
 * grants. These tests pin the switch itself, the fallback rules that keep an
 * older server binary working, and — most importantly — that a refusal from Go
 * is never silently retried through the panel's own writer.
 */

const mockApi = {
    listPanelDeviceGroups: jest.fn(),
    savePanelDeviceGroup: jest.fn(),
    deletePanelDeviceGroup: jest.fn(),
    getPanelDeviceGroupPeers: jest.fn(),
    setPanelDeviceGroupPeers: jest.fn(),
    getPanelDeviceGroupAcl: jest.fn(),
    setPanelDeviceGroupAcl: jest.fn(),
    listPanelFolders: jest.fn(),
    createPanelFolder: jest.fn(),
    updatePanelFolder: jest.fn(),
    deletePanelFolder: jest.fn(),
    setPanelDeviceFolder: jest.fn(),
    listPanelUserGrants: jest.fn(),
    setPanelUserGrants: jest.fn(),
};

jest.mock('../services/betterdeskApi', () => mockApi);

const panelGrouping = require('../services/panelGrouping');

describe('panel grouping owner', () => {
    const original = process.env.BACKEND_PANEL_GROUPING;

    afterEach(() => {
        jest.clearAllMocks();
        if (original === undefined) delete process.env.BACKEND_PANEL_GROUPING;
        else process.env.BACKEND_PANEL_GROUPING = original;
    });

    it('defaults to Go and honours the documented rollback value', () => {
        delete process.env.BACKEND_PANEL_GROUPING;
        expect(panelGrouping.panelGroupingOwner()).toBe('go');
        expect(panelGrouping.writesGoToGo()).toBe(true);

        process.env.BACKEND_PANEL_GROUPING = 'node';
        expect(panelGrouping.panelGroupingOwner()).toBe('node');
        expect(panelGrouping.writesGoToGo()).toBe(false);
    });

    it('treats an unknown value as Go rather than a third mode', () => {
        process.env.BACKEND_PANEL_GROUPING = 'sqlite';
        expect(panelGrouping.panelGroupingOwner()).toBe('go');
    });
});

describe('availability rules', () => {
    it('falls back only when the endpoint is not there', () => {
        [404, 501, 503].forEach((status) => {
            expect(panelGrouping.isUnavailable({ status })).toBe(true);
        });
        expect(panelGrouping.isUnavailable({ error: 'connect ECONNREFUSED 127.0.0.1:21114' })).toBe(true);
        expect(panelGrouping.isUnavailable({ error: 'timeout of 5000ms exceeded' })).toBe(true);
    });

    it('treats a real answer as final', () => {
        // A 400/403 is Go saying no — the console must not rewrite through its
        // own path, or the refusal would be bypassed.
        [400, 401, 403, 409, 422].forEach((status) => {
            expect(panelGrouping.isUnavailable({ status })).toBe(false);
        });
        expect(panelGrouping.isUnavailable({ error: 'name is required' })).toBe(false);
    });
});

describe('Go fallback behaviour', () => {
    it('returns null when the helper is missing entirely', async () => {
        const saved = await panelGrouping.saveGroupToGo({ name: 'x' });
        expect(saved).toBeNull();
    });

    it('returns null when the endpoint is not deployed', async () => {
        mockApi.savePanelDeviceGroup.mockResolvedValue({ success: false, error: 'not found', status: 404 });
        expect(await panelGrouping.saveGroupToGo({ name: 'x' })).toBeNull();
    });

    it('surfaces a refusal instead of hiding it', async () => {
        mockApi.savePanelDeviceGroup.mockResolvedValue({ success: false, error: 'name is required', status: 400 });
        await expect(panelGrouping.saveGroupToGo({ name: '' })).rejects.toMatchObject({
            message: 'name is required',
            status: 400,
            fromGo: true,
        });
    });

    it('returns the saved group on success', async () => {
        mockApi.savePanelDeviceGroup.mockResolvedValue({ success: true, data: { guid: 'g1', name: 'Team' } });
        expect(await panelGrouping.saveGroupToGo({ name: 'Team' })).toEqual({ guid: 'g1', name: 'Team' });
    });

    it('reads membership as a list, or null when unavailable', async () => {
        mockApi.getPanelDeviceGroupPeers.mockResolvedValueOnce({ success: true, data: { peers: ['A', 'B'] } });
        expect(await panelGrouping.getGroupPeersFromGo('g1')).toEqual(['A', 'B']);

        mockApi.getPanelDeviceGroupPeers.mockResolvedValueOnce({ success: false, error: 'not found', status: 404 });
        expect(await panelGrouping.getGroupPeersFromGo('g1')).toBeNull();
    });

    it('never throws when the API module itself fails', async () => {
        mockApi.setPanelDeviceGroupPeers.mockRejectedValue(new Error('socket hang up'));
        expect(await panelGrouping.setGroupPeersInGo('g1', ['A'])).toBeNull();
    });
});
