<!--
  How a RustDesk connection travels through this server (chart.css
  "Diagrams", ui-diagram.js). Four boxes: your computer, the ID server, the
  relay server, the remote device. The ID server introduces the two sides;
  they then connect directly when the network allows it, otherwise through
  the relay. With mode 'relay-only' the direct path is drawn dashed and
  marked off. The same steps are written below the drawing as a numbered
  list, so the picture is never the only way to read it. Wide containers
  get a left to right layout, narrow ones a top to bottom layout.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';

	interface Props {
		idServer?: string;
		/** Relay host; the ID server's host when empty */
		relay?: string;
		idPort?: number;
		relayPort?: number;
		mode?: 'direct-first' | 'relay-only';
	}

	let {
		idServer = '',
		relay = '',
		idPort = 21116,
		relayPort = 21117,
		mode = 'direct-first'
	}: Props = $props();

	const uid = $props.id();
	const capId = `${uid}-cap`;
	const arrowId = `${uid}-arrow`;
	const arrowStartId = `${uid}-arrow-start`;

	// Box subtitles in 12px: about 6.6px per character
	const SUB_CHAR = 6.6;

	let holder = $state<HTMLDivElement | null>(null);
	let wide = $state(true);

	$effect(() => {
		const el = holder;
		if (!el) return;
		const measure = () => {
			wide = (el.clientWidth || 600) >= 560;
		};
		measure();
		if (typeof ResizeObserver !== 'function') return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	});

	const relayOnly = $derived(mode === 'relay-only');
	const idSub = $derived(`${idServer || '?'}:${idPort}`);
	const relaySub = $derived(`${relay || idServer || '?'}:${relayPort}`);

	const you = $derived(tf('diagram.your_computer', 'Your computer'));
	const remote = $derived(tf('diagram.remote_device', 'Remote device'));
	const app = $derived(tf('diagram.with_rustdesk', 'with RustDesk'));
	const idTitle = $derived(tf('diagram.id_server', 'ID server'));
	const relayTitle = $derived(tf('diagram.relay_server', 'Relay server'));
	const off = $derived(tf('diagram.off', '(off)'));

	interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
		title: string;
		sub: string;
	}
	interface Edge {
		points: [number, number][];
		cls: string;
		both: boolean;
	}
	interface Label {
		x: number;
		y: number;
		text: string;
		anchor: 'start' | 'middle' | 'end';
		off: boolean;
	}

	const cx = (b: Box) => b.x + b.w / 2;
	const cy = (b: Box) => b.y + b.h / 2;

	// Shorten a subtitle wider than its box; the steps carry the full value
	function fit(text: string, max: number): string {
		if (text.length * SUB_CHAR <= max) return text;
		const keep = Math.max(4, Math.floor(max / SUB_CHAR) - 1);
		return text.slice(0, keep) + '…';
	}

	const layout = $derived.by(() => {
		const directCls = relayOnly ? 'is-off' : 'is-direct';
		const twoText = relayOnly ? `2 ${off}` : '2';
		const edge = (points: [number, number][], cls = '', both = false): Edge => ({ points, cls, both });
		const label = (
			x: number,
			y: number,
			text: string,
			anchor: Label['anchor'] = 'middle',
			isOff = false
		): Label => ({
			x,
			y,
			text,
			anchor,
			off: isOff
		});
		if (wide) {
			const a: Box = { x: 10, y: 95, w: 150, h: 56, title: you, sub: app };
			const b: Box = { x: 560, y: 95, w: 150, h: 56, title: remote, sub: app };
			const id: Box = { x: 270, y: 10, w: 180, h: 56, title: idTitle, sub: idSub };
			const r: Box = { x: 270, y: 184, w: 180, h: 56, title: relayTitle, sub: relaySub };
			return {
				W: 720,
				H: 250,
				boxes: [a, b, id, r],
				edges: [
					edge([
						[a.x + a.w, a.y + 10],
						[id.x - 4, cy(id)]
					]),
					edge([
						[b.x, b.y + 10],
						[id.x + id.w + 4, cy(id)]
					]),
					edge(
						[
							[a.x + a.w + 4, cy(a) + 6],
							[b.x - 4, cy(b) + 6]
						],
						directCls,
						true
					),
					edge(
						[
							[a.x + a.w, a.y + a.h - 8],
							[r.x - 4, cy(r)]
						],
						'is-relay',
						true
					),
					edge(
						[
							[b.x, b.y + b.h - 8],
							[r.x + r.w + 4, cy(r)]
						],
						'is-relay',
						true
					)
				],
				labels: [
					label(205, 52, '1'),
					label(515, 52, '1'),
					label(360, cy(a), twoText, 'middle', relayOnly),
					label(205, 205, '3'),
					label(515, 205, '3')
				]
			};
		}
		// Top to bottom: your computer, ID server, remote device, relay server.
		// The direct path runs down the left side and the relay path down the
		// right side, so no line crosses a box.
		const a: Box = { x: 20, y: 10, w: 300, h: 52, title: you, sub: app };
		const id: Box = { x: 60, y: 112, w: 220, h: 52, title: idTitle, sub: idSub };
		const b: Box = { x: 60, y: 236, w: 220, h: 52, title: remote, sub: app };
		const r: Box = { x: 20, y: 360, w: 300, h: 52, title: relayTitle, sub: relaySub };
		const below = (n: Box) => n.y + n.h;
		return {
			W: 340,
			H: 430,
			boxes: [a, id, b, r],
			edges: [
				edge([
					[cx(id), below(a) + 2],
					[cx(id), id.y - 4]
				]),
				edge([
					[cx(b), b.y - 4],
					[cx(b), below(id) + 4]
				]),
				edge(
					[
						[36, below(a) + 4],
						[36, cy(b)],
						[b.x - 4, cy(b)]
					],
					directCls,
					true
				),
				edge(
					[
						[304, below(a) + 4],
						[304, r.y - 4]
					],
					'is-relay',
					true
				),
				edge(
					[
						[cx(b), below(b) + 4],
						[cx(b), r.y - 4]
					],
					'is-relay',
					true
				)
			],
			labels: [
				label(cx(id) + 12, 92, '1', 'start'),
				label(cx(b) + 12, 204, '1', 'start'),
				label(46, 204, twoText, 'start', relayOnly),
				label(294, 204, '3', 'end'),
				label(cx(b) + 12, 330, '3', 'start')
			]
		};
	});

	const steps = $derived([
		tf(
			'diagram.step_find',
			'Both computers keep in touch with the ID server ({id}). When you connect, it tells each side where the other is.',
			{ id: idSub }
		),
		relayOnly
			? tf('diagram.step_direct_off', 'A direct connection is switched off on this server.')
			: tf(
					'diagram.step_direct',
					'If the networks allow it, the two computers then talk to each other directly.'
				),
		relayOnly
			? tf('diagram.step_relay_always', 'Every session goes through the relay server ({relay}).', {
					relay: relaySub
				})
			: tf('diagram.step_relay', 'Otherwise the session goes through the relay server ({relay}).', {
					relay: relaySub
				})
	]);
</script>

<figure class="diagram">
	<div class="diagram-plot" bind:this={holder}>
		<svg viewBox="0 0 {layout.W} {layout.H}" width="100%" role="img" aria-labelledby={capId}>
			<defs>
				<marker
					id={arrowId}
					viewBox="0 0 10 10"
					refX="9"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto"
				>
					<path class="dg-head" d="M0,0 L10,5 L0,10 z" />
				</marker>
				<marker
					id={arrowStartId}
					viewBox="0 0 10 10"
					refX="1"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto"
				>
					<path class="dg-head" d="M10,0 L0,5 L10,10 z" />
				</marker>
			</defs>
			{#each layout.boxes as box (box.x + ',' + box.y)}
				{@const sub = fit(box.sub, box.w - 12)}
				<g class="dg-node">
					<rect x={box.x} y={box.y} width={box.w} height={box.h} rx="3" />
					<text class="dg-title" x={cx(box)} y={box.y + box.h / 2 - 3} text-anchor="middle">{box.title}</text>
					<text class="dg-sub" x={cx(box)} y={box.y + box.h / 2 + 14} text-anchor="middle"
						>{#if sub !== box.sub}<title>{box.sub}</title>{/if}{sub}</text
					>
				</g>
			{/each}
			{#each layout.edges as e, i (i)}
				<polyline
					class={['dg-edge', e.cls]}
					points={e.points.map((p) => p.join(',')).join(' ')}
					marker-end="url(#{arrowId})"
					marker-start={e.both ? `url(#${arrowStartId})` : undefined}
				/>
			{/each}
			{#each layout.labels as l, i (i)}
				<text class={['dg-label', l.off && 'is-off']} x={l.x} y={l.y} text-anchor={l.anchor}>{l.text}</text>
			{/each}
		</svg>
	</div>
	<figcaption id={capId} class="diagram-caption">
		<ol class="steps">
			{#each steps as step, i (i)}
				<li>{step}</li>
			{/each}
		</ol>
	</figcaption>
</figure>

<style>
	.diagram {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		min-width: 0;
	}
	.diagram-plot svg {
		display: block;
		max-width: 760px;
		height: auto;
	}
	.dg-node rect {
		fill: var(--bg-subtle);
		stroke: var(--border);
		stroke-width: 1;
	}
	.dg-title {
		fill: var(--text);
		font-family: var(--font);
		font-size: 14px;
		font-weight: 600;
	}
	.dg-sub {
		fill: var(--text-muted);
		font-size: 12px;
	}
	.dg-edge {
		fill: none;
		stroke: var(--text-muted);
		stroke-width: 1.5;
	}
	.dg-edge.is-direct {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.dg-edge.is-relay {
		stroke: var(--text-muted);
	}
	.dg-edge.is-off {
		stroke: var(--border);
		stroke-dasharray: 4 4;
	}
	.dg-head {
		fill: var(--text-muted);
	}
	.dg-label {
		fill: var(--text);
		font-family: var(--font);
		font-size: 13px;
		font-weight: 700;
	}
	.dg-label.is-off {
		fill: var(--text-muted);
		font-weight: 400;
	}
	.steps {
		max-width: var(--measure);
		margin: 0;
		padding-inline-start: 1.5em;
	}
	.steps > li {
		padding: var(--space-1) 0;
	}
	.steps > li::marker {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
