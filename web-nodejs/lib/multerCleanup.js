'use strict';

const fs = require('fs');

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
        if (f && f.path) {
            try {
                fs.unlinkSync(f.path);
            } catch (_) { /* ignore */ }
        }
    }
}

module.exports = { unlinkMulterFiles };
