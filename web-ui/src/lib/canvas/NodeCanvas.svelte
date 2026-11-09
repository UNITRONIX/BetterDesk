<!--
  The canvas of a node editor (the flow builder and fleet workflows): nodes
  drawn as SVG groups, wires between their ports as curves, pan and zoom,
  an optional dot grid. The page owns the document and changes it in the
  callbacks; this component draws it and turns pointer and keys into
  intentions.

  Pointer (mouse, pen and touch): drag a node to move it; drag from a port
  to another port to connect them; drag the empty canvas (or with the
  middle button anywhere) to pan; the wheel zooms; a click on a wire
  selects it, a click on the empty canvas clears the selection. Nodes and
  palette entries dropped on the canvas arrive in `ondrop`.

  Keyboard: every node is a button in the tab order (its SVG title, the
  name and kind in full, is its name and its tooltip); Enter or Space selects it, the arrow keys move it, focus pans
  the view to show it. Connecting and removing wires without a pointer
  happens in the page's settings panel.

  The drawing runs left to right in every language (outputs on the right
  edge, inputs on the left), so text in a node starts at its left edge.
  `children` are overlays inside the canvas box (empty state, zoom
  controls, minimap).
-->
<script module lang="ts">
	export interface CanvasNode {
		id: string;
		x: number;
		y: number;
	}

	export interface CanvasPort {
		name: string;
		dir: 'in' | 'out';
		/** Position relative to the node */
		x: number;
		y: number;
	}

	export interface CanvasWire {
		key: string;
		from: string;
		fromPort: string;
		to: string;
		toPort: string;
	}

	export interface PortRef {
		node: string;
		port: string;
		dir: 'in' | 'out';
	}
</script>

<script lang="ts" generics="N extends CanvasNode">
	import type { Snippet } from 'svelte';
	import {
		fitView,
		revealNode,
		snap,
		toCanvas,
		viewCentre,
		viewTransform,
		wirePath,
		zoomTo,
		type Point,
		type View
	} from './geometry.ts';

	interface Props {
		nodes: N[];
		wires: CanvasWire[];
		nodeW: number;
		nodeH: number;
		ports: (node: N) => CanvasPort[];
		/** Where a wire meets a node, canvas coordinates */
		wireEnd: (node: N, port: string) => Point;
		view: View;
		minZoom: number;
		maxZoom: number;
		/** The zoom after one wheel step */
		wheelZoom: (zoom: number, deltaY: number) => number;
		/** The wheel zooms around the pointer (else around the top-start corner) */
		wheelAtPointer?: boolean;
		/** Dot grid spacing; 0 for none */
		grid?: number;
		showGrid?: boolean;
		/** Dragged nodes snap to this grid */
		snapTo?: number | null;
		/** Arrow keys move a node this far */
		keyStep?: number;
		/** Wire curve bend (share of the horizontal distance) */
		bend: number;
		arrow?: boolean;
		selectedNode?: string | null;
		selectedWire?: string | null;
		/** Accessible name of the canvas */
		label: string;
		/** Accessible name of a node: its name and kind */
		nodeName: (node: N) => string;
		nodeClass?: (node: N) => string;
		node: Snippet<[N]>;
		/** Palette entries that may be dropped */
		accepts?: (type: string) => boolean;
		ondrop?: (type: string, at: Point) => void;
		onconnect?: (a: PortRef, b: PortRef) => void;
		/** A node starts moving (once per drag or arrow key) */
		onmovestart?: (id: string) => void;
		onmove?: (id: string, x: number, y: number) => void;
		onmoveend?: (id: string) => void;
		onwiredblclick?: (key: string) => void;
		class?: string;
		children?: Snippet;
	}

	let {
		nodes,
		wires,
		nodeW,
		nodeH,
		ports,
		wireEnd,
		view = $bindable(),
		minZoom,
		maxZoom,
		wheelZoom,
		wheelAtPointer = false,
		grid = 0,
		showGrid = true,
		snapTo = null,
		keyStep = 10,
		bend,
		arrow = false,
		selectedNode = $bindable(null),
		selectedWire = $bindable(null),
		label,
		nodeName,
		nodeClass,
		node,
		accepts = () => false,
		ondrop,
		onconnect,
		onmovestart,
		onmove,
		onmoveend,
		onwiredblclick,
		class: cls = '',
		children
	}: Props = $props();

	const uid = $props.id();
	const gridId = `${uid}-grid`;
	const arrowId = `${uid}-arrow`;

	let wrap = $state<HTMLDivElement | null>(null);
	let svg = $state<SVGSVGElement | null>(null);
	let width = $state(0);
	let height = $state(0);

	type Drag =
		| { kind: 'pan'; startX: number; startY: number; viewX: number; viewY: number }
		| { kind: 'node'; id: string; offX: number; offY: number; moved: boolean }
		| { kind: 'wire'; from: PortRef; start: Point; end: Point };
	let drag = $state<Drag | null>(null);

	const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
	const transform = $derived(viewTransform(view));
	const paths = $derived(
		wires.flatMap((w) => {
			const a = byId.get(w.from);
			const b = byId.get(w.to);
			if (!a || !b) return [];
			return [{ key: w.key, d: wirePath(wireEnd(a, w.fromPort), wireEnd(b, w.toPort), bend) }];
		})
	);

	/* ── Pointer ── */

	function local(e: { clientX: number; clientY: number }): Point {
		const rect = wrap?.getBoundingClientRect();
		return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
	}

	function canvasPoint(e: { clientX: number; clientY: number }): Point {
		const p = local(e);
		return toCanvas(view, p.x, p.y);
	}

	function portRef(el: Element | null): PortRef | null {
		const port = el?.closest('[data-port]');
		if (!port) return null;
		const nodeId = port.getAttribute('data-node');
		const name = port.getAttribute('data-port');
		const dir = port.getAttribute('data-dir');
		if (!nodeId || !name || (dir !== 'in' && dir !== 'out')) return null;
		return { node: nodeId, port: name, dir };
	}

	function onpointerdown(e: PointerEvent) {
		if (drag || !svg) return;
		const target = e.target instanceof Element ? e.target : null;
		const ref = e.button === 0 ? portRef(target) : null;
		if (ref) {
			const n = byId.get(ref.node);
			if (!n) return;
			e.preventDefault();
			const start = ref.dir === 'in' ? wireEnd(n, 'in') : wireEnd(n, ref.port);
			drag = { kind: 'wire', from: ref, start, end: start };
			svg.setPointerCapture(e.pointerId);
			return;
		}
		const nodeEl = e.button === 0 ? target?.closest('[data-node-id]') : null;
		const n = nodeEl ? byId.get(nodeEl.getAttribute('data-node-id') ?? '') : undefined;
		if (n) {
			selectedNode = n.id;
			selectedWire = null;
			const p = canvasPoint(e);
			drag = { kind: 'node', id: n.id, offX: p.x - n.x, offY: p.y - n.y, moved: false };
			svg.setPointerCapture(e.pointerId);
			return;
		}
		const wireEl = e.button === 0 ? target?.closest('[data-wire]') : null;
		if (wireEl) {
			e.preventDefault();
			selectedWire = wireEl.getAttribute('data-wire');
			selectedNode = null;
			return;
		}
		if (e.button !== 0 && e.button !== 1) return;
		e.preventDefault();
		if (e.button === 0) {
			selectedNode = null;
			selectedWire = null;
		}
		drag = { kind: 'pan', startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
		svg.setPointerCapture(e.pointerId);
	}

	function onpointermove(e: PointerEvent) {
		const d = drag;
		if (!d) return;
		if (d.kind === 'pan') {
			view = { ...view, x: d.viewX + e.clientX - d.startX, y: d.viewY + e.clientY - d.startY };
		} else if (d.kind === 'node') {
			const n = byId.get(d.id);
			if (!n) return;
			const p = canvasPoint(e);
			let x = Math.round(p.x - d.offX);
			let y = Math.round(p.y - d.offY);
			if (snapTo) {
				x = snap(x, snapTo);
				y = snap(y, snapTo);
			}
			if (x === n.x && y === n.y) return;
			if (!d.moved) {
				d.moved = true;
				onmovestart?.(d.id);
			}
			onmove?.(d.id, x, y);
		} else {
			drag = { ...d, end: canvasPoint(e) };
		}
	}

	function onpointerup(e: PointerEvent) {
		const d = drag;
		if (!d) return;
		drag = null;
		if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
		if (d.kind === 'node' && d.moved) onmoveend?.(d.id);
		if (d.kind === 'wire') {
			const to = portRef(document.elementFromPoint(e.clientX, e.clientY));
			if (to) onconnect?.(d.from, to);
		}
	}

	function onpointercancel() {
		const d = drag;
		drag = null;
		if (d?.kind === 'node' && d.moved) onmoveend?.(d.id);
	}

	function ondblclick(e: MouseEvent) {
		const wireEl = e.target instanceof Element ? e.target.closest('[data-wire]') : null;
		const key = wireEl?.getAttribute('data-wire');
		if (key) onwiredblclick?.(key);
	}

	// The wheel zooms; the listener can't be passive, it keeps the page from scrolling
	$effect(() => {
		const el = wrap;
		if (!el) return;
		const onwheel = (e: WheelEvent) => {
			e.preventDefault();
			const zoom = wheelZoom(view.zoom, e.deltaY);
			view = zoomTo(view, zoom, minZoom, maxZoom, wheelAtPointer ? local(e) : undefined);
		};
		el.addEventListener('wheel', onwheel, { passive: false });
		return () => el.removeEventListener('wheel', onwheel);
	});

	/* ── Palette drops ── */

	function ondragover(e: DragEvent) {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}

	function ondropped(e: DragEvent) {
		e.preventDefault();
		const type = e.dataTransfer?.getData('text/plain') ?? '';
		if (accepts(type)) ondrop?.(type, canvasPoint(e));
	}

	/* ── Keys on a node ── */

	const ARROWS: Record<string, [number, number]> = {
		ArrowLeft: [-1, 0],
		ArrowRight: [1, 0],
		ArrowUp: [0, -1],
		ArrowDown: [0, 1]
	};

	function onnodekey(e: KeyboardEvent, n: N) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			selectedNode = n.id;
			selectedWire = null;
			return;
		}
		const dir = ARROWS[e.key];
		if (!dir || e.ctrlKey || e.metaKey || e.altKey) return;
		e.preventDefault();
		selectedNode = n.id;
		selectedWire = null;
		onmovestart?.(n.id);
		onmove?.(n.id, n.x + dir[0] * keyStep, n.y + dir[1] * keyStep);
		onmoveend?.(n.id);
		view = revealNode(view, { x: n.x + dir[0] * keyStep, y: n.y + dir[1] * keyStep }, nodeW, nodeH, {
			width,
			height
		});
	}

	function onnodefocus(n: N) {
		if (width && height) view = revealNode(view, n, nodeW, nodeH, { width, height });
	}

	/* ── For the page ── */

	/** The canvas point in the middle of what is visible */
	export function centre(): Point {
		return viewCentre(view, { width, height });
	}

	/** Show every node, `pad` canvas pixels around them */
	export function fit(opts: { pad: number; min: number; max: number }): void {
		const next = fitView(nodes, nodeW, nodeH, { width, height }, opts);
		if (next) view = next;
	}

	/** Move keyboard focus to a node */
	export function focusNode(id: string): void {
		const el = Array.from(svg?.querySelectorAll<SVGGElement>('[data-node-id]') ?? []).find(
			(g) => g.getAttribute('data-node-id') === id
		);
		el?.focus();
	}
</script>

<div
	bind:this={wrap}
	bind:clientWidth={width}
	bind:clientHeight={height}
	class={['canvas-wrap', cls]}
	role="presentation"
	{ondragover}
	ondrop={ondropped}
>
	<svg
		bind:this={svg}
		class={['canvas-svg', drag?.kind === 'pan' && 'is-panning']}
		role="group"
		aria-label={label}
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		{onpointercancel}
		{ondblclick}
	>
		<defs>
			{#if grid}
				<pattern
					id={gridId}
					width={grid}
					height={grid}
					patternUnits="userSpaceOnUse"
					patternTransform={transform}
				>
					<circle cx="1" cy="1" r="1" class="grid-dot" />
				</pattern>
			{/if}
			{#if arrow}
				<marker id={arrowId} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
					<polygon points="0 0, 8 3, 0 6" class="wire-arrow" />
				</marker>
			{/if}
		</defs>
		{#if grid && showGrid}
			<rect width="100%" height="100%" fill={`url(#${gridId})`} class="grid-rect" />
		{/if}
		<g {transform}>
			<g class="wires">
				{#each paths as w (w.key)}
					<g data-wire={w.key} class={['wire-group', selectedWire === w.key && 'selected']}>
						<path class="wire-hit" d={w.d} />
						<path class="wire" d={w.d} marker-end={arrow ? `url(#${arrowId})` : undefined} />
					</g>
				{/each}
			</g>
			<g class="nodes">
				{#each nodes as n (n.id)}
					<g
						class={['node', nodeClass?.(n), selectedNode === n.id && 'selected']}
						data-node-id={n.id}
						transform={`translate(${n.x}, ${n.y})`}
						role="button"
						tabindex="0"
						aria-pressed={selectedNode === n.id}
						onkeydown={(e) => onnodekey(e, n)}
						onfocus={() => onnodefocus(n)}
					>
						<title>{nodeName(n)}</title>
						<rect class="node-focus" x="-4" y="-4" width={nodeW + 8} height={nodeH + 8} rx="6" />
						{@render node(n)}
						{#each ports(n) as p, i (i)}
							<circle
								class={['port', `port-${p.dir}`]}
								cx={p.x}
								cy={p.y}
								r="6"
								data-node={n.id}
								data-port={p.name}
								data-dir={p.dir}
							/>
						{/each}
					</g>
				{/each}
			</g>
			{#if drag?.kind === 'wire'}
				<line class="temp-wire" x1={drag.start.x} y1={drag.start.y} x2={drag.end.x} y2={drag.end.y} />
			{/if}
		</g>
	</svg>
	{@render children?.()}
</div>

<style>
	.canvas-wrap {
		position: relative;
		min-width: 0;
		overflow: hidden;
		background: var(--bg-subtle);
	}
	.canvas-svg {
		display: block;
		width: 100%;
		height: 100%;
		direction: ltr;
		user-select: none;
		touch-action: none;
	}
	.canvas-svg.is-panning {
		cursor: grabbing;
	}
	.grid-dot {
		fill: var(--border);
		opacity: 0.6;
	}
	.node {
		cursor: move;
		outline: none;
	}
	.node-focus {
		fill: none;
		stroke: transparent;
		stroke-width: 2;
	}
	.node:focus-visible .node-focus {
		stroke: var(--focus);
	}
	.port {
		fill: var(--bg-float);
		stroke: var(--text-muted);
		stroke-width: 1.5;
		cursor: crosshair;
	}
	.port:hover {
		fill: var(--accent);
		stroke: var(--accent);
	}
	.wire {
		fill: none;
		stroke: var(--text-muted);
		stroke-width: 2;
		pointer-events: none;
	}
	/* A wider invisible line takes the clicks, so a 2 px wire is easy to hit */
	.wire-hit {
		fill: none;
		stroke: transparent;
		stroke-width: 12;
		cursor: pointer;
	}
	.wire-group:hover .wire {
		stroke: var(--text);
	}
	.wire-group.selected .wire {
		stroke: var(--accent);
		stroke-width: 3;
	}
	.wire-arrow {
		fill: var(--text-muted);
	}
	.temp-wire {
		stroke: var(--accent);
		stroke-width: 2;
		stroke-dasharray: 6 4;
		pointer-events: none;
	}
	@media (forced-colors: active) {
		.wire,
		.port {
			stroke: CanvasText;
		}
		.node:focus-visible .node-focus,
		.wire-group.selected .wire {
			stroke: Highlight;
		}
	}
</style>
