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
        /** @type {Array<{idx:number,x:number,y:number,width:number,height:number}>} */
        this._mosaicLayout = [];
        /** @type {Map<number, VideoFrame|Object>} */
        this._mosaicPending = new Map();
        /** @type {number} Focused display index (input + highlight) */
        this._focusDisplay = 0;
        /** @type {Function|null} (displayIdx:number) => void — mosaic click hit another display */
        this.onDisplayHit = null;
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

        // Request a keyframe after resize to avoid blurry/corrupted frames
        if (this.onResizeRefresh) {
            this.onResizeRefresh();
        }
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
     * @param {Array<{idx:number,x:number,y:number,width:number,height:number}>} [layout]
     */
    setMosaicMode(enabled, layout) {
        this._mosaicMode = !!enabled;
        if (Array.isArray(layout)) {
            this._mosaicLayout = layout.slice();
            this._syncMosaicRemoteSize();
        }
        if (!this._mosaicMode) {
            this._mosaicPending.forEach(function (frame) {
                try { frame.close(); } catch (_) { /* ignore */ }
            });
            this._mosaicPending.clear();
        } else {
            this._updateTransform();
        }
    }

    /**
     * @param {number} idx
     */
    setFocusDisplay(idx) {
        this._focusDisplay = idx | 0;
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
        this.setRemoteSize(Math.max(1, maxX - minX), Math.max(1, maxY - minY));
    }

    /**
     * Queue a frame for one display in mosaic mode.
     * @param {number} displayIdx
     * @param {VideoFrame|Object} frame
     */
    pushMosaicFrame(displayIdx, frame) {
        var idx = displayIdx | 0;
        var prev = this._mosaicPending.get(idx);
        if (prev) {
            try { prev.close(); } catch (_) { /* ignore */ }
        }
        this._mosaicPending.set(idx, frame);
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
     * @param {number} px device pixels
     * @param {number} py device pixels
     * @returns {{ x: number, y: number, displayIdx: number }|null}
     */
    _canvasToRemoteMosaic(px, py) {
        const { scale, offsetX, offsetY } = this.transform;
        if (!scale) return null;
        const deskX = (px - offsetX) / scale + (this._mosaicOriginX || 0);
        const deskY = (py - offsetY) / scale + (this._mosaicOriginY || 0);

        for (var i = 0; i < this._mosaicLayout.length; i++) {
            var d = this._mosaicLayout[i];
            var x = d.x || 0;
            var y = d.y || 0;
            var w = d.width || 0;
            var h = d.height || 0;
            if (deskX >= x && deskX < x + w && deskY >= y && deskY < y + h) {
                var localX = Math.round(deskX - x);
                var localY = Math.round(deskY - y);
                if (d.idx !== this._focusDisplay && typeof this.onDisplayHit === 'function') {
                    try { this.onDisplayHit(d.idx); } catch (_) { /* ignore */ }
                }
                return { x: localX, y: localY, displayIdx: d.idx };
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
            if (this._mosaicPending.size > 0) {
                this._fpsCount++;
                this._renderMosaic();
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
     * Composite every pending display frame into the virtual desktop layout.
     */
    _renderMosaic() {
        this._syncMosaicRemoteSize();
        const ctx = this.ctx;
        const cw = this.canvas.width;
        const ch = this.canvas.height;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cw, ch);

        const { scale, offsetX, offsetY } = this.transform;
        const originX = this._mosaicOriginX || 0;
        const originY = this._mosaicOriginY || 0;
        const self = this;

        this._mosaicLayout.forEach(function (d) {
            var frame = self._mosaicPending.get(d.idx);
            if (!frame) return;
            var drawSource = frame._source || frame;
            var dx = offsetX + ((d.x || 0) - originX) * scale;
            var dy = offsetY + ((d.y || 0) - originY) * scale;
            var dw = (d.width || frame.displayWidth || 0) * scale;
            var dh = (d.height || frame.displayHeight || 0) * scale;
            try {
                ctx.drawImage(drawSource, dx, dy, dw, dh);
            } catch (_) { /* frame may be closed */ }

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
    }

    /**
     * Draw cursor on canvas
     * @param {CanvasRenderingContext2D} ctx
     */
    _drawCursor(ctx) {
        const { scale, offsetX, offsetY } = this.transform;

        const cx = offsetX + (this.cursorPos.x - this.cursorHotspot.x) * scale;
        const cy = offsetY + (this.cursorPos.y - this.cursorHotspot.y) * scale;
        const cw = this.cursorImage.width * scale;
        const ch = this.cursorImage.height * scale;

        ctx.drawImage(this.cursorImage, cx, cy, cw, ch);
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
        if (this.cursorImage) {
            this.cursorImage.close();
            this.cursorImage = null;
        }
    }
}

window.RDRenderer = RDRenderer;
