/**
 * BetterDesk Web Remote Client - inbound clipboard decode/apply
 * Handles RustDesk Clipboard / MultiClipboards (zstd, text/html/image).
 */

/* global RDCompress */

// eslint-disable-next-line no-unused-vars
class RDClipboard {
    static OWNER_FORMAT = 'dyn.com.rustdesk.owner';

    static FORMAT = {
        Text: 0,
        Rtf: 1,
        Html: 2,
        ImageRgba: 21,
        ImagePng: 22,
        ImageSvg: 23,
        Special: 31
    };

    /**
     * @param {number|string} format
     * @returns {number}
     */
    static formatId(format) {
        if (format == null) return RDClipboard.FORMAT.Text;
        if (typeof format === 'number') return format;
        const map = {
            Text: RDClipboard.FORMAT.Text,
            Rtf: RDClipboard.FORMAT.Rtf,
            Html: RDClipboard.FORMAT.Html,
            ImageRgba: RDClipboard.FORMAT.ImageRgba,
            ImagePng: RDClipboard.FORMAT.ImagePng,
            ImageSvg: RDClipboard.FORMAT.ImageSvg,
            Special: RDClipboard.FORMAT.Special
        };
        return map[format] != null ? map[format] : RDClipboard.FORMAT.Text;
    }

    /**
     * @param {Object} clipboard
     * @returns {boolean}
     */
    static shouldSkipEntry(clipboard) {
        if (!clipboard) return true;
        const fmt = RDClipboard.formatId(clipboard.format);
        if (fmt !== RDClipboard.FORMAT.Special) return false;
        const name = clipboard.specialName || clipboard.special_name || '';
        return name === RDClipboard.OWNER_FORMAT;
    }

    /**
     * @param {*} content
     * @returns {Uint8Array|null}
     */
    static normalizeContent(content) {
        if (!content) return null;
        if (content instanceof Uint8Array) return content;
        if (content instanceof ArrayBuffer) return new Uint8Array(content);
        if (content.length != null) return new Uint8Array(content);
        return null;
    }

    /**
     * @param {string} html
     * @returns {string}
     */
    static stripHtml(html) {
        if (!html) return '';
        if (typeof DOMParser === 'undefined') return '';
        try {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return (doc.body && doc.body.textContent) ? doc.body.textContent : '';
        } catch (_) {
            return '';
        }
    }

    /**
     * @param {string} rtf
     * @returns {string}
     */
    static extractRtfPlain(rtf) {
        if (!rtf) return '';
        const plainMatch = rtf.match(/\\plain[\s\S]*?(?=\\par|\\cell|\\row|\\}|$)/i);
        if (plainMatch) {
            return plainMatch[0]
                .replace(/^\\plain\s*/i, '')
                .replace(/\\[a-z]+\d* ?/gi, '')
                .replace(/[{}]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }
        return rtf
            .replace(/\\[a-z]+\d* ?/gi, '')
            .replace(/[{}]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * @param {number} width
     * @param {number} height
     * @param {Uint8Array} rgbaBytes
     * @returns {Promise<Blob|null>}
     */
    static rgbaToPngBlob(width, height, rgbaBytes) {
        const w = Number(width) || 0;
        const h = Number(height) || 0;
        const expected = w * h * 4;
        if (!w || !h || rgbaBytes.length < expected) {
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            try {
                const canvas = (typeof OffscreenCanvas !== 'undefined')
                    ? new OffscreenCanvas(w, h)
                    : document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(null);
                    return;
                }
                const slice = rgbaBytes.subarray(0, expected);
                const imgData = new ImageData(new Uint8ClampedArray(slice), w, h);
                ctx.putImageData(imgData, 0, 0);

                if (canvas.convertToBlob) {
                    canvas.convertToBlob({ type: 'image/png' }).then(resolve).catch(() => resolve(null));
                    return;
                }
                canvas.toBlob((blob) => resolve(blob), 'image/png');
            } catch (_) {
                resolve(null);
            }
        });
    }

    /**
     * @param {Object} clipboard - protobuf Clipboard
     * @returns {Promise<Object|null>}
     */
    static async decodeEntry(clipboard) {
        if (!clipboard || RDClipboard.shouldSkipEntry(clipboard)) return null;

        let bytes = RDClipboard.normalizeContent(clipboard.content);
        if (!bytes || !bytes.length) return null;

        const needsDecompress = !!clipboard.compress || RDCompress.isZstdMagic(bytes);
        if (needsDecompress) {
            try {
                bytes = await RDCompress.decompressZstd(bytes, { force: true });
            } catch (err) {
                RDCompress.reportZstdUnavailable(err);
                return null;
            }
        }

        const fmt = RDClipboard.formatId(clipboard.format);
        const decoder = new TextDecoder('utf-8', { fatal: false });

        switch (fmt) {
            case RDClipboard.FORMAT.Text:
                return { format: 'text', text: decoder.decode(bytes) };
            case RDClipboard.FORMAT.Html: {
                const html = decoder.decode(bytes);
                return { format: 'html', html, text: RDClipboard.stripHtml(html) };
            }
            case RDClipboard.FORMAT.Rtf: {
                const rtf = decoder.decode(bytes);
                return { format: 'rtf', text: RDClipboard.extractRtfPlain(rtf) };
            }
            case RDClipboard.FORMAT.ImagePng:
                return { format: 'image/png', pngBlob: new Blob([bytes], { type: 'image/png' }) };
            case RDClipboard.FORMAT.ImageRgba: {
                const blob = await RDClipboard.rgbaToPngBlob(clipboard.width, clipboard.height, bytes);
                if (!blob) return null;
                return { format: 'image/png', pngBlob: blob };
            }
            case RDClipboard.FORMAT.ImageSvg: {
                const svg = decoder.decode(bytes);
                return { format: 'image/svg+xml', svgText: svg, text: svg };
            }
            default:
                return null;
        }
    }

    /**
     * @param {Object[]} entries
     * @returns {string}
     */
    static pickBestText(entries) {
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e && e.format === 'text' && e.text) return e.text;
        }
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e && e.format === 'html' && e.text) return e.text;
        }
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e && e.format === 'rtf' && e.text) return e.text;
        }
        for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (e && e.format === 'image/svg+xml' && e.text) return e.text;
        }
        return '';
    }

    /**
     * @param {Object[]} decodedEntries
     * @param {Object} [opts]
     * @param {boolean} [opts.enabled]
     * @returns {Promise<void>}
     */
    static async applyToLocal(decodedEntries, opts) {
        const options = opts || {};
        if (!options.enabled) return;
        const entries = (decodedEntries || []).filter(Boolean);
        if (!entries.length) return;
        await RDClipboard.writeLocalRich({
            text: RDClipboard.pickBestText(entries),
            html: (entries.find((e) => e.format === 'html' && e.html) || {}).html || '',
            pngBlob: (entries.find((e) => e.pngBlob) || {}).pngBlob || null
        });
    }

    /**
     * Read the richest clipboard representation supported by this browser.
     * @returns {Promise<Object>}
     */
    static async readLocalRich() {
        if (!navigator.clipboard) throw new Error('clipboard_unavailable');
        if (navigator.clipboard.read) {
            const items = await navigator.clipboard.read();
            const entry = {};
            for (const item of items || []) {
                if (item.types.includes('text/plain')) {
                    entry.text = await (await item.getType('text/plain')).text();
                }
                if (item.types.includes('text/html')) {
                    entry.html = await (await item.getType('text/html')).text();
                }
                const imageType = item.types.find((type) => type === 'image/png');
                if (imageType) entry.pngBlob = await item.getType(imageType);
            }
            if (entry.text || entry.html || entry.pngBlob) return entry;
        }
        if (navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text) return { text };
        }
        return {};
    }

    /**
     * Write a rich clipboard entry. The return value lets the UI distinguish
     * browser permission failures from an empty clipboard.
     * @param {Object} entry
     * @returns {Promise<{ok: boolean, reason?: string}>}
     */
    static async writeLocalRich(entry) {
        if (!navigator.clipboard) return { ok: false, reason: 'clipboard_unavailable' };

        const value = entry || {};
        const text = value.text || '';

        try {
            if (navigator.clipboard.write && typeof ClipboardItem !== 'undefined' &&
                (value.pngBlob || value.html)) {
                const data = {};
                if (value.pngBlob) data['image/png'] = value.pngBlob;
                if (value.html) {
                    data['text/html'] = new Blob([value.html], { type: 'text/html' });
                    data['text/plain'] = new Blob([text || RDClipboard.stripHtml(value.html)], {
                        type: 'text/plain'
                    });
                } else if (text) {
                    data['text/plain'] = new Blob([text], { type: 'text/plain' });
                }
                await navigator.clipboard.write([new ClipboardItem(data)]);
                return { ok: true };
            }
            if (text && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return { ok: true };
            }
            return { ok: false, reason: 'clipboard_write_unsupported' };
        } catch (err) {
            if (text && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(text);
                    return { ok: true, reason: 'rich_write_fallback' };
                } catch (_) {
                    return { ok: false, reason: 'clipboard_permission_denied' };
                }
            }
            return { ok: false, reason: 'clipboard_permission_denied' };
        }
    }

    /**
     * @param {Object[]} clipboards
     * @returns {Promise<Object[]>}
     */
    static async decodeEntries(clipboards) {
        const list = clipboards || [];
        const out = [];
        for (let i = 0; i < list.length; i++) {
            const decoded = await RDClipboard.decodeEntry(list[i]);
            if (decoded) out.push(decoded);
        }
        return out;
    }
}
