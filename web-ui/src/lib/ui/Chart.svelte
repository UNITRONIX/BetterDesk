<!--
  Chart (chart.css, ui-chart.js): a line chart for a value over time or a
  column chart for counts per period. One unit per chart, no second axis.
  Every chart has its summary sentence above it, a legend when there are two
  or more series, and a "Show the numbers" table, so nothing depends on
  reading the picture or on colour. Hover or the arrow keys on the focused
  plot move a crosshair that lists every series at that position; a live
  region reads it out. Time runs left to right in every language.

  kind: 'line' | 'columns'. label: what is plotted (accessible name).
  summary: one sentence written by the page. labels: the x positions.
  series: 1 to 3 of { name, values } (null for a gap). format: 'number',
  'bytes', 'duration' (seconds), 'percent' (0..100) or a function.
  yMax: a fixed top of the scale. xHeading: first column of the table.
-->
<script lang="ts" module>
	export interface ChartSeries {
		name: string;
		values: (number | null | undefined)[];
	}

	export type ChartFormat = 'number' | 'bytes' | 'duration' | 'percent' | ((value: number) => string);
</script>

<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatBytes, formatDuration, formatNumber, formatPercent } from '#lib/i18n/format.ts';

	interface Props {
		kind?: 'line' | 'columns';
		label: string;
		summary?: string;
		labels: string[];
		series: ChartSeries[];
		format?: ChartFormat;
		yMax?: number;
		xHeading?: string;
	}

	let {
		kind = 'line',
		label,
		summary = '',
		labels,
		series,
		format = 'number',
		yMax,
		xHeading = ''
	}: Props = $props();

	const H = 200;
	const PAD = { top: 12, right: 12, bottom: 26, left: 44 };
	// Average advance of the 11px tick font, to keep x labels from overlapping
	const TICK_CHAR = 6.4;

	const formatters = {
		number: (v: number) => formatNumber(v),
		bytes: (v: number) => formatBytes(v),
		duration: (v: number) => formatDuration(v),
		percent: (v: number) => formatPercent(v)
	};

	const has = (v: number | null | undefined): v is number =>
		v !== null && v !== undefined && !Number.isNaN(v);
	const fmt = (v: number | null | undefined): string => {
		if (!has(v)) return '–';
		return typeof format === 'function' ? format(v) : formatters[format](v);
	};

	// Round tick steps: 1, 2, 5 x 10^n
	function niceTicks(max: number, count: number): { max: number; ticks: number[] } {
		if (!(max > 0)) return { max: 1, ticks: [0, 1] };
		const raw = max / count;
		const pow = Math.pow(10, Math.floor(Math.log10(raw)));
		const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
		const top = Math.ceil(max / step) * step;
		const ticks: number[] = [];
		for (let v = 0; v <= top + step / 2; v += step) ticks.push(+v.toFixed(10));
		return { max: top, ticks };
	}

	let plot = $state<HTMLDivElement | null>(null);
	let measured = $state(0);
	let index = $state(-1);
	let announcement = $state('');
	let tip = $state<HTMLDivElement | null>(null);
	let tipWidth = $state(0);

	// The tip flips to the other side of the crosshair when it would overflow
	$effect(() => {
		if (!tip) return;
		void index;
		tipWidth = tip.offsetWidth;
	});

	// Draw at the plot's real width so text keeps its size
	$effect(() => {
		const el = plot;
		if (!el) return;
		measured = el.clientWidth;
		if (typeof ResizeObserver !== 'function') return;
		const ro = new ResizeObserver(() => {
			if (Math.abs(el.clientWidth - measured) > 4) measured = el.clientWidth;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	const W = $derived(Math.max(240, Math.round(measured || 600)));

	const geom = $derived.by(() => {
		const n = labels.length;
		const all = series.flatMap((s) => s.values.filter(has));
		const { max, ticks } = niceTicks(yMax || Math.max(1, ...all), 4);
		const x0 = PAD.left;
		const x1 = W - PAD.right;
		const y0 = H - PAD.bottom;
		const y1 = PAD.top;
		const band = (x1 - x0) / Math.max(1, n);
		const xAt = (i: number) =>
			kind === 'columns' ? x0 + band * (i + 0.5) : x0 + (n <= 1 ? 0 : ((x1 - x0) * i) / (n - 1));
		const yAt = (v: number) => y0 - ((y0 - y1) * v) / max;
		return { n, ticks, x0, x1, y0, y1, band, xAt, yAt };
	});

	const yTicks = $derived(geom.ticks.map((v) => ({ v, y: Math.round(geom.yAt(v)) + 0.5, text: fmt(v) })));

	// X labels: at most about one per 64 px; the last always shows, and labels
	// on the plot's edges are shifted inwards so they aren't cut off
	const xTicks = $derived.by(() => {
		const { n, x0, x1, xAt } = geom;
		const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((x1 - x0) / 64))));
		const shown = labels.map((_, i) => i === n - 1 || i % every === 0);
		for (let i = n - 2; i >= 0; i--) {
			if (shown[i]) {
				if (xAt(n - 1) - xAt(i) < 56) shown[i] = false;
				break;
			}
		}
		const out: { i: number; x: number; text: string }[] = [];
		let nextLeft = Infinity;
		for (let i = n - 1; i >= 0; i--) {
			if (!shown[i]) continue;
			const text = labels[i] ?? '';
			const w = text.length * TICK_CHAR;
			const x = Math.min(Math.max(xAt(i), w / 2), W - w / 2);
			if (x + w / 2 + 8 > nextLeft) continue;
			nextLeft = x - w / 2;
			out.unshift({ i, x, text });
		}
		return out;
	});

	const columns = $derived.by(() => {
		if (kind !== 'columns') return [];
		const { xAt, yAt, y0, band } = geom;
		const k = series.length;
		const barW = Math.min(24, Math.max(3, (band * 0.7 - 2 * (k - 1)) / k));
		return series.map((s, si) =>
			s.values.flatMap((v, i) => {
				if (!has(v) || !(v > 0)) return [];
				const cx = xAt(i) - (k * barW + 2 * (k - 1)) / 2 + si * (barW + 2);
				const top = yAt(v);
				const r = Math.min(2, y0 - top);
				// Square at the baseline, small rounded top
				return [
					{
						i,
						d: `M${cx},${y0} V${top + r} Q${cx},${top} ${cx + r},${top} H${cx + barW - r} Q${cx + barW},${top} ${cx + barW},${top + r} V${y0} Z`
					}
				];
			})
		);
	});

	const lines = $derived.by(() => {
		if (kind !== 'line') return [];
		const { n, xAt, yAt, y0 } = geom;
		return series.map((s) => {
			let d = '';
			let pen = false;
			s.values.forEach((v, i) => {
				if (!has(v)) {
					pen = false;
					return;
				}
				d += (pen ? ' L' : ' M') + xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1);
				pen = true;
			});
			let area = '';
			if (series.length === 1 && d) {
				const first = s.values.findIndex(has);
				let last = -1;
				s.values.forEach((v, i) => {
					if (has(v)) last = i;
				});
				if (first >= 0 && s.values.slice(first, last + 1).every(has)) {
					area = d + ` L${xAt(last)},${y0} L${xAt(first)},${y0} Z`;
				}
			}
			// A value with gaps on both sides has no line to draw: mark it with a dot
			const at = (i: number) => i >= 0 && i < n && has(s.values[i]);
			const points = s.values.flatMap((v, i) =>
				has(v) && !at(i - 1) && !at(i + 1) ? [{ i, cx: xAt(i), cy: yAt(v) }] : []
			);
			return { d, area, points };
		});
	});

	const crossX = $derived(index >= 0 && index < geom.n ? geom.xAt(index) : null);
	const tipLeft = $derived.by(() => {
		if (crossX === null) return 0;
		let left = crossX + 12;
		if (left + tipWidth > W) left = crossX - 12 - tipWidth;
		return Math.max(0, left);
	});

	function show(i: number, announce: boolean) {
		if (i < 0 || i >= geom.n) return;
		index = i;
		if (announce) {
			announcement =
				labels[i] +
				': ' +
				series.map((s) => (series.length > 1 ? s.name + ' ' : '') + fmt(s.values[i])).join(', ');
		}
	}

	function hide() {
		index = -1;
	}

	function onpointermove(e: PointerEvent) {
		if (!plot || !geom.n) return;
		const x = e.clientX - plot.getBoundingClientRect().left;
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i < geom.n; i++) {
			const d = Math.abs(geom.xAt(i) - x);
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		show(best, false);
	}

	function onkeydown(e: KeyboardEvent) {
		const n = geom.n;
		if (!n) return;
		// The plot is always laid out left to right, so the keys follow the picture
		if (e.key === 'ArrowRight') {
			e.preventDefault();
			show(Math.min(n - 1, index + 1), true);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			show(Math.max(0, index < 0 ? n - 1 : index - 1), true);
		} else if (e.key === 'Home') {
			e.preventDefault();
			show(0, true);
		} else if (e.key === 'End') {
			e.preventDefault();
			show(n - 1, true);
		} else if (e.key === 'Escape' && index >= 0) {
			e.stopPropagation();
			hide();
		}
	}

	const plotName = $derived(label + (summary ? '. ' + summary : ''));
	const tableName = $derived(
		label
			? tf('chart.table_label', '{label} as a table', { label })
			: tf('chart.show_table', 'Show the numbers')
	);
</script>

<figure class="chart">
	{#if summary}<p class="chart-summary">{summary}</p>{/if}

	<!-- A focusable group: the arrow keys move the crosshair -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={plot}
		class="chart-plot"
		tabindex="0"
		role="group"
		aria-roledescription={tf('chart.role', 'chart')}
		aria-label={plotName}
		{onpointermove}
		onpointerleave={hide}
		onblur={hide}
		{onkeydown}
	>
		<svg width={W} height={H} viewBox="0 0 {W} {H}" aria-hidden="true" focusable="false">
			<g class="chart-grid">
				{#each yTicks as tick (tick.v)}
					<line x1={geom.x0} x2={geom.x1} y1={tick.y} y2={tick.y} />
				{/each}
			</g>
			{#each yTicks as tick (tick.v)}
				<text class="chart-tick" x={geom.x0 - 6} y={tick.y + 4} text-anchor="end">{tick.text}</text>
			{/each}
			{#each xTicks as tick (tick.i)}
				<text class="chart-tick" x={tick.x.toFixed(1)} y={H - 8} text-anchor="middle">{tick.text}</text>
			{/each}

			{#if kind === 'columns'}
				{#each columns as bars, si (si)}
					<g class="chart-series-{si + 1}">
						{#each bars as bar (bar.i)}
							<path class="chart-bar" d={bar.d} />
						{/each}
					</g>
				{/each}
			{:else}
				{#each lines as line, si (si)}
					<g class="chart-series-{si + 1}">
						{#if line.area}<path class="chart-area" d={line.area} />{/if}
						<path class="chart-line" d={line.d} />
						{#each line.points as p (p.i)}
							<circle class="chart-point" r="3" cx={p.cx.toFixed(1)} cy={p.cy.toFixed(1)} />
						{/each}
					</g>
				{/each}
			{/if}

			<line class="chart-axis" x1={geom.x0} x2={geom.x1} y1={geom.y0 + 0.5} y2={geom.y0 + 0.5} />
			{#if crossX !== null}
				<line class="chart-cross" x1={crossX} x2={crossX} y1={geom.y1} y2={geom.y0} />
				{#if kind === 'line'}
					{#each series as s, si (si)}
						{@const v = s.values[index]}
						{#if has(v)}
							<circle class="chart-dot chart-dot-{si + 1}" r="4" cx={crossX} cy={geom.yAt(v)} />
						{/if}
					{/each}
				{/if}
			{/if}
		</svg>

		{#if crossX !== null}
			<div class="chart-tip" bind:this={tip} style:left="{tipLeft}px">
				<div class="chart-tip-x">{labels[index]}</div>
				{#each series as s, si (si)}
					<div class="chart-tip-row">
						<strong>{fmt(s.values[index])}</strong>
						{#if series.length > 1}
							<span class="chart-key chart-key-{si + 1}" aria-hidden="true"></span>{s.name}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
	<p class="sr-only" aria-live="polite">{announcement}</p>

	{#if series.length > 1}
		<ul class="chart-legend">
			{#each series as s, si (si)}
				<li>
					<span
						class={['chart-key', `chart-key-${si + 1}`, kind === 'columns' && 'is-block']}
						aria-hidden="true"
					></span>{s.name}
				</li>
			{/each}
		</ul>
	{/if}

	<details class="chart-table disclosure">
		<summary>{tf('chart.show_table', 'Show the numbers')}</summary>
		<!-- A scroll box that may overflow must be reachable by keyboard -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<div class="table-scroll" tabindex="0" role="region" aria-label={tableName}>
			<table class="data-table">
				<thead>
					<tr>
						<th scope="col">{xHeading}</th>
						{#each series as s, si (si)}
							<th scope="col">{s.name}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each labels as lab, i (i)}
						<tr>
							<th scope="row">{lab}</th>
							{#each series as s, si (si)}
								<td class="num-cell">{fmt(s.values[i])}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</details>
</figure>

<style>
	.chart {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		min-width: 0;
	}
	.chart-summary {
		max-width: var(--measure);
	}
	.chart-plot {
		position: relative;
		direction: ltr; /* time runs left to right in every language */
		min-width: 0;
		border-radius: var(--radius-sm);
	}
	.chart-plot svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.chart-plot:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 4px;
	}
	.chart-grid line {
		stroke: var(--rule);
		stroke-width: 1;
	}
	.chart-axis {
		stroke: var(--border);
		stroke-width: 1;
	}
	.chart-tick {
		fill: var(--text-muted);
		font-family: var(--font);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.chart-line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
		stroke-linecap: round;
	}
	.chart-area {
		stroke: none;
		opacity: 0.1;
	}
	.chart-series-1 .chart-line {
		stroke: var(--series-1);
	}
	.chart-series-2 .chart-line {
		stroke: var(--series-2);
	}
	.chart-series-3 .chart-line {
		stroke: var(--series-3);
	}
	.chart-series-1 :is(.chart-area, .chart-bar, .chart-point) {
		fill: var(--series-1);
	}
	.chart-series-2 :is(.chart-bar, .chart-point) {
		fill: var(--series-2);
	}
	.chart-series-3 :is(.chart-bar, .chart-point) {
		fill: var(--series-3);
	}
	.chart-cross {
		stroke: var(--border);
		stroke-width: 1;
		pointer-events: none;
	}
	.chart-dot {
		stroke: var(--bg);
		stroke-width: 2;
		pointer-events: none;
	}
	.chart-dot-1 {
		fill: var(--series-1);
	}
	.chart-dot-2 {
		fill: var(--series-2);
	}
	.chart-dot-3 {
		fill: var(--series-3);
	}
	.chart-tip {
		position: absolute;
		top: 0;
		z-index: 2;
		min-width: 96px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text-muted);
		font-size: var(--text-sm);
		pointer-events: none;
		white-space: nowrap;
	}
	.chart-tip-x {
		margin-bottom: 2px;
	}
	.chart-tip-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.chart-tip-row strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	/* Legend: a short line (or block for columns) of the series colour, then the name */
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.chart-legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.chart-key {
		display: inline-block;
		width: 14px;
		height: 2px;
		border-radius: 1px;
		background: var(--series-1);
	}
	.chart-key.is-block {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.chart-key-2 {
		background: var(--series-2);
	}
	.chart-key-3 {
		background: var(--series-3);
	}

	/* "Show the numbers": the disclosure and data table rules of components.css */
	.disclosure > summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--control-h);
		padding: 0 var(--row-pad-x);
		margin: 0 calc(-1 * var(--row-pad-x));
		border-radius: var(--radius);
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		list-style: none;
	}
	.disclosure > summary::-webkit-details-marker {
		display: none;
	}
	.disclosure > summary:hover {
		background: var(--bg-subtle);
	}
	.disclosure > summary::before {
		content: 'expand_more';
		font-family: 'Material Symbols Outlined';
		font-size: 20px;
		line-height: 1;
		color: var(--text-muted);
		transform: rotate(-90deg);
		transition: transform var(--motion);
		font-feature-settings: 'liga';
	}
	.disclosure > summary:dir(rtl)::before {
		transform: rotate(90deg);
	}
	.disclosure[open] > summary::before {
		transform: none;
	}
	.disclosure[open] > summary {
		margin-bottom: var(--space-3);
	}
	.table-scroll {
		position: relative;
		overflow-x: auto;
		min-width: 0;
		margin-inline: calc(-1 * var(--row-pad-x));
	}
	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-base);
	}
	.data-table th {
		height: 40px;
		padding: var(--row-pad-y) var(--row-pad-x);
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
		background: var(--bg);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		text-align: start;
		white-space: nowrap;
	}
	.data-table td {
		height: var(--row-h);
		padding: var(--space-1) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		vertical-align: middle;
		font-variant-numeric: tabular-nums;
	}
	/* Row headers (the x column) read as the first cell of their row */
	.data-table tbody th {
		height: var(--row-h);
		padding: var(--space-1) var(--row-pad-x);
		border-top: 0;
		background: transparent;
		color: var(--text);
		font-size: inherit;
		font-weight: 400;
	}
	.data-table tbody tr:hover :is(td, th) {
		background: var(--bg-subtle);
	}

	@media (forced-colors: active) {
		.chart-line {
			stroke: CanvasText;
		}
		.chart-bar,
		.chart-point,
		.chart-key {
			fill: CanvasText;
			background: CanvasText;
		}
	}
</style>
