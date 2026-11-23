/**
 * BetterDesk Web Remote Client - Canvas Renderer
 * Renders decoded video frames on canvas with cursor overlay
 */

// eslint-disable-next-line no-unused-vars
class RDRenderer {
    /**
     * @param {HTMLCanvasElement} canvas - The rendering canvas element
     */
    constructor(canvas) {
        /** @type {HTMLCanvasElement} */
        this.canvas = canvas;
        /** @type {CanvasRenderingContext2D} */
        this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        /** @type {HTMLCanvasElement} Offscreen canvas for cursor */
        this.cursorCanvas = document.createElement('canvas');
        /** @type {CanvasRenderingContext2D} */
        this.cursorCtx = this.cursorCanvas.getContext('2d');

        /** @type {number} Remote display width */
        this.remoteWidth = 0;
        /** @type {number} Remote display height */
        this.remoteHeight = 0;

        /** @type {string} Scale mode: fit | fill | 1:1 | stretch */
        this.scaleMode = 'fit';

        /** @type {Object} Current scale/offset applied */
        this.transform = { scale: 1, offsetX: 0, offsetY: 0 };

        /** @type {ImageBitmap|null} Current cursor image */
        this.cursorImage = null;
        /** @type {Object} Cursor hotspot */
        this.cursorHotspot = { x: 0, y: 0 };
        /** @type {Object} Cursor position (remote coordinates) */
        this.cursorPos = { x: 0, y: 0 };
        /** @type {boolean} Show remote cursor */
        this.showCursor = true;

        /** @type {number} Frames rendered counter */
        this.framesRendered = 0;
        /** @type {number} Last FPS measurement time */
        this._fpsTime = 0;
        /** @type {number} Frames in current second */
        this._fpsCount = 0;
        /** @type {number} Current FPS */
        this.fps = 0;

        /** @type {number} Animation frame ID */
        this._rafId = 0;
        /** @type {VideoFrame|null} Latest frame to render */
        this._pendingFrame = null;
        /** @type {boolean} */
        this._renderLoopActive = false;

        /** @type {boolean} Composite all remote displays into one canvas */
        this._mosaicMode = false;
        /**
         * Tiles in compact (no-gap) coordinates. `deskX`/`deskY` is the monitor's
         * physical origin on the peer virtual desktop, needed for input mapping.
         * @type {Array<{idx:number,x:number,y:number,width:number,height:number,deskX:number,deskY:number}>}
         */
        this._mosaicLayout = [];
        /**
         * Last decoded picture per display. Frames are painted here immediately
         * (and closed), so a monitor that is momentarily idle keeps its last
         * picture instead of becoming a black hole in the composite.
         * @type {Map<number, {canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, width: number, height: number}>}
         */
        this._mosaicTiles = new Map();
        /** @type {boolean} Mosaic needs a composite pass (avoid black-clear every RAF) */
        this._mosaicDirty = false;
        /** @type {boolean} Canvas bitmap must be cleared before the next composite */
        this._mosaicNeedsClear = false;
        /** @type {number} Focused display index (input + highlight) */
        this._focusDisplay = 0;
        /** @type {Function|null} (displayIdx:number) => void — mosaic pointer hit another display */
        this.onDisplayHit = null;
        /** @type {Function|null} Called after canvas bitmap resize — throttle keyframe storms */
        this.onResizeRefresh = null;
        /** @type {number} */
        this._resizeRefreshTimer = 0;
    }

    /**
     * Set remote display dimensions and recalculate transform
     * @param {number} width
     * @param {number} height
     */
    setRemoteSize(width, height) {
        if (this.remoteWidth === width && this.remoteHeight === height) return;
        this.remoteWidth = width;
        this.remoteHeight = height;
        this._updateTransform();
    }

    /**
     * Recalculate canvas size (call on window resize or fullscreen toggle)
     */
    resize() {
        const container = this.canvas.parentElement;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.round(rect.width * dpr);
        const height = Math.round(rect.height * dpr);
        if (width <= 0 || height <= 0) return;

        const cssWidth = rect.width + 'px';
        const cssHeight = rect.height + 'px';
        const dimensionsChanged = this.canvas.width !== width
            || this.canvas.height !== height
            || this.canvas.style.width !== cssWidth
            || this.canvas.style.height !== cssHeight;

        // Assigning canvas.width/height clears the bitmap. Mobile browsers
        // emit visualViewport scroll events while a finger moves, so avoid
        // clearing the remote desktop when its actual viewport is unchanged.
        if (!dimensionsChanged) {
            this._updateTransform();
            return;
        }

        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = cssWidth;
        this.canvas.style.height = cssHeight;

        this._updateTransform();
        if (this._mosaicMode) {
            this._mosaicNeedsClear = true;
            this._mosaicDirty = true;
        }

        // Debounce keyframe requests — OS chrome / focus changes often fire
        // several resizes in a row and each refreshVideo flashes the stream.
        if (this.onResizeRefresh) {
            this._scheduleResizeRefresh();
        }
    }

    /**
     * Debounced keyframe request after a canvas bitmap resize.
     * @private
     */
    _scheduleResizeRefresh() {
        const fire = () => {
            this._resizeRefreshTimer = 0;
            if (this.onResizeRefresh) this.onResizeRefresh();
        };
        // Non-browser callers (tests, embedded shells) may lack timers.
        if (typeof setTimeout !== 'function') {
            fire();
            return;
        }
        if (this._resizeRefreshTimer) {
            clearTimeout(this._resizeRefreshTimer);
        }
        this._resizeRefreshTimer = setTimeout(fire, 180);
    }

    /**
     * Set scale mode
     * @param {'fit'|'fill'|'1:1'|'stretch'} mode
     */
    setScaleMode(mode) {
        this.scaleMode = mode;
        this._updateTransform();
    }

    /**
     * Calculate transform based on canvas size, remote size, and scale mode
     */
    _updateTransform() {
        if (!this.remoteWidth || !this.remoteHeight) return;

        const cw = this.canvas.width;
        const ch = this.canvas.height;
        const rw = this.remoteWidth;
        const rh = this.remoteHeight;

        let scale, offsetX, offsetY;

        switch (this.scaleMode) {
        case 'fit': {
            // Fit entire remote display inside canvas, preserving aspect ratio
            scale = Math.min(cw / rw, ch / rh);
            offsetX = (cw - rw * scale) / 2;
            offsetY = (ch - rh * scale) / 2;
            break;
        }
        case 'fill': {
            // Fill canvas, cropping excess, preserving aspect ratio
            scale = Math.max(cw / rw, ch / rh);
            offsetX = (cw - rw * scale) / 2;
            offsetY = (ch - rh * scale) / 2;
            break;
        }
        case '1:1': {
            // Native resolution, centered
            const dpr = window.devicePixelRatio || 1;
            scale = dpr;
            offsetX = (cw - rw * scale) / 2;
            offsetY = (ch - rh * scale) / 2;
            break;
        }
        case 'stretch': {
            // Stretch to fill canvas (ignores aspect ratio)
            // Handled separately in render
            scale = 1;
            offsetX = 0;
            offsetY = 0;
            break;
        }
        default:
            scale = Math.min(cw / rw, ch / rh);
            offsetX = (cw - rw * scale) / 2;
            offsetY = (ch - rh * scale) / 2;
        }

        this.transform = { scale, offsetX, offsetY };
    }

    /**
     * Enable or disable all-monitors mosaic compositing.
     * @param {boolean} enabled
     * @param {Array<{idx:number,x:number,y:number,width:number,height:number,deskX?:number,deskY?:number}>} [layout]
     */
    setMosaicMode(enabled, layout) {
        var wasMosaic = this._mosaicMode;
        this._mosaicMode = !!enabled;
        if (Array.isArray(layout)) {
            var layoutChanged = !this._sameMosaicLayout(layout);
            this._mosaicLayout = layout.map(function (d) {
                return {
                    idx: d.idx | 0,
                    x: d.x || 0,
                    y: d.y || 0,
                    width: d.width || 0,
                    height: d.height || 0,
                    deskX: typeof d.deskX === 'number' ? d.deskX : (d.x || 0),
                    deskY: typeof d.deskY === 'number' ? d.deskY : (d.y || 0)
                };
            });
            // Only the composite is sized from the layout. While disabled the
            // remote size must keep following the single display frame.
            if (this._mosaicMode) this._syncMosaicRemoteSize();
            if (layoutChanged || !wasMosaic) {
                // Tile buffers for displays that left the layout are useless now.
                var keep = new Set(this._mosaicLayout.map(function (d) { return d.idx; }));
                var tiles = this._mosaicTiles;
                tiles.forEach(function (_tile, idx) {
                    if (!keep.has(idx)) tiles.delete(idx);
                });
                this._mosaicNeedsClear = true;
            }
        }
        if (!this._mosaicMode) {
            this._releaseMosaicTiles();
            this._mosaicLayout = [];
            this._mosaicDirty = false;
            this._mosaicNeedsClear = false;
        } else {
            // A frame queued for the single-monitor path would never be
            // consumed while mosaic compositing is active.
            if (!wasMosaic && this._pendingFrame) {
                try { this._pendingFrame.close(); } catch (_) { /* ignore */ }
                this._pendingFrame = null;
            }
            this._mosaicNeedsClear = true;
            this._mosaicDirty = true;
            this._updateTransform();
        }
    }

    /**
     * Compare a candidate layout with the active one.
     * @param {Array<Object>} next
     * @returns {boolean}
     */
    _sameMosaicLayout(next) {
        if (!next || next.length !== this._mosaicLayout.length) return false;
        for (var i = 0; i < next.length; i++) {
            var a = next[i];
            var b = this._mosaicLayout[i];
            if (!b) return false;
            if ((a.idx | 0) !== b.idx
                || (a.x || 0) !== b.x || (a.y || 0) !== b.y
                || (a.width || 0) !== b.width || (a.height || 0) !== b.height) {
                return false;
            }
        }
        return true;
    }

    /**
     * Drop every cached tile picture (leaving mosaic mode).
     */
    _releaseMosaicTiles() {
        var tiles = this._mosaicTiles;
        tiles.forEach(function (tile, idx) {
            try {
                if (tile.canvas) {
                    tile.canvas.width = 0;
                    tile.canvas.height = 0;
                }
            } catch (_) { /* ignore */ }
            tiles.delete(idx);
        });
    }

    /**
     * @param {number} idx
     */
    setFocusDisplay(idx) {
        var next = idx | 0;
        if (next === this._focusDisplay) return;
        this._focusDisplay = next;
        if (this._mosaicMode) this._mosaicDirty = true;
    }

    /**
     * @returns {boolean}
     */
    isMosaicMode() {
        return !!this._mosaicMode;
    }

    _syncMosaicRemoteSize() {
        if (!this._mosaicLayout.length) return;
        var minX = Infinity;
        var minY = Infinity;
        var maxX = -Infinity;
        var maxY = -Infinity;
        this._mosaicLayout.forEach(function (d) {
            var x = d.x || 0;
            var y = d.y || 0;
            var w = d.width || 0;
            var h = d.height || 0;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        });
        if (!isFinite(minX) || !isFinite(minY)) return;
        this._mosaicOriginX = minX;
        this._mosaicOriginY = minY;
        var prevW = this.remoteWidth;
        var prevH = this.remoteHeight;
        this.setRemoteSize(Math.max(1, maxX - minX), Math.max(1, maxY - minY));
        // A different virtual-desktop size invalidates the whole bitmap.
        if (this.remoteWidth !== prevW || this.remoteHeight !== prevH) {
            this._mosaicNeedsClear = true;
            this._mosaicDirty = true;
        }
    }

    /**
     * Paint one decoded frame into its tile buffer.
     *
     * Frames are copied immediately and closed, so the composite never depends
     * on a frame being kept alive (holding `VideoFrame`s starved the GPU and
     * left black holes when a monitor went idle).
     *
     * @param {number} displayIdx
     * @param {VideoFrame|Object} frame
     */
    pushMosaicFrame(displayIdx, frame) {
        var idx = displayIdx | 0;
        var src = frame && frame._source ? frame._source : frame;
        var w = (frame && frame.displayWidth) || (src && src.width) || 0;
        var h = (frame && frame.displayHeight) || (src && src.height) || 0;
        try {
            if (!src || !w || !h) return;
            var tile = this._mosaicTiles.get(idx);
            if (!tile) {
                var canvas = document.createElement('canvas');
                var ctx = canvas.getContext('2d');
                if (!ctx) return;
                tile = { canvas: canvas, ctx: ctx, width: 0, height: 0 };
                this._mosaicTiles.set(idx, tile);
            }
            if (tile.canvas.width !== w || tile.canvas.height !== h) {
                tile.canvas.width = w;
                tile.canvas.height = h;
            }
            tile.width = w;
            tile.height = h;
            tile.ctx.drawImage(src, 0, 0, w, h);
            this._mosaicDirty = true;
        } catch (_) {
            /* frame may be closed or tile buffer unavailable */
        } finally {
            if (frame && typeof frame.close === 'function' && !frame._source) {
                try { frame.close(); } catch (_) { /* ignore */ }
            }
        }
    }

    /**
     * Convert canvas coordinates to remote display coordinates
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {{ x: number, y: number, displayIdx?: number }|null}
     */
    canvasToRemote(canvasX, canvasY) {
        const dpr = window.devicePixelRatio || 1;
        const px = canvasX * dpr;
        const py = canvasY * dpr;

        if (this._mosaicMode && this._mosaicLayout.length) {
            return this._canvasToRemoteMosaic(px, py);
        }

        if (this.scaleMode === 'stretch') {
            return {
                x: Math.round(px / this.canvas.width * this.remoteWidth),
                y: Math.round(py / this.canvas.height * this.remoteHeight)
            };
        }

        const { scale, offsetX, offsetY } = this.transform;
        return {
            x: Math.round((px - offsetX) / scale),
            y: Math.round((py - offsetY) / scale)
        };
    }

    /**
     * Map canvas pixels onto a mosaic tile.
     *
     * The composite uses compact (gap-free) tile coordinates, but the peer
     * injects absolute virtual-desktop coordinates, so the hit-test result is
     * translated back to the monitor's physical origin (`deskX`/`deskY`).
     *
     * @param {number} px device pixels
     * @param {number} py device pixels
     * @returns {{ x: number, y: number, displayIdx: number }|null}
     */
    _canvasToRemoteMosaic(px, py) {
        const { scale, offsetX, offsetY } = this.transform;
        if (!scale) return null;
        const tileX = (px - offsetX) / scale + (this._mosaicOriginX || 0);
        const tileY = (py - offsetY) / scale + (this._mosaicOriginY || 0);

        for (var i = 0; i < this._mosaicLayout.length; i++) {
            var d = this._mosaicLayout[i];
            var x = d.x || 0;
            var y = d.y || 0;
            var w = d.width || 0;
            var h = d.height || 0;
            if (tileX >= x && tileX < x + w && tileY >= y && tileY < y + h) {
                var localX = Math.round(tileX - x);
                var localY = Math.round(tileY - y);
                if (d.idx !== this._focusDisplay && typeof this.onDisplayHit === 'function') {
                    try { this.onDisplayHit(d.idx); } catch (_) { /* ignore */ }
                }
                return {
                    x: Math.round((d.deskX || 0) + localX),
                    y: Math.round((d.deskY || 0) + localY),
                    displayIdx: d.idx
                };
            }
        }
        return null;
    }

    /**
     * Start the render loop
     */
    startRenderLoop() {
        if (this._renderLoopActive) return;
        this._renderLoopActive = true;
        this._fpsTime = performance.now();
        this._renderTick();
    }

    /**
     * Stop the render loop
     */
    stopRenderLoop() {
        this._renderLoopActive = false;
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = 0;
        }
    }

    /**
     * Queue a VideoFrame for rendering
     * @param {VideoFrame} frame
     */
    pushFrame(frame) {
        // Close previous pending frame if not yet rendered
        if (this._pendingFrame) {
            this._pendingFrame.close();
        }
        this._pendingFrame = frame;
    }

    /**
     * Internal render tick
     */
    _renderTick() {
        if (!this._renderLoopActive) return;

        if (this._mosaicMode) {
            // Composite only when something changed. The composite is rebuilt
            // from cached tile pictures, so it never needs a pending frame to
            // avoid black holes; the canvas is cleared only on layout/size
            // changes instead of on every frame.
            if (this._mosaicDirty) {
                this._fpsCount++;
                this._renderMosaic();
                this._mosaicDirty = false;
            }
        } else if (this._pendingFrame) {
            // Count FPS only for genuinely new frames from the peer
            if (this._pendingFrame._isNew) {
                this._fpsCount++;
            }
            this._renderFrame(this._pendingFrame);
            this._pendingFrame = null;
        }

        // FPS calculation (actual new video frames per second from peer)
        const now = performance.now();
        if (now - this._fpsTime >= 1000) {
            this.fps = this._fpsCount;
            this._fpsCount = 0;
            this._fpsTime = now;
        }

        this._rafId = requestAnimationFrame(() => this._renderTick());
    }

    /**
     * Composite every cached tile picture into the virtual desktop layout.
     */
    _renderMosaic() {
        this._syncMosaicRemoteSize();
        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        // Clearing the whole bitmap is only required when the layout or the
        // canvas size changed; doing it per frame is what made idle monitors
        // flicker black.
        if (this._mosaicNeedsClear) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, cw, ch);
            this._mosaicNeedsClear = false;
        }

        const { scale, offsetX, offsetY } = this.transform;
        const originX = this._mosaicOriginX || 0;
        const originY = this._mosaicOriginY || 0;
        const self = this;

        this._mosaicLayout.forEach(function (d) {
            var tile = self._mosaicTiles.get(d.idx);
            if (!tile) return;
            var dx = offsetX + ((d.x || 0) - originX) * scale;
            var dy = offsetY + ((d.y || 0) - originY) * scale;
            var dw = (d.width || tile.width || 0) * scale;
            var dh = (d.height || tile.height || 0) * scale;
            try {
                ctx.drawImage(tile.canvas, dx, dy, dw, dh);
            } catch (_) { /* tile buffer unavailable */ }

            if (d.idx === self._focusDisplay) {
                ctx.strokeStyle = 'rgba(88, 166, 255, 0.9)';
                ctx.lineWidth = Math.max(2, 2 * (window.devicePixelRatio || 1));
                ctx.strokeRect(dx, dy, dw, dh);
            }
        });

        this.framesRendered++;
        if (this.showCursor && this.cursorImage) {
            this._drawCursor(ctx);
        }
    }

    /**
     * Render a single video frame to canvas
     * @param {VideoFrame|Object} frame - VideoFrame or fallback proxy with _source
     */
    _renderFrame(frame) {
        // Update remote dimensions from frame
        this.setRemoteSize(frame.displayWidth, frame.displayHeight);

        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        // Use _source (ImageBitmap) for fallback frames, otherwise frame itself (VideoFrame)
        const drawSource = frame._source || frame;

        // Clear canvas
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cw, ch);

        if (this.scaleMode === 'stretch') {
            ctx.drawImage(drawSource, 0, 0, cw, ch);
        } else {
            const { scale, offsetX, offsetY } = this.transform;
            ctx.drawImage(drawSource, offsetX, offsetY,
                this.remoteWidth * scale, this.remoteHeight * scale);
        }

        frame.close();
        this.framesRendered++;

        // Draw cursor overlay
        if (this.showCursor && this.cursorImage) {
            this._drawCursor(ctx);
        }
    }

    /**
     * Update cursor image from CursorData message
     * @param {Object} cursorData - { data: Uint8Array, hotx: number, hoty: number, width: number, height: number, id: number }
     */
    async updateCursor(cursorData) {
        try {
            // Proto field is 'colors' (RGBA pixel data), support both for compatibility
            const pixelData = cursorData.colors || cursorData.data;
            if (!pixelData || !cursorData.width || !cursorData.height) return;

            const w = cursorData.width;
            const h = cursorData.height;
            const expectedLen = w * h * 4;

            // Normalize protobuf bytes to Uint8Array
            let bytes = (pixelData instanceof Uint8Array)
                ? pixelData
                : new Uint8Array(pixelData);

            // Skip zstd-compressed cursor data (magic: 28 b5 2f fd)
            if (bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5
                && bytes[2] === 0x2f && bytes[3] === 0xfd) {
                return;
            }

            // Validate RGBA buffer size — must be exactly width * height * 4
            if (bytes.length < expectedLen) {
                return;
            }
            if (bytes.length > expectedLen) {
                bytes = bytes.subarray(0, expectedLen);
            }

            this.cursorHotspot.x = cursorData.hotx || 0;
            this.cursorHotspot.y = cursorData.hoty || 0;

            // Create ImageData from RGBA bytes (copy to avoid protobuf buffer issues)
            const imgData = new ImageData(
                new Uint8ClampedArray(bytes),
                w,
                h
            );

            // Convert to ImageBitmap for efficient drawing
            if (this.cursorImage) {
                this.cursorImage.close();
            }
            this.cursorImage = await createImageBitmap(imgData);

            // Signal that we have a valid remote cursor (CSS hides local cursor)
            if (this.onCursorReady) {
                this.onCursorReady(true);
            }
        } catch (err) {
            // Silently skip invalid cursor data to prevent crash
        }
    }

    /**
     * Update cursor position from CursorPosition message
     * @param {Object} pos - { x: number, y: number }
     */
    updateCursorPosition(pos) {
        this.cursorPos.x = pos.x || 0;
        this.cursorPos.y = pos.y || 0;
        if (this._mosaicMode && this.showCursor) this._mosaicDirty = true;
    }

    /**
     * Draw cursor on canvas
     * @param {CanvasRenderingContext2D} ctx
     */
    _drawCursor(ctx) {
        const { scale, offsetX, offsetY } = this.transform;

        var baseX = 0;
        var baseY = 0;
        if (this._mosaicMode && this._mosaicLayout.length) {
            // Cursor position arrives in absolute virtual-desktop coordinates;
            // the composite lays tiles out compacted, so translate into the
            // tile that actually contains the pointer.
            var hit = this._mosaicTileAt(this.cursorPos.x, this.cursorPos.y);
            if (!hit) return;
            baseX = (hit.x || 0) - (this._mosaicOriginX || 0) - (hit.deskX || 0);
            baseY = (hit.y || 0) - (this._mosaicOriginY || 0) - (hit.deskY || 0);
        }

        const cx = offsetX + (this.cursorPos.x + baseX - this.cursorHotspot.x) * scale;
        const cy = offsetY + (this.cursorPos.y + baseY - this.cursorHotspot.y) * scale;
        const cw = this.cursorImage.width * scale;
        const ch = this.cursorImage.height * scale;

        ctx.drawImage(this.cursorImage, cx, cy, cw, ch);
    }

    /**
     * Find the mosaic tile containing a point given in desktop coordinates.
     * @param {number} deskX
     * @param {number} deskY
     * @returns {Object|null}
     */
    _mosaicTileAt(deskX, deskY) {
        var x = deskX || 0;
        var y = deskY || 0;
        for (var i = 0; i < this._mosaicLayout.length; i++) {
            var d = this._mosaicLayout[i];
            var ox = d.deskX || 0;
            var oy = d.deskY || 0;
            if (x >= ox && x < ox + (d.width || 0) && y >= oy && y < oy + (d.height || 0)) {
                return d;
            }
        }
        return null;
    }

    /**
     * Get renderer statistics
     */
    getStats() {
        return {
            fps: this.fps,
            framesRendered: this.framesRendered,
            remoteWidth: this.remoteWidth,
            remoteHeight: this.remoteHeight,
            canvasWidth: this.canvas.width,
            canvasHeight: this.canvas.height,
            scaleMode: this.scaleMode,
            scale: this.transform.scale
        };
    }

    /**
     * Close and release resources
     */
    close() {
        this.stopRenderLoop();
        if (this._pendingFrame) {
            this._pendingFrame.close();
            this._pendingFrame = null;
        }
        this._mosaicMode = false;
        this._releaseMosaicTiles();
        if (this.cursorImage) {
            this.cursorImage.close();
            this.cursorImage = null;
        }
    }
}

window.RDRenderer = RDRenderer;
