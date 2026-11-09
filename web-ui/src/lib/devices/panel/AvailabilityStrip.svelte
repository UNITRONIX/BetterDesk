<!--
  One day as a band: online, degraded, critical or offline, from the
  recorded status changes. The band is decorative (aria-hidden): the legend
  under it gives the totals and the table below lists every change. Time
  runs left to right in every language.
-->
<script lang="ts">
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import type { AvailabilityEvent } from '#lib/api/device-agent.ts';
	import { AVAIL_STATES, availabilityStrip, dayDate, type AvailState } from '../panel-logic.ts';

	interface Props {
		day: string;
		events: readonly AvailabilityEvent[];
		/** The device's state, for a day without changes */
		current: string;
		/** Spans of time as text ("2 h 5 min") */
		span: (ms: number) => string;
		statusLabel: (status: string) => string;
		now?: number;
	}

	let { day, events, current, span, statusLabel, now = Date.now() }: Props = $props();

	const CLS: Record<AvailState, string> = {
		ONLINE: 'is-ok',
		DEGRADED: 'is-warning',
		CRITICAL: 'is-danger',
		OFFLINE: 'is-muted'
	};

	const strip = $derived(availabilityStrip(day, events, now, current));
	const clock = (ms: number) =>
		new Date(ms).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' });
	const pct = (v: number) =>
		strip ? `${(((v - strip.start) / (strip.end - strip.start)) * 100).toFixed(3)}%` : '0';
	const width = (a: number, b: number) =>
		strip ? `${(((b - a) / (strip.end - strip.start)) * 100).toFixed(3)}%` : '0';
	const ticks = $derived(
		[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => ({
			h,
			x: h === 24 ? '100%' : pct(dayDate(day, h).getTime()),
			label: h % 6 === 0 ? clock(h === 24 ? (strip?.end ?? 0) : dayDate(day, h).getTime()) : '',
			anchor: h === 0 ? 'start' : h === 24 ? 'end' : 'middle'
		}))
	);
	const legend = $derived(AVAIL_STATES.filter((s) => (strip?.totals[s] ?? 0) > 0));
</script>

{#if strip}
	<div class="dp-strip-wrap">
		<svg class="dp-strip" width="100%" height="44" aria-hidden="true" focusable="false">
			<rect class="dp-strip-bg" x="0" y="0" width="100%" height="20"></rect>
			{#each strip.spans as s (s.from)}
				{#if (AVAIL_STATES as readonly string[]).includes(s.status)}
					<rect
						class="dp-strip-span {CLS[s.status as AvailState]}"
						x={pct(s.from)}
						y="0"
						width={width(s.from, s.to)}
						height="20"><title>{statusLabel(s.status)}, {clock(s.from)}–{clock(s.to)}</title></rect
					>
				{/if}
			{/each}
			{#each ticks as tick (tick.h)}
				<line class="dp-strip-tick" x1={tick.x} x2={tick.x} y1="20" y2={tick.h % 6 ? 23 : 26}></line>
				{#if tick.label}
					<text
						class={['dp-strip-label', tick.h % 12 && 'is-minor']}
						x={tick.x}
						y="40"
						text-anchor={tick.anchor}>{tick.label}</text
					>
				{/if}
			{/each}
			{#if now < strip.end}
				<line class="dp-strip-now" x1={pct(now)} x2={pct(now)} y1="-3" y2="23"></line>
			{/if}
		</svg>
		{#if legend.length}
			<ul class="dp-legend">
				{#each legend as s (s)}
					<li>
						<span class="dp-key {CLS[s]}" aria-hidden="true"></span>{statusLabel(s)}
						<strong>{span(strip.totals[s] ?? 0)}</strong>
					</li>
				{/each}
			</ul>
		{/if}
		{#if now < strip.end}
			<p class="dp-muted">{t('device_detail.availability_until_now', { time: clock(now) })}</p>
		{/if}
	</div>
{/if}

<style>
	.dp-strip-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.dp-strip {
		display: block;
		direction: ltr;
		overflow: visible;
	}
	/* The part of the day still to come is an empty outline */
	.dp-strip-bg {
		fill: none;
		stroke: var(--border);
		stroke-width: 1;
		shape-rendering: crispEdges;
	}
	.dp-strip-span.is-ok,
	.dp-key.is-ok {
		fill: var(--success);
		background: var(--success);
	}
	.dp-strip-span.is-warning,
	.dp-key.is-warning {
		fill: var(--warning);
		background: var(--warning);
	}
	.dp-strip-span.is-danger,
	.dp-key.is-danger {
		fill: var(--danger);
		background: var(--danger);
	}
	.dp-strip-span.is-muted,
	.dp-key.is-muted {
		fill: var(--border);
		background: var(--border);
	}
	.dp-strip-tick {
		stroke: var(--border);
		stroke-width: 1;
	}
	.dp-strip-now {
		stroke: var(--text);
		stroke-width: 2;
	}
	.dp-strip-label {
		fill: var(--text-muted);
		font-family: var(--font);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.dp-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-sm);
	}
	.dp-legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.dp-key {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 1px;
	}
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	@media (max-width: 480px) {
		.dp-strip-label.is-minor {
			display: none;
		}
	}
	@media (forced-colors: active) {
		.dp-strip-span {
			fill: CanvasText;
		}
		.dp-strip-span.is-ok {
			fill: Highlight;
		}
	}
</style>
