'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Multer disk paths must stay under known temp roots — never unlink arbitrary
 * request-controlled paths (CodeQL js/path-injection / DEP-04).
 * @param {string} filePath
 * @returns {boolean}
 */
function isSafeMulterDiskPath(filePath) {
    if (typeof filePath !== 'string' || !filePath || filePath.includes('\0')) {
        return false;
    }
    let resolved;
    try {
        resolved = path.resolve(filePath);
    } catch (_) {
        return false;
    }
    const allowedRoots = [path.resolve(os.tmpdir())];
    // Optional console data dir (some upload middlewares land files here).
    try {
        const config = require('../config/config');
        if (config && config.dataDir) {
            allowedRoots.push(path.resolve(config.dataDir));
        }
    } catch (_) { /* config may be unavailable in unit harnesses */ }

    return allowedRoots.some((root) => {
        const rel = path.relative(root, resolved);
        return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
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
        if (f && f.path && isSafeMulterDiskPath(f.path)) {
            try {
                fs.unlinkSync(f.path);
            } catch (_) { /* ignore */ }
        }
    }
}

module.exports = { unlinkMulterFiles, isSafeMulterDiskPath };
