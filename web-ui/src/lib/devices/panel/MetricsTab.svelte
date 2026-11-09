<!--
  Metrics: a summary, the usage history from the heartbeats (chart), the
  availability history of one day (band and table, previous and next day)
  and the connection sessions.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { AvailabilityEvent, ConnectionSession } from '#lib/api/device-agent.ts';
	import { formatDate, formatDuration, formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chart from '#lib/ui/Chart.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { PanelData } from '../panel-data.svelte.ts';
	import {
		currentAvailState,
		dayDate,
		effectiveMode,
		localDay,
		panelStatus,
		shiftDay,
		usageChart,
		usageSamples,
		type PanelDevice
	} from '../panel-logic.ts';
	import AvailabilityStrip from './AvailabilityStrip.svelte';
	import PanelSection from './PanelSection.svelte';

	let { device, data }: { device: PanelDevice; data: PanelData } = $props();

	// A deleted device has no availability or sessions the server answers for
	const tracked = $derived(!device.soft_deleted);

	$effect(() => {
		if (!tracked) return;
		untrack(() => {
			if (data.availability.state === 'idle') void data.loadAvailability();
			if (data.sessions.state === 'idle') void data.loadSessions();
		});
	});

	/* ── Summary ── */

	const avail = $derived(data.availability);
	const sessions = $derived(data.sessions);
	const mode = $derived(effectiveMode(device));
	const summaryFacts = $derived<Fact[]>([
		{ label: t('devices.status'), value: t(panelStatus(device).key) },
		{ label: t('devices.last_seen'), value: lastSeen },
		{ label: t('devices.ip_address'), value: ip },
		...(mode ? [{ label: t('device_detail.connection_mode_effective'), value: mode }] : []),
		...(tracked
			? [
					{
						label: t('device_detail.metrics_avail_today'),
						value: formatNumber(avail.value?.events?.length ?? 0)
					},
					{
						label: t('device_detail.metrics_sessions_tracked'),
						value: formatNumber(sessions.value?.length ?? 0)
					}
				]
			: [])
	]);

	/* ── Usage history ── */

	const samples = $derived(usageSamples(device.metrics_history));
	const chart = $derived(usageChart(samples));
	const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '–' : formatPercent(v));
	const timeFormat = $derived(
		new Intl.DateTimeFormat(
			i18n.locale,
			chart.crossesDay
				? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
				: { hour: '2-digit', minute: '2-digit' }
		)
	);
	const chartLabels = $derived(chart.times.map((x) => (x === null ? '…' : timeFormat.format(new Date(x)))));
	const summary = $derived.by(() => {
		const first = samples[0];
		const last = samples.at(-1);
		if (!first || !last) return '';
		const r = chart.range;
		return t('device_detail.usage_summary', {
			count: formatNumber(samples.length),
			start: formatDate(first.t),
			end: formatDate(last.t),
			cpu_min: pctText(r.cpu?.[0]),
			cpu_max: pctText(r.cpu?.[1]),
			memory_min: pctText(r.memory?.[0]),
			memory_max: pctText(r.memory?.[1]),
			disk_min: pctText(r.disk?.[0]),
			disk_max: pctText(r.disk?.[1])
		});
	});
	const oneSample = $derived.by(() => {
		const s = samples.at(-1);
		return s
			? t('device_detail.usage_one', {
					time: formatDate(s.t),
					cpu: pctText(s.cpu),
					memory: pctText(s.memory),
					disk: pctText(s.disk)
				})
			: '';
	});

	/* ── Availability ── */

	const day = $derived(data.availabilityDay);
	const isToday = $derived(day === localDay());
	const dayLabel = $derived(
		dayDate(day).toLocaleDateString(i18n.locale, {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		})
	);
	const events = $derived(avail.value?.events ?? []);

	function statusLabel(status: string) {
		const s = status.toLowerCase();
		const key = `device_detail.availability_status_${s}`;
		const word = t(key);
		return word === key ? status.toUpperCase() || '—' : word;
	}
	function sourceLabel(source: string) {
		const s = source.toLowerCase();
		const key = `device_detail.availability_source_${s}`;
		const word = t(key);
		return word === key ? s || '—' : word;
	}
	const statusTone = (status: string) =>
		({ online: 'good', degraded: 'warning', critical: 'danger', offline: 'neutral' })[status.toLowerCase()] ??
		'neutral';

	function span(ms: number) {
		const min = Math.round(ms / 60000);
		if (min < 1) return t('device_detail.duration_under_min');
		const h = Math.floor(min / 60);
		const m = min % 60;
		if (!h) return t('device_detail.duration_min', { m });
		if (!m) return t('device_detail.duration_h', { h });
		return t('device_detail.duration_h_min', { h, m });
	}

	const clockTime = (iso: string) => {
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? iso
			: d.toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	};

	const availColumns = $derived<Column<AvailabilityEvent>[]>([
		{
			id: 'time',
			label: t('device_detail.availability_col_time'),
			cell: evTime,
			sortValue: (e) => new Date(e.created_at ?? '')
		},
		{ id: 'from', label: t('device_detail.availability_col_from'), cell: evFrom },
		{ id: 'to', label: t('device_detail.availability_col_to'), cell: evTo },
		{ id: 'source', label: t('device_detail.availability_col_source'), cell: evSource }
	]);

	/* ── Sessions ── */

	function transportLabel(tr: string) {
		const x = tr.toLowerCase();
		if (x === 'punch_hole') return t('device_detail.sessions_transport_punch');
		if (x === 'request_relay') return t('device_detail.sessions_transport_relay');
		return tr;
	}
	function duration(s: ConnectionSession) {
		const secs = s.duration_seconds ?? null;
		if (s.active && (secs === null || secs < 0)) return t('device_detail.sessions_active');
		const text = formatDuration(Math.max(0, Math.floor(secs ?? 0)));
		return s.active ? `${t('device_detail.sessions_active')}, ${text}` : text;
	}
	const sessionColumns = $derived<Column<ConnectionSession>[]>([
		{
			id: 'when',
			label: t('device_detail.sessions_col_when'),
			cell: sWhen,
			sortValue: (s) => new Date(s.started_at ?? '')
		},
		{
			id: 'who',
			label: t('device_detail.sessions_col_who'),
			cell: sWho,
			sortValue: (s) => s.username || s.peer_name || s.peer_id
		},
		{ id: 'from', label: t('device_detail.sessions_col_from'), cell: sFrom },
		{ id: 'transport', label: t('device_detail.sessions_col_transport'), cell: sTransport },
		{
			id: 'duration',
			label: t('device_detail.sessions_col_duration'),
			cell: sDuration,
			align: 'num',
			sortValue: (s) => s.duration_seconds
		}
	]);
</script>

{#snippet lastSeen()}<Time value={device.last_online} empty={t('time.never')} />{/snippet}
{#snippet ip()}<ValueCopy value={device.ip} copy={false} />{/snippet}

{#snippet evTime(e: AvailabilityEvent)}{clockTime(e.created_at ?? '')}{/snippet}
{#snippet evFrom(e: AvailabilityEvent)}<Status
		tone={statusTone(e.from_status ?? '')}
		label={statusLabel(e.from_status ?? '')}
	/>{/snippet}
{#snippet evTo(e: AvailabilityEvent)}<Status
		tone={statusTone(e.to_status ?? '')}
		label={statusLabel(e.to_status ?? '')}
	/>{/snippet}
{#snippet evSource(e: AvailabilityEvent)}{sourceLabel(e.source ?? '')}{/snippet}

{#snippet sWhen(s: ConnectionSession)}<Time value={s.started_at} relative={false} />{/snippet}
{#snippet sWho(s: ConnectionSession)}
	{s.username || s.peer_name || s.peer_id || '—'}
	{#if s.username && s.peer_name}
		<span class="dp-sub"
			>{s.peer_name}{#if s.peer_id}, <span class="mono">{s.peer_id}</span>{/if}</span
		>
	{:else if s.peer_id && (s.username || s.peer_name)}
		<span class="dp-sub mono">{s.peer_id}</span>
	{/if}
{/snippet}
{#snippet sFrom(s: ConnectionSession)}{#if s.peer_ip}<span class="mono">{s.peer_ip}</span>{:else}<Empty
		/>{/if}{/snippet}
{#snippet sTransport(s: ConnectionSession)}{#if s.transport}{transportLabel(s.transport)}{:else}<Empty
		/>{/if}{/snippet}
{#snippet sDuration(s: ConnectionSession)}{duration(s)}{/snippet}

<PanelSection title={t('device_detail.section_metrics_summary')}>
	<Facts items={summaryFacts} />
</PanelSection>

<PanelSection title={t('device_detail.section_usage_history')} note={t('device_detail.usage_note')}>
	{#if !samples.length}
		<p class="dp-muted">{t('device_detail.usage_empty')}</p>
	{:else if samples.length < 2}
		<p>{oneSample}</p>
	{:else}
		<Chart
			kind="line"
			label={t('device_detail.usage_chart_label')}
			{summary}
			labels={chartLabels}
			series={[
				{ name: t('device_detail.metric_cpu'), values: chart.cpu },
				{ name: t('device_detail.metric_memory'), values: chart.memory },
				{ name: t('device_detail.metric_disk'), values: chart.disk }
			]}
			yMax={100}
			format="percent"
			xHeading={t('device_detail.availability_col_time')}
		/>
	{/if}
</PanelSection>

{#if tracked}
	<PanelSection title={t('device_detail.section_availability_history')}>
		<div class="dp-day">
			<Button size="sm" onclick={() => data.loadAvailability(shiftDay(day, -1))}
				>{t('device_detail.availability_prev_day')}</Button
			>
			<span class="dp-day-label" aria-live="polite">{dayLabel}</span>
			<Button
				size="sm"
				disabled={isToday}
				onclick={() => {
					const next = shiftDay(day, 1);
					if (next <= localDay()) void data.loadAvailability(next);
				}}>{t('device_detail.availability_next_day')}</Button
			>
		</div>
		{#if avail.state === 'loading' || avail.state === 'idle'}
			<States kind="loading" message={t('device_detail.availability_loading')} />
		{:else if avail.state === 'error'}
			<States
				kind="error"
				message={t('device_detail.availability_error')}
				retryLabel={t('errors.try_again')}
				onretry={() => data.loadAvailability(day)}
			/>
		{:else if !avail.value?.enabled}
			<div>
				<p class="dp-empty">{t('device_detail.availability_disabled')}</p>
				<p class="dp-muted">{t('device_detail.availability_disabled_hint')}</p>
			</div>
		{:else}
			{#if events.length || isToday}
				<AvailabilityStrip {day} {events} current={currentAvailState(device)} {span} {statusLabel} />
			{/if}
			{#if !events.length}
				<div>
					<p class="dp-empty">{t('device_detail.availability_empty')}</p>
					<p class="dp-muted">{t('device_detail.availability_empty_hint')}</p>
				</div>
			{:else}
				<Table
					rows={events}
					columns={availColumns}
					key={(e) => `${e.created_at}\n${e.from_status}\n${e.to_status}`}
					label={t('device_detail.section_availability_history')}
				/>
			{/if}
		{/if}
	</PanelSection>

	<PanelSection title={t('device_detail.section_connection_sessions')}>
		{#if sessions.state === 'loading' || sessions.state === 'idle'}
			<States kind="loading" message={t('device_detail.sessions_loading')} />
		{:else if sessions.state === 'error'}
			<States
				kind="error"
				message="{t('device_detail.sessions_error')} {sessions.error}"
				retryLabel={t('actions.retry')}
				onretry={() => data.loadSessions()}
			/>
		{:else if !sessions.value?.length}
			<div>
				<p class="dp-empty">{t('device_detail.sessions_empty')}</p>
				<p class="dp-muted">{t('device_detail.sessions_empty_hint')}</p>
			</div>
		{:else}
			<Table
				rows={sessions.value}
				columns={sessionColumns}
				key={(s) => `${s.started_at}\n${s.peer_id}\n${s.username}`}
				label={t('device_detail.section_connection_sessions')}
			/>
		{/if}
	</PanelSection>
{/if}

<style>
	.dp-day {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.dp-day-label {
		min-width: 0;
		font-weight: 600;
	}
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-empty {
		margin: 0;
	}
	.dp-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
