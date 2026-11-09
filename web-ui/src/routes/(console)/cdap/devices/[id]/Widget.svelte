<!--
  One widget from the device's manifest: its label and unit, then its value
  or control. The value comes from the widget state the page polls; a
  control the person just changed keeps their value for 2 s, so the next
  poll doesn't put the old one back while the command is on its way.
  Controls send commands only with cdap.command (the command route checks
  it); without it they show their value and can't be changed, and action
  buttons are left out. Streams (terminal, desktop, video, files, audio)
  are their own components.
-->
<script lang="ts" module>
	export interface WidgetAccess {
		/** cdap.command: controls, buttons, table actions, video and audio */
		command: boolean;
		/** cdap.terminal: terminal and desktop */
		terminal: boolean;
		/** cdap.files: the live file browser */
		files: boolean;
	}
</script>

<script lang="ts">
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { gaugeTone, isOn, numberOf, percentOf, textOf, type Widget } from '#lib/devices-area/cdap/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Switch from '#lib/ui/Switch.svelte';
	import AudioWidget from './AudioWidget.svelte';
	import DesktopWidget from './DesktopWidget.svelte';
	import FilesWidget from './FilesWidget.svelte';
	import TableWidget from './TableWidget.svelte';
	import TerminalWidget from './TerminalWidget.svelte';
	import VideoWidget from './VideoWidget.svelte';

	interface Props {
		widget: Widget;
		value: unknown;
		deviceId: string;
		deviceName: string;
		access: WidgetAccess;
		/** Sends a command; false when it was not sent (cooldown) or failed */
		oncommand: (widget: Widget, action: string, value: unknown) => Promise<boolean>;
		/** Asks before a button with a confirmation sends its command */
		onconfirm: (widget: Widget) => Promise<boolean>;
	}

	let { widget, value, deviceId, deviceName, access, oncommand, onconfirm }: Props = $props();

	const uid = $props.id();
	const labelId = `wlabel-${uid}`;

	/* A control the person changed keeps their value for 2 s */
	let held = $state(false);
	let heldValue = $state<unknown>(undefined);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	function hold(v: unknown) {
		heldValue = v;
		held = true;
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => (held = false), 2000);
	}
	$effect(() => () => clearTimeout(holdTimer));

	const current = $derived(held ? heldValue : value);
	const readOnly = $derived(widget.readOnly || !access.command);

	const fmt = (n: number, digits: number) =>
		formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits });

	/* Slider: the value follows the thumb, the command goes 300 ms after it stops */
	let sliderTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(sliderTimer));
	function slide(e: Event) {
		const n = parseFloat((e.currentTarget as HTMLInputElement).value);
		hold(n);
		clearTimeout(sliderTimer);
		sliderTimer = setTimeout(() => {
			hold(n);
			void oncommand(widget, 'set', n);
		}, 300);
	}

	async function press() {
		if (widget.confirm !== null && !(await onconfirm(widget))) return;
		await oncommand(widget, 'trigger', null);
	}

	const sizeClass = $derived(widget.size ? `size-${widget.size}` : '');
	const selectOptions = $derived([
		{ value: '', label: t('cdap.select_option') },
		...widget.options.map((o) => ({ value: o.value, label: o.label || o.value }))
	]);
	const gauge = $derived.by(() => {
		const n = numberOf(current);
		if (n === null) return null;
		const pct = percentOf(n, widget.min, widget.max);
		return { n, pct, tone: gaugeTone(pct) };
	});
	const sliderValue = $derived(numberOf(current) ?? widget.min);
</script>

<div
	class={['cdap-widget', sizeClass, widget.readOnly && 'is-readonly']}
	data-widget-id={widget.id}
	data-widget-type={widget.type}
	role="group"
	aria-labelledby={labelId}
>
	<div class="widget-head">
		<span class="widget-label" id={labelId}>{widget.label}</span>
		{#if widget.unit}<span class="widget-unit">{widget.unit}</span>{/if}
	</div>
	<div class="widget-body">
		{#if widget.type === 'toggle'}
			{@const on = isOn(current)}
			<Switch
				inline
				label={on ? t('common.on') : t('common.off')}
				checked={on}
				disabled={readOnly}
				aria-labelledby={labelId}
				onchange={(e) => {
					const checked = (e.currentTarget as HTMLInputElement).checked;
					hold(checked);
					void oncommand(widget, 'set', checked);
				}}
			/>
		{:else if widget.type === 'gauge'}
			{#if gauge}
				<div class={['gauge', `is-${gauge.tone}`]}>
					<span class="gauge-bar" aria-hidden="true"
						><span class="gauge-fill" style:width="{gauge.pct}%"></span></span
					>
					<span class="gauge-value">
						<span class="gauge-number">{fmt(gauge.n, widget.decimals ?? 1)}</span>
						<span class="gauge-range">{fmt(widget.min, 0)} – {fmt(widget.max, 0)}</span>
					</span>
				</div>
			{:else}<Empty />{/if}
		{:else if widget.type === 'button'}
			{#if access.command && !widget.readOnly}
				<div><Button onclick={() => void press()}>{widget.label}</Button></div>
			{:else}<Empty />{/if}
		{:else if widget.type === 'led'}
			{@const text = typeof current === 'string' ? current : ''}
			{@const on = isOn(current) || text.startsWith('#')}
			{#if current === undefined}<Empty />{:else}<Status
					tone={on ? 'good' : 'neutral'}
					label={text && !text.startsWith('#') ? text : on ? t('common.on') : t('common.off')}
				/>{/if}
		{:else if widget.type === 'text'}
			{@const text = textOf(current)}
			{#if text}<span class="text-value">{text}</span>{:else}<Empty />{/if}
		{:else if widget.type === 'slider'}
			<div class="slider">
				<input
					type="range"
					min={widget.min}
					max={widget.max}
					step={widget.step}
					value={sliderValue}
					disabled={readOnly}
					aria-labelledby={labelId}
					oninput={slide}
				/>
				<span class="slider-labels">
					<span>{fmt(widget.min, 0)}</span>
					<span class="slider-value">{fmt(sliderValue, widget.decimals ?? 0)}</span>
					<span>{fmt(widget.max, 0)}</span>
				</span>
			</div>
		{:else if widget.type === 'select'}
			<Select
				options={selectOptions}
				value={current === undefined || current === null ? '' : textOf(current)}
				disabled={readOnly}
				aria-labelledby={labelId}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					hold(v);
					void oncommand(widget, 'set', v);
				}}
			/>
		{:else if widget.type === 'chart'}
			{@const obj =
				current && typeof current === 'object' && !Array.isArray(current)
					? (current as Record<string, unknown>)
					: {}}
			<ul class="chart-bars">
				{#each widget.series as s, i (i)}
					{@const n = numberOf(obj[s.key])}
					<li class="chart-row">
						<span class="chart-label" title={s.label}>{s.label}</span>
						<span class="gauge-bar" aria-hidden="true"
							><span class="gauge-fill" style:width="{n === null ? 0 : percentOf(n, s.min, s.max)}%"
							></span></span
						>
						<span class="chart-value"
							>{#if n === null}<Empty />{:else}{fmt(n, 1)}{/if}</span
						>
					</li>
				{/each}
			</ul>
		{:else if widget.type === 'table'}
			<TableWidget {widget} value={current} canAct={access.command} {oncommand} />
		{:else if widget.type === 'terminal'}
			<TerminalWidget {widget} value={current} {deviceId} {deviceName} canConnect={access.terminal} />
		{:else if widget.type === 'desktop'}
			<DesktopWidget {deviceId} {deviceName} canConnect={access.terminal} />
		{:else if widget.type === 'video_stream'}
			<VideoWidget {widget} {deviceId} {deviceName} canConnect={access.command} />
		{:else if widget.type === 'file_browser'}
			<FilesWidget
				{widget}
				value={current}
				{deviceId}
				canBrowse={access.command}
				canConnect={access.files}
				{oncommand}
			/>
		{:else if widget.type === 'audio'}
			<AudioWidget {deviceId} canConnect={access.command} />
		{:else}
			<span class="unsupported">{widget.type}</span>
		{/if}
	</div>
</div>

<style>
	.cdap-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg);
	}
	.size-lg,
	.size-md {
		grid-column: span 2;
	}
	.size-xl {
		grid-column: 1 / -1;
	}
	@media (max-width: 767px) {
		.size-lg,
		.size-md,
		.size-xl {
			grid-column: auto;
		}
	}
	.widget-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		min-width: 0;
	}
	.widget-label {
		min-width: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.widget-unit {
		flex-shrink: 0;
		max-width: 40%;
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.widget-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	/* Gauge and chart bars */
	.gauge {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.gauge-bar {
		display: block;
		flex: 1;
		height: 6px;
		border-radius: 1px;
		background: var(--hover);
		overflow: hidden;
	}
	.gauge-fill {
		display: block;
		height: 100%;
		background: var(--text-muted);
		transition: width var(--motion);
	}
	.gauge.is-warning .gauge-fill {
		background: var(--warning);
	}
	.gauge.is-danger .gauge-fill {
		background: var(--danger);
	}
	.gauge .gauge-bar {
		flex: none;
	}
	.gauge-value {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	.gauge-number {
		font-size: var(--text-lg);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.gauge-range {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.text-value {
		font-size: var(--text-md);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.slider {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.slider input {
		width: 100%;
		min-height: 24px;
		accent-color: var(--accent);
	}
	.slider input:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.slider-labels {
		display: flex;
		justify-content: space-between;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.slider-value {
		color: var(--text);
		font-weight: 600;
	}
	.chart-bars {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chart-row {
		display: grid;
		grid-template-columns: minmax(60px, 90px) 1fr minmax(40px, auto);
		align-items: center;
		gap: var(--space-2);
	}
	.chart-label {
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chart-value {
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.unsupported {
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	@media (pointer: coarse) {
		.slider input {
			min-height: 44px;
		}
	}
</style>
