'use strict';

/**
 * Compresses the console API's JSON answers. The device list of a large
 * install is megabytes of JSON on every poll; compressed it is a few percent
 * of that.
 *
 * Only bodies sent with res.json of at least MIN_BYTES are compressed, with
 * Brotli when the client offers it, otherwise gzip, and only when the client
 * asks for one of them. Files, streams, res.send and WebSockets are not
 * touched. The ETag and the 304 answer work as with res.send: the tag is
 * taken from the uncompressed body.
 *
 * The headers are sent at once (the body follows chunked), so a handler that
 * answers twice fails the same way it would without compression.
 */

const zlib = require('zlib');

const MIN_BYTES = 1024;

/** 'br', 'gzip' or null for an Accept-Encoding header */
function pickEncoding(header) {
    const offered = new Map();
    for (const part of String(header || '').split(',')) {
        const [name, ...params] = part.trim().toLowerCase().split(';');
        if (!name) continue;
        let q = 1;
        for (const param of params) {
            const m = /^q=([0-9.]+)$/.exec(param.trim());
            if (m) q = Number(m[1]);
        }
        offered.set(name, q);
    }
    if (offered.get('br') > 0) return 'br';
    if (offered.get('gzip') > 0) return 'gzip';
    return null;
}

function compressor(encoding, size) {
    if (encoding === 'br') {
        return zlib.createBrotliCompress({
            params: {
                // Quality 4 is about as fast as gzip and still smaller
                [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size,
            },
        });
    }
    return zlib.createGzip({ level: 6 });
}

function jsonCompression({ minBytes = MIN_BYTES } = {}) {
    return function compressJson(req, res, next) {
        const encoding = pickEncoding(req.headers['accept-encoding']);
        if (!encoding) return next();

        const json = res.json;
        res.json = function compressedJson(obj) {
            const app = req.app;
            // The app's JSON settings that only Express's own stringify knows
            if (app.get('json escape') || res.headersSent || res.getHeader('Content-Encoding')) {
                return json.call(this, obj);
            }
            const body = JSON.stringify(obj, app.get('json replacer'), app.get('json spaces'));
            if (body === undefined) return json.call(this, obj);
            const buf = Buffer.from(body, 'utf8');
            if (buf.length < minBytes) return json.call(this, obj);

            if (!res.getHeader('Content-Type')) res.set('Content-Type', 'application/json; charset=utf-8');
            res.vary('Accept-Encoding');

            const etagFn = app.get('etag fn');
            if (etagFn && !res.getHeader('ETag') && (req.method === 'GET' || req.method === 'HEAD')) {
                const tag = etagFn(buf, 'utf8');
                if (tag) res.set('ETag', tag);
            }
            if (req.fresh) {
                res.status(304);
                res.removeHeader('Content-Type');
                res.end();
                return res;
            }
            if (res.statusCode === 204 || res.statusCode === 304) {
                res.end();
                return res;
            }

            res.removeHeader('Content-Length');
            res.set('Content-Encoding', encoding);
            res.writeHead(res.statusCode);
            if (req.method === 'HEAD') {
                res.end();
                return res;
            }
            const z = compressor(encoding, buf.length);
            z.on('error', () => res.destroy());
            z.pipe(res);
            z.end(buf);
            return res;
        };
        next();
    };
}

module.exports = { jsonCompression, pickEncoding, MIN_BYTES };
