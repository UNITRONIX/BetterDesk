'use strict';

/**
 * JSON body parsing for the console. Bodies are capped at 2 MB (base64 logo
 * images are the largest regular ones).
 *
 * Ticket attachments arrive as base64 inside JSON (POST
 * /api/tickets/:id/attachments) and may be up to 25 MB before encoding. The
 * console-wide parser leaves that one path alone; the route parses it with
 * `attachmentBody` after the sign-in and permission checks, so a request
 * that may not attach anything is never read past its headers.
 */

const express = require('express');

const DEFAULT_LIMIT = '2mb';
// 25 MB as base64 is 33.4 MB; the rest is the filename and the JSON keys
const ATTACHMENT_LIMIT = '35mb';
const ATTACHMENT_PATH = /^\/api\/tickets\/\d+\/attachments\/?$/;

const attachmentBody = express.json({ limit: ATTACHMENT_LIMIT });

function jsonBody() {
    const regular = express.json({ limit: DEFAULT_LIMIT });
    return function parseJson(req, res, next) {
        if (req.method === 'POST' && ATTACHMENT_PATH.test(req.path)) return next();
        return regular(req, res, next);
    };
}

module.exports = { jsonBody, attachmentBody, ATTACHMENT_PATH, DEFAULT_LIMIT, ATTACHMENT_LIMIT };
