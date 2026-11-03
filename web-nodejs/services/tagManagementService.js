/**
 * Device tag rename / delete helpers.
 * Tags remain free-form strings on peers; these helpers rewrite visible peers only.
 */

'use strict';

const addressBookSync = require('./rustdeskAddressBookSync');

const MAX_TAG_LENGTH = 50;
const MAX_TAGS_PER_DEVICE = 20;
const SET_PEER_TAGS_CONCURRENCY = 4;

function sanitizeTagName(value) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .trim()
        .slice(0, MAX_TAG_LENGTH);
}

function tagsEqual(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function deviceHasTag(device, tag) {
    const expected = sanitizeTagName(tag).toLowerCase();
    if (!expected) return false;
    return addressBookSync.normalizeTags(device && device.tags).some(t => t.toLowerCase() === expected);
}

function rewriteTagsRename(tags, fromTag, toTag) {
    const from = sanitizeTagName(fromTag);
    const to = sanitizeTagName(toTag);
    if (!from || !to) return addressBookSync.normalizeTags(tags);

    const next = [];
    const seen = new Set();
    let replaced = false;

    for (const tag of addressBookSync.normalizeTags(tags)) {
        let value = tag;
        if (tagsEqual(tag, from)) {
            value = to;
            replaced = true;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(value);
        if (next.length >= MAX_TAGS_PER_DEVICE) break;
    }

    return { tags: next, changed: replaced };
}

function rewriteTagsDelete(tags, tagToRemove) {
    const remove = sanitizeTagName(tagToRemove);
    if (!remove) return { tags: addressBookSync.normalizeTags(tags), changed: false };

    const before = addressBookSync.normalizeTags(tags);
    const next = before.filter(t => !tagsEqual(t, remove));
    return { tags: next, changed: next.length !== before.length };
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const list = Array.isArray(items) ? items : [];
    const limit = Math.max(1, Number(concurrency) || 1);
    const results = new Array(list.length);
    let index = 0;

    async function worker() {
        while (index < list.length) {
            const current = index++;
            results[current] = await mapper(list[current], current);
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(limit, list.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}

/**
 * Rename a tag across visible devices and matching dynamic groups.
 * @returns {{ updatedDevices: number, updatedGroups: number, skipped: number, errors: string[] }}
 */
async function renameTagAcrossScope({
    devices,
    groups,
    fromTag,
    toTag,
    setPeerTags,
    updateDeviceGroup
}) {
    const from = sanitizeTagName(fromTag);
    const to = sanitizeTagName(toTag);
    const errors = [];

    if (!from || !to) {
        return { updatedDevices: 0, updatedGroups: 0, skipped: 0, errors: ['invalid_tag'], from, to };
    }
    // Exact same string after sanitize — nothing to do (case-only renames still proceed)
    if (from === to) {
        return { updatedDevices: 0, updatedGroups: 0, skipped: 0, errors: ['identical'], from, to };
    }

    const targets = (devices || []).filter(d => deviceHasTag(d, from));
    let updatedDevices = 0;
    let skipped = 0;

    await mapWithConcurrency(targets, SET_PEER_TAGS_CONCURRENCY, async (device) => {
        const { tags, changed } = rewriteTagsRename(device.tags, from, to);
        if (!changed) {
            skipped += 1;
            return;
        }
        const result = await setPeerTags(device.id, tags);
        if (!result || result.success === false) {
            errors.push(String(device.id));
            skipped += 1;
            return;
        }
        device.tags = tags;
        updatedDevices += 1;
    });

    let updatedGroups = 0;
    for (const group of groups || []) {
        if ((group.source_type || 'manual') !== 'tag') continue;
        const filter = String(group.tag_filter || '').trim();
        if (!filter || !tagsEqual(filter, from)) continue;
        if (typeof updateDeviceGroup === 'function') {
            await updateDeviceGroup(group.guid, { tag_filter: to });
            group.tag_filter = to;
            updatedGroups += 1;
        }
    }

    return { updatedDevices, updatedGroups, skipped, errors, from, to };
}

/**
 * Remove a tag from all visible devices (dynamic group filters left unchanged).
 * @returns {{ updatedDevices: number, skipped: number, errors: string[], affectedGroups: number }}
 */
async function deleteTagAcrossScope({
    devices,
    groups,
    tag,
    setPeerTags
}) {
    const target = sanitizeTagName(tag);
    const errors = [];

    if (!target) {
        return { updatedDevices: 0, skipped: 0, errors: ['invalid_tag'], affectedGroups: 0, tag: target };
    }

    const peers = (devices || []).filter(d => deviceHasTag(d, target));
    let updatedDevices = 0;
    let skipped = 0;

    await mapWithConcurrency(peers, SET_PEER_TAGS_CONCURRENCY, async (device) => {
        const { tags, changed } = rewriteTagsDelete(device.tags, target);
        if (!changed) {
            skipped += 1;
            return;
        }
        const result = await setPeerTags(device.id, tags);
        if (!result || result.success === false) {
            errors.push(String(device.id));
            skipped += 1;
            return;
        }
        device.tags = tags;
        updatedDevices += 1;
    });

    const affectedGroups = (groups || []).filter(group =>
        (group.source_type || 'manual') === 'tag'
        && tagsEqual(group.tag_filter, target)
    ).length;

    return { updatedDevices, skipped, errors, affectedGroups, tag: target };
}

module.exports = {
    MAX_TAG_LENGTH,
    sanitizeTagName,
    tagsEqual,
    deviceHasTag,
    rewriteTagsRename,
    rewriteTagsDelete,
    renameTagAcrossScope,
    deleteTagAcrossScope
};
