'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const SAFE_SEG = /^[A-Za-z0-9._-]+$/;

/**
 * Multer disk cleanup must never unlink an arbitrary request path.
 * Rebuild the target as allowedRoot + safe relative segments (CodeQL confinement).
 * @param {string} filePath
 * @returns {string|null} absolute path under an allowed root, or null
 */
function resolveConfinedMulterPath(filePath) {
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
        return null;
    }

    let originalResolved;
    try {
        originalResolved = path.resolve(filePath);
    } catch (_) {
        return null;
    }

    const allowedRoots = [path.resolve(os.tmpdir())];
    try {
        const config = require('../config/config');
        if (config && config.dataDir) {
            allowedRoots.push(path.resolve(config.dataDir));
        }
    } catch (_) { /* config may be unavailable in unit harnesses */ }

    for (const root of allowedRoots) {
        const rel = path.relative(root, originalResolved);
        if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
            continue;
        }
        const segments = rel.split(path.sep).filter(Boolean);
        if (!segments.length || !segments.every((seg) => SAFE_SEG.test(seg))) {
            continue;
        }
        const candidate = path.resolve(root, ...segments);
        if (candidate === originalResolved) {
            return candidate;
        }
    }
    return null;
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isSafeMulterDiskPath(filePath) {
    return resolveConfinedMulterPath(filePath) !== null;
}

/**
 * Best-effort unlink of multer disk files after aborted / failed uploads (DEP-04).
 * @param {import('express').Request} req
 */
function unlinkMulterFiles(req) {
    const files = [];
    if (req.file) files.push(req.file);
    if (req.files) {
        if (Array.isArray(req.files)) {
            files.push(...req.files);
        } else {
            for (const list of Object.values(req.files)) {
                if (Array.isArray(list)) files.push(...list);
            }
        }
    }
    for (const f of files) {
        if (!f || !f.path) continue;
        const confined = resolveConfinedMulterPath(f.path);
        if (!confined) continue;
        try {
            fs.unlinkSync(confined);
        } catch (_) { /* ignore */ }
    }
}

module.exports = {
    unlinkMulterFiles,
    isSafeMulterDiskPath,
    resolveConfinedMulterPath,
};
