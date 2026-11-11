'use strict';

/**
 * BetterDesk Console — panel grouping owner switch.
 *
 * Stage P2 of docs/important/console-backend-strangler.md moves the writes for
 * device groups, their members/ACL, folders and per-user device grants into the
 * Go server. The console keeps its screens, routes and response shapes; only
 * the writer changes.
 *
 * `BACKEND_PANEL_GROUPING=go` (default) sends writes to Go. Setting it to
 * `node` puts the old writer back without redeploying, which is the rollback
 * described in the strangler document. Reads always come from Go first, because
 * Go already owned the reader the RustDesk client uses — a split would let the
 * panel and the client disagree.
 */

const config = require('../config/config');
const betterdeskApi = require('./betterdeskApi');
const panelTrust = require('./panelTrust');

const OWNER_GO = 'go';
const OWNER_NODE = 'node';

/** Which process owns the panel grouping writes for this deployment. */
function panelGroupingOwner() {
    const raw = String(process.env.BACKEND_PANEL_GROUPING || config.backendPanelGrouping || OWNER_GO)
        .trim()
        .toLowerCase();
    return raw === OWNER_NODE ? OWNER_NODE : OWNER_GO;
}

/** True when the console must send grouping writes to Go. */
function writesGoToGo() {
    return panelGroupingOwner() === OWNER_GO;
}

/**
 * A Go call failed in a way that means the endpoint is not deployed yet
 * (404/501/503) — during a staged rollout the console should fall back rather
 * than break the screen. A 400/403 is a real answer and must not be retried
 * through the other writer.
 */
function isUnavailable(result) {
    const status = result && result.status;
    if (status === 404 || status === 501 || status === 503) return true;
    const error = String(result && result.error || '');
    return /ECONNREFUSED|ENOTFOUND|timeout|socket hang up/i.test(error);
}

/**
 * Request config for one panel call: the trust statement that carries the
 * operator's own identity, so Go enforces their role instead of the API key's.
 * `path` is the API path without the /api prefix, matching what betterdeskApi
 * appends to its base URL.
 */
function panelConfig(method, path, req) {
    if (!req || !panelTrust.panelTrustEnabled()) return undefined;
    const identity = panelTrust.identityFromRequest(req);
    if (!identity) return undefined;
    const headers = panelTrust.panelTrustHeaders(identity, method, `/api${path}`);
    return Object.keys(headers).length ? { headers } : undefined;
}

/**
 * Call one Go helper defensively. A console running against an older server
 * binary — or a test double that only stubs the endpoints it needs — must fall
 * back to its own writer instead of throwing.
 */
async function callGo(name, ...args) {
    const fn = betterdeskApi[name];
    if (typeof fn !== 'function') return null;
    try {
        return await fn(...args);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ---------------------------------------------------------------------------
// Device groups
// ---------------------------------------------------------------------------

/**
 * List groups from Go. Returns null when Go cannot answer, so the caller keeps
 * its own reading path (which is what the panel does today).
 */
async function listGroupsFromGo(req) {
    const result = await callGo('listPanelDeviceGroups', panelConfig('GET', '/panel/device-groups', req));
    if (result && result.success && result.data && Array.isArray(result.data.groups)) return result.data.groups;
    return null;
}

/** Save a group through Go; returns the saved group or null when unavailable. */
async function saveGroupToGo(payload, req) {
    const result = await callGo('savePanelDeviceGroup', payload, panelConfig('POST', '/panel/device-groups', req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not save the device group');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

/** Delete a group through Go. Returns true/false, or null when unavailable. */
async function deleteGroupFromGo(guid, req) {
    const result = await callGo('deletePanelDeviceGroup', guid, panelConfig('DELETE', '/panel/device-groups/' + guid, req));
    if (!result) return null;
    if (result.success) return true;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not delete the device group');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

/** Replace group membership through Go. */
async function setGroupPeersInGo(guid, peers, req) {
    const result = await callGo('setPanelDeviceGroupPeers', guid, peers, panelConfig('PUT', '/panel/device-groups/' + guid + '/peers', req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not save group members');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

/** Read a group's membership from Go; null when unavailable. */
async function getGroupPeersFromGo(guid, req) {
    const result = await callGo('getPanelDeviceGroupPeers', guid, panelConfig('GET', '/panel/device-groups/' + guid + '/peers', req));
    if (!result) return null;
    if (result.success && result.data && Array.isArray(result.data.peers)) return result.data.peers;
    return null;
}

/** Replace a group's ACL through Go. */
async function setGroupAclInGo(guid, acl, req) {
    const result = await callGo('setPanelDeviceGroupAcl', guid, acl, panelConfig('PUT', '/panel/device-groups/' + guid + '/acl', req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not save group access');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/** List folders (and assignments) from Go, or null when unavailable. */
async function listFoldersFromGo(req) {
    const result = await callGo('listPanelFolders', panelConfig('GET', '/panel/folders', req));
    if (result && result.success && result.data) return result.data;
    return null;
}

async function createFolderInGo(folder, req) {
    const result = await callGo('createPanelFolder', folder, panelConfig('POST', '/panel/folders', req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not create the folder');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

async function updateFolderInGo(id, folder, req) {
    const result = await callGo('updatePanelFolder', id, folder, panelConfig('PUT', '/panel/folders/' + Number(id), req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not update the folder');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

async function deleteFolderInGo(id, req) {
    const result = await callGo('deletePanelFolder', id, panelConfig('DELETE', '/panel/folders/' + Number(id), req));
    if (!result) return null;
    if (result.success) return true;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not delete the folder');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

async function setDeviceFolderInGo(deviceId, folderId, req) {
    const result = await callGo('setPanelDeviceFolder', deviceId, folderId, panelConfig('PUT', '/panel/devices/' + deviceId + '/folder', req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not move the device');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

// ---------------------------------------------------------------------------
// Per-user grants
// ---------------------------------------------------------------------------

async function listUserGrantsFromGo(userId, req) {
    const result = await callGo('listPanelUserGrants', userId, panelConfig('GET', '/panel/users/' + userId + '/grants', req));
    if (result && result.success && result.data) return result.data;
    return null;
}

async function setUserGrantsInGo(userId, peers, req) {
    const result = await callGo('setPanelUserGrants', userId, peers, panelConfig('PUT', '/panel/users/' + userId + '/grants', req));
    if (!result) return null;
    if (result.success) return result.data;
    if (isUnavailable(result)) return null;
    const error = new Error(result.error || 'Could not save device access');
    error.status = result.status || 502;
    error.fromGo = true;
    throw error;
}

module.exports = {
    OWNER_GO,
    OWNER_NODE,
    panelGroupingOwner,
    writesGoToGo,
    isUnavailable,
    listGroupsFromGo,
    saveGroupToGo,
    deleteGroupFromGo,
    setGroupPeersInGo,
    getGroupPeersFromGo,
    setGroupAclInGo,
    listFoldersFromGo,
    createFolderInGo,
    updateFolderInGo,
    deleteFolderInGo,
    setDeviceFolderInGo,
    listUserGrantsFromGo,
    setUserGrantsInGo,
};
