'use strict';

const db = require('./database');
const {
    ACCESS_LEVELS,
    ACCESS_LEVEL_RANK,
    PANEL_ACCESS_CATALOG,
    PANEL_ACCESS_GROUPS,
    CLIENT_FEATURES,
    normalizeAccessLevel,
    getLegacySectionCeiling,
} = require('../lib/panelAccessCatalog');
const { getEffectivePermissions } = require('./rolePermissionService');

const SUBJECT_TYPES = Object.freeze({
    USER: 'user',
    GROUP: 'group',
});

function validateSubject(subjectType, subjectId) {
    if (![SUBJECT_TYPES.USER, SUBJECT_TYPES.GROUP].includes(subjectType)) {
        const error = new Error('Invalid policy subject type');
        error.status = 400;
        throw error;
    }
    const value = String(subjectId || '').trim();
    if (!value || value.length > 120 || !/^[A-Za-z0-9_.:@-]+$/.test(value)) {
        const error = new Error('Invalid policy subject');
        error.status = 400;
        throw error;
    }
    return value;
}

function normalizeSectionPolicies(policies) {
    const allowed = new Set([
        ...PANEL_ACCESS_CATALOG.map((entry) => entry.key),
        ...PANEL_ACCESS_GROUPS.map((group) => `group:${group.key}`),
    ]);
    const rows = Array.isArray(policies) ? policies : [];
    const result = [];
    const seen = new Set();
    for (const row of rows) {
        const resourceKey = String(row?.resource_key || row?.key || '').trim();
        if (!allowed.has(resourceKey) || seen.has(resourceKey)) continue;
        seen.add(resourceKey);
        result.push({
            resource_key: resourceKey,
            access_level: normalizeAccessLevel(row?.access_level ?? row?.access),
        });
    }
    return result;
}

function normalizeFeaturePolicies(policies) {
    const allowed = new Set(CLIENT_FEATURES.map((feature) => feature.key));
    const rows = Array.isArray(policies) ? policies : [];
    const result = [];
    const seen = new Set();
    for (const row of rows) {
        const featureKey = String(row?.feature_key || row?.key || '').trim();
        if (!allowed.has(featureKey) || seen.has(featureKey)) continue;
        seen.add(featureKey);
        result.push({
            feature_key: featureKey,
            enabled: row?.enabled === true || row?.enabled === 1 || row?.enabled === 'true',
        });
    }
    return result;
}

function rowsToMap(rows, key, value) {
    return new Map((rows || []).map((row) => [String(row[key]), row[value]]));
}

function highestGroupValue(rows, resourceKey, groupKey) {
    let selected = null;
    for (const row of rows) {
        if (row.resource_key !== resourceKey && row.resource_key !== `group:${groupKey}`) continue;
        if (row.access_level === undefined) continue;
        if (selected === null || ACCESS_LEVEL_RANK[normalizeAccessLevel(row.access_level)]
            > ACCESS_LEVEL_RANK[normalizeAccessLevel(selected)]) {
            selected = normalizeAccessLevel(row.access_level);
        }
    }
    return selected;
}

async function getRoleCeiling(role) {
    if (role === 'admin' || role === 'super_admin') {
        return new Map(PANEL_ACCESS_CATALOG.map((entry) => [entry.key, ACCESS_LEVELS.WRITE]));
    }
    const permissions = await getEffectivePermissions(role || 'viewer');
    const hasPermission = (permission) => permissions.has(permission);
    return new Map(PANEL_ACCESS_CATALOG.map((entry) => [
        entry.key,
        getLegacySectionCeiling(entry.key, hasPermission),
    ]));
}

function defaultFeatures() {
    return new Map(CLIENT_FEATURES.map((feature) => [feature.key, true]));
}

async function resolveForUser(user) {
    if (!user || !user.id) {
        const error = new Error('User not found');
        error.status = 404;
        throw error;
    }
    const roleCeiling = await getRoleCeiling(user.role);
    const [userSections, userFeatures, groups] = await Promise.all([
        db.getPanelAccessPolicies(SUBJECT_TYPES.USER, String(user.id)),
        db.getClientFeaturePolicies(SUBJECT_TYPES.USER, String(user.id)),
        db.getUserGroupsForUser(user.id),
    ]);
    const groupRows = [];
    const groupFeatureRows = [];
    for (const group of groups || []) {
        const [sections, features] = await Promise.all([
            db.getPanelAccessPolicies(SUBJECT_TYPES.GROUP, String(group.guid)),
            db.getClientFeaturePolicies(SUBJECT_TYPES.GROUP, String(group.guid)),
        ]);
        groupRows.push(...sections);
        groupFeatureRows.push(...features);
    }

    const directSections = rowsToMap(userSections, 'resource_key', 'access_level');
    const directFeatures = rowsToMap(userFeatures, 'feature_key', 'enabled');
    const inheritedFeatures = new Map();
    for (const row of groupFeatureRows) {
        if (!inheritedFeatures.has(row.feature_key)) inheritedFeatures.set(row.feature_key, !!row.enabled);
        else inheritedFeatures.set(row.feature_key, inheritedFeatures.get(row.feature_key) || !!row.enabled);
    }

    const sections = {};
    for (const entry of PANEL_ACCESS_CATALOG) {
        const inherited = highestGroupValue(groupRows, entry.key, entry.group);
        const directGroup = directSections.get(`group:${entry.group}`);
        const access = directSections.has(entry.key)
            ? normalizeAccessLevel(directSections.get(entry.key))
            : directGroup !== undefined
                ? normalizeAccessLevel(directGroup)
            : inherited || roleCeiling.get(entry.key) || ACCESS_LEVELS.NONE;
        sections[entry.key] = {
            access,
            source: directSections.has(entry.key) || directGroup !== undefined
                ? SUBJECT_TYPES.USER : inherited ? SUBJECT_TYPES.GROUP : 'role',
            role_ceiling: roleCeiling.get(entry.key) || ACCESS_LEVELS.NONE,
        };
    }

    const features = {};
    for (const feature of CLIENT_FEATURES) {
        const enabled = directFeatures.has(feature.key)
            ? !!directFeatures.get(feature.key)
            : inheritedFeatures.has(feature.key)
                ? inheritedFeatures.get(feature.key)
                : true;
        features[feature.key] = {
            enabled: feature.hardLock ? false : enabled,
            source: directFeatures.has(feature.key)
                ? SUBJECT_TYPES.USER
                : inheritedFeatures.has(feature.key) ? SUBJECT_TYPES.GROUP : 'default',
            hard_lock: !!feature.hardLock,
        };
    }
    return {
        subject_type: SUBJECT_TYPES.USER,
        subject_id: String(user.id),
        sections,
        features,
        groups: (groups || []).map((group) => ({ guid: group.guid, name: group.name })),
    };
}

async function resolveForGroup(group) {
    if (!group || !group.guid) {
        const error = new Error('Group not found');
        error.status = 404;
        throw error;
    }
    const [sectionRows, featureRows] = await Promise.all([
        db.getPanelAccessPolicies(SUBJECT_TYPES.GROUP, String(group.guid)),
        db.getClientFeaturePolicies(SUBJECT_TYPES.GROUP, String(group.guid)),
    ]);
    const sectionMap = rowsToMap(sectionRows, 'resource_key', 'access_level');
    const featureMap = rowsToMap(featureRows, 'feature_key', 'enabled');
    const sections = {};
    for (const entry of PANEL_ACCESS_CATALOG) {
        const value = sectionMap.has(entry.key)
            ? normalizeAccessLevel(sectionMap.get(entry.key))
            : sectionMap.has(`group:${entry.group}`)
                ? normalizeAccessLevel(sectionMap.get(`group:${entry.group}`))
            : ACCESS_LEVELS.NONE;
        sections[entry.key] = {
            access: value,
            source: sectionMap.has(entry.key) || sectionMap.has(`group:${entry.group}`)
                ? SUBJECT_TYPES.GROUP : 'unset',
        };
    }
    const features = {};
    for (const feature of CLIENT_FEATURES) {
        features[feature.key] = {
            enabled: feature.hardLock ? false : (featureMap.has(feature.key) ? !!featureMap.get(feature.key) : true),
            source: featureMap.has(feature.key) ? SUBJECT_TYPES.GROUP : 'default',
            hard_lock: !!feature.hardLock,
        };
    }
    return {
        subject_type: SUBJECT_TYPES.GROUP,
        subject_id: String(group.guid),
        sections,
        features,
    };
}

async function loadEffectivePolicy(req, _res, next) {
    if (!req.session?.userId || !req.session.user) return next();
    try {
        req.panelAccessPolicy = await resolveForUser({
            id: req.session.userId,
            role: req.session.user.role,
        });
    } catch (error) {
        req.panelAccessPolicyLoadError = error;
    }
    next();
}

function accessAllows(policy, sectionKey, requiredLevel = ACCESS_LEVELS.READ) {
    const access = policy?.sections?.[sectionKey]?.access;
    return access && ACCESS_LEVEL_RANK[normalizeAccessLevel(access)]
        >= ACCESS_LEVEL_RANK[normalizeAccessLevel(requiredLevel)];
}

async function savePolicy(subjectType, subjectId, body) {
    const validatedId = validateSubject(subjectType, subjectId);
    const sections = normalizeSectionPolicies(body?.sections);
    const features = normalizeFeaturePolicies(body?.features);
    await Promise.all([
        db.setPanelAccessPolicies(subjectType, validatedId, sections),
        db.setClientFeaturePolicies(subjectType, validatedId, features),
    ]);
    return { sections, features };
}

function getCatalog() {
    return {
        levels: [ACCESS_LEVELS.NONE, ACCESS_LEVELS.READ, ACCESS_LEVELS.WRITE],
        groups: PANEL_ACCESS_GROUPS,
        sections: PANEL_ACCESS_CATALOG,
        features: CLIENT_FEATURES,
    };
}

module.exports = {
    SUBJECT_TYPES,
    getCatalog,
    normalizeSectionPolicies,
    normalizeFeaturePolicies,
    resolveForUser,
    resolveForGroup,
    loadEffectivePolicy,
    accessAllows,
    savePolicy,
    validateSubject,
};
