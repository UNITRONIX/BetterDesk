/**
 * Geometry shared by the two node editors (the flow builder and the fleet
 * workflow canvas): the view (pan and zoom), points between the screen and
 * the canvas, wire curves, snapping, and fitting nodes into the view.
 * No DOM; NodeCanvas.svelte and the pages use these.
 */

/** Pan (in screen pixels) and zoom of a canvas */
export interface View {
	x: number;
	y: number;
	zoom: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

/** A point on the screen (relative to the canvas box) as canvas coordinates */
export function toCanvas(view: View, screenX: number, screenY: number): Point {
	return { x: (screenX - view.x) / view.zoom, y: (screenY - view.y) / view.zoom };
}

/** The SVG transform that draws the canvas at this view */
export function viewTransform(view: View): string {
	return `translate(${view.x}, ${view.y}) scale(${view.zoom})`;
}

/**
 * Zoom to `zoom` (clamped). With a point (relative to the canvas box) the
 * canvas stays fixed under it, as with the mouse wheel; without one the
 * zoom happens around the top-start corner, as the old toolbar buttons did.
 */
export function zoomTo(view: View, zoom: number, min: number, max: number, at?: Point): View {
	const next = clamp(zoom, min, max);
	if (!at) return { ...view, zoom: next };
	return {
		x: at.x - (at.x - view.x) * (next / view.zoom),
		y: at.y - (at.y - view.y) * (next / view.zoom),
		zoom: next
	};
}

/** The box around every node, or null without nodes */
export function bounds(nodes: readonly Point[], w: number, h: number): Box | null {
	if (!nodes.length) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x + w);
		maxY = Math.max(maxY, n.y + h);
	}
	return { minX, minY, maxX, maxY };
}

/**
 * The view that shows every node with `pad` canvas pixels around them,
 * centred, zoomed no further than [min, max]. When the nodes don't fit at
 * the smallest zoom, the view starts at their top-left corner, where a flow
 * begins. Null without nodes or size.
 */
export function fitView(
	nodes: readonly Point[],
	w: number,
	h: number,
	size: { width: number; height: number },
	opts: { pad: number; min: number; max: number }
): View | null {
	const box = bounds(nodes, w, h);
	if (!box || !(size.width > 0) || !(size.height > 0)) return null;
	const sw = box.maxX - box.minX + opts.pad * 2;
	const sh = box.maxY - box.minY + opts.pad * 2;
	const zoom = clamp(Math.min(size.width / sw, size.height / sh), opts.min, opts.max);
	const start = (space: number, used: number, min: number) =>
		used > space ? -(min - opts.pad) * zoom : (space - used) / 2 - (min - opts.pad) * zoom;
	return { x: start(size.width, sw * zoom, box.minX), y: start(size.height, sh * zoom, box.minY), zoom };
}

/** The canvas point in the middle of the visible area */
export function viewCentre(view: View, size: { width: number; height: number }): Point {
	return toCanvas(view, size.width / 2, size.height / 2);
}

/**
 * A wire from an output to an input as a cubic curve that leaves and enters
 * horizontally; `bend` is the share of the horizontal distance the control
 * points reach out (0.5 in the flow builder, 0.4 in fleet workflows).
 */
export function wirePath(from: Point, to: Point, bend: number): string {
	const dx = Math.abs(to.x - from.x) * bend;
	return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

export function snap(v: number, grid: number): number {
	return Math.round(v / grid) * grid;
}

/**
 * The pan that brings a node fully into view (with a margin), or the same
 * view when it is visible already. Used when the keyboard focus moves to a
 * node outside the visible part of the canvas.
 */
export function revealNode(
	view: View,
	node: Point,
	w: number,
	h: number,
	size: { width: number; height: number },
	margin = 24
): View {
	const left = node.x * view.zoom + view.x;
	const top = node.y * view.zoom + view.y;
	const right = left + w * view.zoom;
	const bottom = top + h * view.zoom;
	let { x, y } = view;
	if (left < margin) x += margin - left;
	else if (right > size.width - margin) x -= right - (size.width - margin);
	if (top < margin) y += margin - top;
	else if (bottom > size.height - margin) y -= bottom - (size.height - margin);
	return x === view.x && y === view.y ? view : { ...view, x, y };
}
