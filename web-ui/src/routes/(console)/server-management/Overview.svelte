<!--
  Server status (?tab=overview): whether the ID and relay server run, how
  busy the machine is, uptimes and technical details.

  Data: the machine's numbers every 2 s while the tab is visible
  (/api/server-management/resources, which also carries the last samples
  for the chart); the server status and the console info every 10 s. Two
  failed reads in a row stop the polling and show Try again.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		getResources,
		getServerInfo,
		getServerStatus,
		type ServerInfo,
		type Snapshot
	} from '#lib/api/serverManagement.ts';
	import { formatBytes, formatDate, formatDuration, formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { poll } from '#lib/state/live.ts';
	import {
		diskShare,
		historyChart,
		serverLine,
		serverState,
		share,
		type HistoryChart,
		type ServerState
	} from '#lib/serverarea/management.ts';
	import { around } from '#lib/serverarea/text.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Chart from '#lib/ui/Chart.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Version from '#lib/ui/Version.svelte';

	const TICK_MS = 2000;
	/** Ticks between server status checks (10 s) */
	const STATUS_EVERY = 5;

	let snap = $state.raw<Snapshot | null>(null);
	let info = $state.raw<ServerInfo | null>(null);
	let hbbs = $state<ServerState | null>(null);
	let hbbr = $state<ServerState | null>(null);
	let failed = $state(false);
	let run = $state(0);
	let infoSettled = $state(false);

	let ticks = 0;
	let failures = 0;

	// The two answers don't wait for each other (the status check can take seconds)
	function checkServers() {
		getServerStatus().then(
			(s) => {
				hbbs = serverState(s.hbbs);
				hbbr = serverState(s.hbbr);
			},
			() => {
				hbbs = 'unknown';
				hbbr = 'unknown';
			}
		);
		getServerInfo()
			.then(
				(next) => (info = next),
				() => {
					/* keep the last */
				}
			)
			.finally(() => (infoSettled = true));
	}

	// The polling restarts when `run` changes (Try again)
	$effect(() => {
		void run;
		return untrack(() => {
			ticks = 0;
			failures = 0;
			let stop: (() => void) | null = null;
			stop = poll(
				async () => {
					if (ticks % STATUS_EVERY === 0) checkServers();
					ticks++;
					try {
						snap = await getResources();
						failures = 0;
					} catch (err) {
						failures++;
						if (failures >= 2) {
							failed = true;
							stop?.();
						}
						throw err;
					}
				},
				{ every: TICK_MS }
			);
			return () => stop?.();
		});
	});

	function retry() {
		failed = false;
		snap = null;
		run++;
	}

	/* ── The chart: frozen while someone reads it or its table ── */

	let chartHost = $state<HTMLElement | null>(null);
	let chart = $state.raw<HistoryChart | null>(null);
	$effect(() => {
		const next = historyChart(snap?.history ?? []);
		untrack(() => {
			if (!next) return;
			const host = chartHost;
			if (chart && host && (host.contains(document.activeElement) || host.querySelector('details[open]')))
				return;
			chart = next;
		});
	});

	const clock = (ts: number) =>
		formatDate(ts, { year: undefined, month: undefined, day: undefined, second: '2-digit' });

	const pct = (v: number) => formatPercent(Math.round(v));

	const span = $derived(
		!chart
			? ''
			: chart.spanSeconds >= 120
				? t('server_mgmt.span_minutes', { n: Math.round(chart.spanSeconds / 60) })
				: t('server_mgmt.span_seconds', { n: chart.spanSeconds })
	);

	/* ── Values ── */

	const load = $derived(
		(snap?.load ?? [0, 0, 0])
			.slice(0, 3)
			.map((v) => formatNumber(Number(v) || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
			.join(', ')
	);
	const cores = $derived(snap?.cpuCount ?? 0);
	const serverUptime = $derived(
		info?.server?.running && info.server.uptimeSeconds !== null ? info.server.uptimeSeconds : null
	);
	const serverVersion = $derived(info?.server?.version ?? '');
	/* Each server's line, the version and the server uptime come with the first
	   two answers: the side column is drawn once both are in, so its sections
	   don't grow and move one after the other */
	const sideReady = $derived(hbbs !== null && infoSettled);
	const nodeVersion = $derived(info?.nodeVersion || snap?.nodeVersion || '');
	const restarts = $derived(around('server_mgmt.history_restarts', 'link'));
</script>

{#snippet server(kind: 'hbbs' | 'hbbr', state: ServerState | null)}
	{#if state === null}
		<Status tone="waiting" label={t('status.checking')} />
	{:else}
		{@const line = serverLine(kind, state)}
		<Status tone={line.tone} label={t(line.label)} />
		<span class="sub">{t(line.meaning)}</span>
	{/if}
{/snippet}

<div class="page-cols">
	<div class="page-main">
		<!-- The first reading has the chart's samples and the machine's numbers: both
		     sections are drawn with it, so the chart doesn't push the numbers down -->
		{#if !snap && !failed}
			<States kind="loading" message={t('server_mgmt.machine_loading')} />
		{:else}
			<section class="section" aria-labelledby="sm-history-title">
				<div class="section-head"><h2 id="sm-history-title">{t('server_mgmt.history')}</h2></div>
				<p class="section-note">{t('server_mgmt.history_note')}</p>
				<div class="history" bind:this={chartHost}>
					{#if chart}
						<Chart
							kind="line"
							label={t('server_mgmt.history_label')}
							summary={t('server_mgmt.history_summary', {
								span,
								cpuAvg: pct(chart.cpuAvg),
								cpuMax: pct(chart.cpuMax),
								memAvg: pct(chart.memAvg),
								memMax: pct(chart.memMax)
							})}
							labels={chart.times.map(clock)}
							series={[
								{ name: t('server_mgmt.cpu'), values: chart.cpu },
								{ name: t('server_mgmt.memory'), values: chart.mem }
							]}
							yMax={100}
							format="percent"
							xHeading={t('server_mgmt.history_time')}
						/>
					{:else}
						<States kind="loading" message={t('server_mgmt.history_waiting')} />
					{/if}
				</div>
				<p class="muted">
					{restarts[0]}<a href={link('/security-audit')}>{t('nav.security_audit')}</a>{restarts[1]}
				</p>
			</section>

			<section class="section" aria-labelledby="sm-machine-title">
				<div class="section-head"><h2 id="sm-machine-title">{t('server_mgmt.machine_title')}</h2></div>
				<p class="section-note">{t('server_mgmt.machine_note')}</p>
				{#if failed}
					<States kind="error" message={t('server_mgmt.machine_error')} onretry={retry} />
				{:else if snap}
					<dl class="facts sm-facts">
						<dt>{t('server_mgmt.cpu')}</dt>
						<dd>
							<span class="meter-box"><Meter value={share(snap.cpu)} high={80} /></span>
							<span class="sub">{t('server_mgmt.cpu_meta', { cores, model: snap.cpuModel || '–' })}</span>
						</dd>
						<dt>{t('server_mgmt.memory')}</dt>
						<dd>
							<span class="meter-box"><Meter value={share(snap.mem.percent)} high={80} /></span>
							<span class="sub"
								>{t('server_mgmt.mem_meta', {
									used: formatBytes(snap.mem.used) || '–',
									total: formatBytes(snap.mem.total) || '–'
								})}</span
							>
						</dd>
						<dt>{t('server_mgmt.load')}</dt>
						<dd>
							<span class="num">{load}</span>
							<span class="sub">{t('server_mgmt.load_meta', { cores })}</span>
						</dd>
						{#each snap.disks as d, i (i)}
							{@const total = Number(d.size || d.total) || 0}
							<dt>{t('server_mgmt.disk_label', { mount: d.mount || d.fs || '?' })}</dt>
							<dd>
								<span class="meter-box"><Meter value={share(diskShare(d))} high={80} /></span>
								<span class="sub"
									>{t('server_mgmt.disk_meta', {
										used: formatBytes(Number(d.used) || 0),
										total: formatBytes(total)
									})}</span
								>
							</dd>
						{:else}
							<dt>{t('server_mgmt.disks')}</dt>
							<dd>{t('server_mgmt.no_disks')}</dd>
						{/each}
					</dl>
				{/if}
			</section>
		{/if}
	</div>

	<aside class="page-side" aria-labelledby="sm-servers-title">
		<section class="section" aria-labelledby="sm-servers-title">
			<div class="section-head"><h2 id="sm-servers-title">{t('server_mgmt.servers_title')}</h2></div>
			{#if !sideReady}
				<States kind="loading" message={t('status.checking')} />
			{:else}
				<dl class="facts side-facts">
					<dt>{t('dashboard.signal_server')}</dt>
					<dd class="sm-hbbs">{@render server('hbbs', hbbs)}</dd>
					<dt>{t('dashboard.relay_server_label')}</dt>
					<dd class="sm-hbbr">{@render server('hbbr', hbbr)}</dd>
					<dt>{t('dashboard.web_console')}</dt>
					<dd><Status tone="good" label={t('status.running')} /></dd>
					{#if serverVersion}
						<dt>{t('server_mgmt.server_version')}</dt>
						<dd><Version version={serverVersion} /></dd>
					{/if}
				</dl>
			{/if}
		</section>

		{#if sideReady}
			<section class="section" aria-labelledby="sm-uptime-title">
				<div class="section-head"><h2 id="sm-uptime-title">{t('server_mgmt.uptime')}</h2></div>
				<dl class="facts side-facts">
					{#if serverUptime !== null}
						<dt>{t('server_mgmt.server_uptime')}</dt>
						<dd>{formatDuration(serverUptime)}</dd>
					{/if}
					<dt>{t('server_mgmt.console_uptime')}</dt>
					<dd>
						{#if snap}{formatDuration(snap.nodeUptime)}{:else}<Empty />{/if}
					</dd>
					<dt>{t('server_mgmt.host_uptime')}</dt>
					<dd>
						{#if snap}{formatDuration(snap.uptime)}{:else}<Empty />{/if}
						<span class="sub">{t('server_mgmt.host_uptime_hint')}</span>
					</dd>
				</dl>
			</section>

			<Disclosure class="section" title={t('server_mgmt.host_info')}>
				<dl class="facts side-facts">
					<dt>{t('server_mgmt.info_hostname')}</dt>
					<dd><ValueCopy value={snap?.hostname} /></dd>
					<dt>{t('server_mgmt.info_platform')}</dt>
					<dd>
						{#if snap?.platform}{snap.platform} ({snap.arch}){:else}<Empty />{/if}
					</dd>
					<dt>{t('server_mgmt.info_kernel')}</dt>
					<dd>
						{#if snap?.release || snap?.osVersion}{snap.release || snap.osVersion}{:else}<Empty />{/if}
					</dd>
					<dt>{t('server_mgmt.info_node')}</dt>
					<dd><Version version={nodeVersion} /></dd>
					<dt>{t('server_mgmt.info_process_id')}</dt>
					<dd><ValueCopy value={info?.pid} copy={false} /></dd>
					<dt>{t('server_mgmt.info_pty_available')}</dt>
					<dd>
						{#if info}<BooleanStatus
								value={info.ptyAvailable}
								on={t('server_mgmt.pty_yes')}
								off={t('server_mgmt.pty_no')}
							/>{:else}<Empty />{/if}
					</dd>
				</dl>
			</Disclosure>
		{/if}
	</aside>
</div>

<style>
	/* A value with a sentence under it inside a facts row */
	.sm-facts > dd,
	.side-facts > dd {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 2px;
	}
	.sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.meter-box {
		display: block;
		width: min(100%, 320px);
	}
	/* Same bar length whatever the number is */
	.meter-box :global(.meter-value) {
		min-width: 4.5ch;
		text-align: end;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	/* Side column: label above value, read top to bottom */
	.page-side .side-facts {
		grid-template-columns: minmax(0, 1fr);
	}
	.page-side .side-facts > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
		font-size: var(--text-sm);
	}
	.page-side .side-facts > dd {
		min-height: 0;
		padding-top: var(--space-1);
	}
</style>
