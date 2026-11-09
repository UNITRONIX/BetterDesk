<!--
  IoT devices (/cdap and /cdap/devices): the devices connected to the CDAP
  gateway, searchable and filtered by type, and the gateway's state beside
  them. A click anywhere on a row opens the device's page (its name is the
  link). While the gateway is off the page says so and, for people with
  server.config, offers to turn it on.

  Data: GET /api/cdap/status, then GET /api/cdap/devices (the status first,
  so the list knows whether the gateway is off), every 10 s while the tab is
  visible and on the top bar's Refresh. Search and type filter run here.
  Gateway on/off: POST /api/cdap/toggle (server.config, as the route checks);
  it changes after a server restart, so the answer's restart goes to the
  shared restart prompt.
-->
<script lang="ts">
	import {
		getGatewayStatus,
		listCdapDevices,
		toggleGateway,
		type CdapDevice,
		type GatewayStatus
	} from '#lib/api/cdap.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatDuration, formatNumber } from '#lib/i18n/format.ts';
	import {
		DEVICE_TYPES,
		connectedSeconds,
		describeDevice,
		filterListed,
		typeLabelKey,
		type ListedDevice
	} from '#lib/devices-area/cdap/model.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { showRestartPrompt } from '#lib/settings/restart.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import DangerZone from '#lib/ui/DangerZone.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	type Row = ListedDevice<CdapDevice>;
	type Tone = 'neutral' | 'ok' | 'error';

	let gateway = $state.raw<GatewayStatus | null>(null);
	let gatewayError = $state('');
	let rows = $state.raw<Row[]>([]);
	let loaded = $state(false);
	let listError = $state('');
	let now = $state(Date.now());

	let query = $state('');
	let type = $state('');

	const canToggle = $derived(can('server.config'));

	async function loadStatus() {
		try {
			gateway = await getGatewayStatus();
			gatewayError = '';
		} catch (err) {
			gatewayError = err instanceof Error ? err.message : '';
		}
	}

	async function loadDevices() {
		try {
			const list = await listCdapDevices();
			rows = list.map((d) => describeDevice(d));
			listError = '';
		} catch (err) {
			listError = err instanceof Error ? err.message : '';
			throw err;
		} finally {
			now = Date.now();
			loaded = true;
		}
	}

	async function refresh() {
		await loadStatus();
		if (gateway && !gateway.enabled) {
			loaded = true;
			return;
		}
		await loadDevices();
	}

	$effect(() => poll(refresh, { every: 10_000 }));
	$effect(() => onRefresh(() => void refresh().catch(() => undefined)));

	const off = $derived(gateway !== null && !gateway.enabled);
	const shown = $derived(filterListed(rows, type, query));
	const connectedCount = $derived(rows.filter((r) => r.device.connected).length);

	const typeOptions = $derived([
		{ value: '', label: t('common.all') },
		...DEVICE_TYPES.map((x) => ({ value: x as string, label: t(`cdap.type_${x}`) }))
	]);

	function typeLabel(x: string): string {
		const key = typeLabelKey(x);
		return key ? t(key) : x;
	}

	/* ── Gateway on and off ── */

	let enableStatus = $state({ message: '', tone: 'neutral' as Tone });
	let disableStatus = $state({ message: '', tone: 'neutral' as Tone });
	let busy = $state(false);

	async function setGateway(enabled: boolean, status: { message: string; tone: Tone }) {
		busy = true;
		status.message = t('cdap.saving');
		status.tone = 'neutral';
		try {
			const r = await toggleGateway(enabled);
			const msg = enabled ? t('cdap.enabled_restart') : t('cdap.disabled_restart');
			status.message = msg;
			status.tone = 'ok';
			toast.success(msg);
			if (r.restartRequired)
				showRestartPrompt({ phase: 'pending', changes: [], error: null, ...r.restartRequired });
		} catch (err) {
			status.message = t('cdap.toggle_failed', { error: err instanceof Error ? err.message : '' });
			status.tone = 'error';
		} finally {
			busy = false;
		}
	}

	async function askDisable() {
		const ok = await confirm({
			title: t('cdap.disable_confirm_title'),
			message: t('cdap.disable_confirm_message', { count: formatNumber(gateway?.connected ?? 0) }),
			confirmLabel: t('cdap.toggle_disable').replace(/…$/, ''),
			danger: true
		});
		if (ok) await setGateway(false, disableStatus);
	}

	/* ── Rows ── */

	const columns: Column<Row>[] = $derived([
		{
			id: 'name',
			label: t('cdap.col_device'),
			cell: nameCell,
			primary: true,
			class: 'col-name',
			sortValue: (r) => r.name
		},
		{
			id: 'type',
			label: t('cdap.col_type'),
			cell: typeCell,
			class: 'col-type',
			sortValue: (r) => typeLabel(r.type)
		},
		{
			id: 'status',
			label: t('cdap.col_status'),
			cell: statusCell,
			class: 'col-status',
			sortValue: (r) => (r.device.connected ? 0 : 1)
		},
		{
			id: 'address',
			label: t('cdap.col_address'),
			cell: addressCell,
			class: 'col-address',
			sortValue: (r) => r.device.client_ip
		},
		{
			id: 'uptime',
			label: t('cdap.col_connected_for'),
			cell: uptimeCell,
			class: 'col-uptime',
			sortValue: (r) => connectedSeconds(r.device, now)
		},
		{
			id: 'widgets',
			label: t('cdap.col_widgets'),
			cell: widgetsCell,
			align: 'num',
			class: 'col-widgets',
			sortValue: (r) => r.widgets
		},
		{
			id: 'heartbeats',
			label: t('cdap.col_heartbeats'),
			cell: beatsCell,
			class: 'col-heartbeats',
			align: 'num',
			sortValue: (r) => (r.device.connected ? r.device.heartbeat_count : null)
		}
	]);

	const href = (r: Row) => link(`/cdap/devices/${encodeURIComponent(r.device.id)}`);

	/** A click anywhere on a row follows its link (the link is the keyboard way) */
	function onRowClick(e: MouseEvent) {
		const el = e.target instanceof Element ? e.target : null;
		const tr = el?.closest('tbody tr');
		if (!el || !tr || el.closest('a, button, input, select, textarea, label')) return;
		const sel = window.getSelection?.();
		if (sel && !sel.isCollapsed && sel.anchorNode && tr.contains(sel.anchorNode)) return;
		tr.querySelector<HTMLAnchorElement>('a.cdap-device-link')?.click();
	}

	const emptyText = $derived(
		rows.length
			? t('cdap.no_devices_match')
			: gateway?.port
				? t('cdap.no_devices_port', { port: gateway.port })
				: t('cdap.no_devices_desc')
	);
</script>

{#snippet nameCell(r: Row)}<a class="cdap-device-link" href={href(r)}>{r.name}</a
	>{#if r.name !== r.device.id}<span class="cell-sub"
			><ValueCopy value={r.device.id} label={t('cdap.device_id')} /></span
		>{/if}{/snippet}
{#snippet typeCell(r: Row)}<Tag label={typeLabel(r.type)} />{/snippet}
{#snippet statusCell(r: Row)}<Status
		tone={r.device.connected ? 'good' : 'neutral'}
		label={r.device.connected ? t('cdap.connected') : t('cdap.disconnected')}
	/>{/snippet}
{#snippet addressCell(r: Row)}<ValueCopy value={r.device.client_ip} label={t('cdap.col_address')} />{/snippet}
{#snippet uptimeCell(r: Row)}{@const s = connectedSeconds(r.device, now)}{#if s === null}<Empty
		/>{:else}{formatDuration(s)}{/if}{/snippet}
{#snippet widgetsCell(r: Row)}{formatNumber(r.widgets)}{/snippet}
{#snippet beatsCell(r: Row)}{#if r.device.connected}{formatNumber(r.device.heartbeat_count)}{:else}<Empty
		/>{/if}{/snippet}

<div class="page page-wide cdap-list-page">
	<div class="page-head">
		<h1>{t('nav.cdap')}</h1>
		<p class="page-description">{t('cdap.page_description')}</p>
	</div>

	<div class={['page-cols', off && 'is-off']}>
		<div class="page-main">
			{#if off}
				<div class="cdap-disabled">
					<p class="state">{t('cdap.gateway_off_state')}</p>
					{#if canToggle}
						<div class="enable-row">
							<Button
								variant="primary"
								icon={ICONS.enable}
								{busy}
								onclick={() => void setGateway(true, enableStatus)}>{t('cdap.toggle_enable')}</Button
							>
							<FormStatus message={enableStatus.message} tone={enableStatus.tone} />
						</div>
					{/if}
				</div>
			{:else}
				<section class="section" aria-labelledby="cdap-list-title">
					<h2 id="cdap-list-title" class="sr-only">{t('cdap.devices_heading')}</h2>
					<div class="toolbar">
						<div class="toolbar-search">
							<SearchField label={t('cdap.search_devices')} bind:value={query} />
						</div>
						<SegmentedFilter label={t('cdap.filter_type')} options={typeOptions} bind:value={type} />
					</div>
					<p class="count-line" aria-live="polite">
						{#if rows.length}
							{#if shown.length !== rows.length}
								<CountLine
									text={t('cdap.count_filtered')}
									values={{ count: shown.length, total: rows.length }}
								/>
							{:else}
								<CountLine
									text={t('cdap.count_devices')}
									values={{ count: rows.length, connected: connectedCount }}
								/>
							{/if}
						{/if}
					</p>
					<!-- Mouse convenience: a click anywhere on a row follows its link -->
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div class="cdap-table" onclick={onRowClick}>
						<Table
							rows={shown}
							{columns}
							key={(r) => r.device.id}
							label={t('cdap.devices_heading')}
							loading={!loaded}
							loadingText={t('cdap.loading_devices')}
							error={listError && !rows.length ? t('cdap.devices_failed', { error: listError }) : null}
							onretry={() => void refresh().catch(() => undefined)}
							{emptyText}
						/>
					</div>
				</section>
			{/if}
		</div>

		{#if !off}
			<aside class="page-side" aria-labelledby="cdap-gw-title">
				<section class="section" aria-labelledby="cdap-gw-title">
					<h2 id="cdap-gw-title">{t('cdap.danger_zone')}</h2>
					<p class="gateway" aria-live="polite">
						{#if gatewayError}
							<Status tone="danger" label={t('cdap.gateway_status_failed', { error: gatewayError })} />
						{:else if gateway}
							<Status
								tone="good"
								label={gateway.tls
									? t('cdap.gateway_running_tls', { port: gateway.port || '–' })
									: t('cdap.gateway_running_plain', { port: gateway.port || '–' })}
							/>
						{:else}
							<Status tone="waiting" label={t('cdap.gateway_checking')} />
						{/if}
					</p>
					<p class="section-note">{t('cdap.gateway_note')}</p>
				</section>
				{#if canToggle && gateway}
					<DangerZone
						class="cdap-danger"
						title={tf('device_detail.danger_zone', 'Danger zone')}
						rows={[
							{
								title: t('cdap.disable_title'),
								consequence: t('cdap.disable_desc'),
								action: t('cdap.toggle_disable'),
								busy,
								onclick: () => void askDisable()
							}
						]}
					>
						<FormStatus message={disableStatus.message} tone={disableStatus.tone} />
					</DangerZone>
				{/if}
			</aside>
		{/if}
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.toolbar-search {
		flex: 1 1 220px;
		min-width: 0;
		max-width: 380px;
	}
	.toolbar :global(.segmented) {
		max-width: 100%;
		overflow-x: auto;
	}
	.count-line {
		min-height: 1.5em;
		margin: 0;
	}
	.cdap-disabled {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.state {
		margin: 0;
		color: var(--text-muted);
	}
	.enable-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.cdap-device-link {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		margin-top: 2px;
		font-size: var(--text-sm);
	}
	.cdap-table :global(tbody tr:not(.state-row)) {
		cursor: pointer;
	}
	/* Counts are short: their headings wrap instead of widening the table */
	.cdap-table :global(th.col-widgets),
	.cdap-table :global(th.col-heartbeats) {
		min-width: 6rem;
		max-width: 7.5rem;
		white-space: normal;
	}
	.cdap-table :global(th.col-widgets .sort-btn),
	.cdap-table :global(th.col-heartbeats .sort-btn) {
		white-space: normal;
		text-align: end;
	}
	.cdap-table :global(tbody th.col-name) {
		min-width: 9rem;
	}
	.cdap-table :global(td.col-uptime),
	.cdap-table :global(td.col-type) {
		white-space: nowrap;
	}
	.gateway {
		margin: 0;
	}
	/* The gateway state is a sentence: it wraps in the side column */
	.gateway :global(.status) {
		white-space: normal;
		align-items: baseline;
	}
	/* The narrow column: the button goes under its sentence */
	.page-side :global(.cdap-danger .list-row) {
		flex-wrap: wrap;
	}
	.page-side :global(.cdap-danger .row-main) {
		flex-basis: 100%;
	}
	/* Narrow: each device is a short block (name and status, type and address, time and counts) */
	@media (max-width: 640px) {
		.cdap-table :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.cdap-table :global(table),
		.cdap-table :global(tbody) {
			display: block;
		}
		.cdap-table :global(tbody tr:not(.state-row)) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: var(--space-1) var(--space-3);
			padding: var(--space-3) var(--row-pad-x);
			border-bottom: 1px solid var(--rule);
		}
		.cdap-table :global(tbody tr:not(.state-row) > :is(td, th)) {
			display: block;
			height: auto;
			min-height: 0;
			padding: 0;
			border: 0;
			background: transparent;
		}
		/* Name and status, type and address, then how long it has been connected */
		.cdap-table :global(tbody tr:not(.state-row) > .col-name) {
			grid-area: 1 / 1;
		}
		.cdap-table :global(tbody tr:not(.state-row) > .col-status) {
			grid-area: 1 / 2;
			text-align: end;
		}
		.cdap-table :global(tbody tr:not(.state-row) > .col-type) {
			grid-area: 2 / 1;
		}
		.cdap-table :global(tbody tr:not(.state-row) > .col-address) {
			grid-area: 2 / 2;
			text-align: end;
		}
		.cdap-table :global(tbody tr:not(.state-row) > .col-uptime) {
			grid-area: 3 / 1 / 3 / 3;
			color: var(--text-muted);
		}
		.cdap-table :global(tbody tr:not(.state-row) > :is(.col-widgets, .col-heartbeats)) {
			display: none;
		}
		.cdap-table :global(tbody tr.state-row) {
			display: block;
		}
		.cdap-table :global(.cdap-device-link) {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
</style>
