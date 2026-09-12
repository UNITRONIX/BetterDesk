'use strict';

/** FPS sent to the peer for inactive viewer tabs (RustDesk customFps / CDAP quality_set). */
const BACKGROUND_FPS = 1;

const QUALITY_TO_PRESET = {
    Best: 'best',
    Balanced: 'balanced',
    Low: 'speed',
};

const PRESET_FPS = {
    best: 60,
    balanced: 30,
    quality: 30,
    speed: 60,
};
const FPS_MODES = ['30', '60', 'adaptive'];

const DEFAULTS = {
    quality: 'Best',
    scale: 'fit',
    codec: 'Auto',
    fpsMode: 'adaptive',
    adaptiveQuality: true,
    backgroundFps: BACKGROUND_FPS,
    keyboardMode: 'Auto',
};

function sanitizePrefs(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const clean = { ...DEFAULTS };

    if (['Best', 'Balanced', 'Low'].includes(source.quality)) {
        clean.quality = source.quality;
    }
    if (['fit', 'fill', '1:1', 'stretch'].includes(source.scale)) {
        clean.scale = source.scale;
    }
    if (typeof source.codec === 'string' && source.codec.length <= 16) {
        clean.codec = source.codec;
    }
    if (FPS_MODES.includes(source.fpsMode)) {
        clean.fpsMode = source.fpsMode;
    }
    if (typeof source.adaptiveQuality === 'boolean') {
        clean.adaptiveQuality = source.adaptiveQuality;
    }
    const bg = Number(source.backgroundFps);
    if (Number.isFinite(bg) && bg >= 1 && bg <= 5) {
        clean.backgroundFps = Math.round(bg);
    }
    if (['Legacy', 'Map', 'Auto'].includes(source.keyboardMode)) {
        clean.keyboardMode = source.keyboardMode;
    }

    return clean;
}

function getPresetForQuality(quality) {
    return QUALITY_TO_PRESET[quality] || 'balanced';
}

function getActiveFpsForQuality(quality) {
    return PRESET_FPS[getPresetForQuality(quality)] || 30;
}

function getActiveFpsForMode(mode, quality) {
    if (mode === '60' || mode === 'adaptive') return 60;
    if (mode === '30') return 30;
    return getActiveFpsForQuality(quality);
}

function storageKey(userId) {
    const id = userId != null ? String(userId) : 'anonymous';
    return 'betterdesk_remote_prefs_' + id;
}

function loadRemoteViewerPrefs(userId, storage) {
    if (!storage || typeof storage.getItem !== 'function') {
        return { ...DEFAULTS };
    }
    try {
        const raw = storage.getItem(storageKey(userId));
        if (!raw) return { ...DEFAULTS };
        return sanitizePrefs(JSON.parse(raw));
    } catch (_) {
        return { ...DEFAULTS };
    }
}

function saveRemoteViewerPrefs(userId, prefs, storage) {
    const clean = sanitizePrefs(prefs);
    if (storage && typeof storage.setItem === 'function') {
        try {
            storage.setItem(storageKey(userId), JSON.stringify(clean));
        } catch (_) { /* ignore */ }
    }
    return clean;
}

module.exports = {
    BACKGROUND_FPS,
    DEFAULTS,
    QUALITY_TO_PRESET,
    PRESET_FPS,
    FPS_MODES,
    sanitizePrefs,
    getPresetForQuality,
    getActiveFpsForQuality,
    getActiveFpsForMode,
    storageKey,
    loadRemoteViewerPrefs,
    saveRemoteViewerPrefs,
};
