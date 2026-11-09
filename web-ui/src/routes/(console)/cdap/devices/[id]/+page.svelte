<!--
  One IoT device (/cdap/devices/:id): its state, the alerts firing now, its
  values and controls from the manifest (with streams: terminal, desktop,
  video, files, audio), the commands sent from this page and the devices
  from the device list linked to it.

  Data, each only while the tab is visible (poll()):
  - GET /api/cdap/devices/:id every 10 s (name, type, firmware, connected).
    An unknown device (the gateway answers 404) or a failed first load: one
    sentence and the way back to the list instead of the page.
  - GET .../manifest once, GET .../state with it and then every 3 s, and
    GET /api/cdap/alerts?device_id= every 5 s (both only when the manifest
    has widgets, as before).
  - GET .../linked on load and after linking or unlinking.
  Commands: POST .../command (cdap.command), at most one per widget per
  second; the last 50 are listed under "Commands sent". Linking: POST
  /api/cdap/devices/<peer>/link (cdap.command).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { ApiError } from '#lib/api/client.ts';
	import {
		getAlerts,
		getCdapDevice,
		getLinkedPeers,
		getManifest,
		getWidgetState,
		sendCommand,
		setLink,
		type CdapAlert,
		type CdapDevice,
		type LinkedPeer
	} from '#lib/api/cdap.ts';
	import { formatDate, formatDuration } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		CommandGate,
		EMPTY_MANIFEST,
		addLog,
		connectedSeconds,
		firingAlerts,
		groupWidgets,
		hasCommands,
		peerOnline,
		readManifest,
		severityOf,
		severityTone,
		textOf,
		typeLabelKey,
		type LogEntry,
		type Manifest,
		type Widget
	} from '#lib/devices-area/cdap/model.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import Widget_ from './Widget.svelte';

	/** The IDs the route and the gateway accept */
	const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

	const id = $derived(page.params.id ?? '');
	const validId = $derived(SAFE_ID.test(id));

	let info = $state.raw<CdapDevice | null>(null);
	let infoError = $state<{ notFound: boolean; message: string } | null>(null);
	let manifest = $state.raw<Manifest>(EMPTY_MANIFEST);
	let manifestState = $state<'loading' | 'ready' | 'error'>('loading');
	let values = $state.raw<Record<string, unknown>>({});
	let alerts = $state.raw<CdapAlert[]>([]);
	let linked = $state.raw<LinkedPeer[]>([]);
	let linkedState = $state<'loading' | 'ready' | 'error'>('loading');
	let linkedError = $state('');
	let log = $state.raw<LogEntry[]>([]);
	let now = $state(Date.now());

	const canCommand = $derived(can('cdap.command'));
	const access = $derived({ command: canCommand, terminal: can('cdap.terminal'), files: can('cdap.files') });

	const name = $derived(manifest.name || readManifest(info?.manifest).name || info?.hostname || id);
	const deviceType = $derived(manifest.type || readManifest(info?.manifest).type);
	const firmware = $derived(manifest.firmware || readManifest(info?.manifest).firmware);
	const connected = $derived(info?.connected ?? false);
	const groups = $derived(groupWidgets(manifest.widgets));
	const firing = $derived(firingAlerts(alerts));

	$effect(() => setPageTitle(info ? name : t('cdap.device_detail')));

	function errorText(err: unknown): string {
		return err instanceof Error ? err.message : '';
	}

	/* ── Loading ── */

	async function loadInfo(deviceId: string) {
		try {
			const d = await getCdapDevice(deviceId);
			if (deviceId !== id) return;
			info = d;
			infoError = null;
			now = Date.now();
		} catch (err) {
			if (deviceId !== id) return;
			// After a first answer a failed refresh keeps what is on screen
			if (!info) {
				const notFound = err instanceof ApiError && err.status === 404;
				infoError = { notFound, message: errorText(err) };
			}
			throw err;
		}
	}

	async function loadWidgets(deviceId: string) {
		manifestState = 'loading';
		try {
			const [raw, state] = await Promise.all([
				getManifest(deviceId),
				getWidgetState(deviceId).catch(() => ({}))
			]);
			if (deviceId !== id) return;
			manifest = readManifest(raw);
			values = state;
			manifestState = 'ready';
		} catch {
			if (deviceId === id) manifestState = 'error';
		}
	}

	async function loadState(deviceId: string) {
		const state = await getWidgetState(deviceId);
		if (deviceId === id) values = state;
	}

	async function loadAlerts(deviceId: string) {
		const list = await getAlerts(deviceId);
		if (deviceId === id) alerts = list;
	}

	async function loadLinked(deviceId: string) {
		try {
			const list = await getLinkedPeers(deviceId);
			if (deviceId !== id) return;
			linked = list;
			linkedState = 'ready';
		} catch (err) {
			if (deviceId !== id) return;
			linkedError = errorText(err);
			linkedState = 'error';
		}
	}

	// A new device (also when the route's id changes): everything again
	$effect(() => {
		const deviceId = id;
		if (!validId) return;
		untrack(() => {
			info = null;
			infoError = null;
			manifest = EMPTY_MANIFEST;
			values = {};
			alerts = [];
			linked = [];
			linkedState = 'loading';
			log = [];
			void loadWidgets(deviceId);
			void loadLinked(deviceId);
		});
		return poll(() => loadInfo(deviceId), { every: 10_000 });
	});

	// Values every 3 s and alerts every 5 s, once the manifest has widgets
	const live = $derived(manifestState === 'ready' && manifest.widgets.length > 0);
	$effect(() => {
		if (!live) return;
		const deviceId = id;
		const stopState = poll(() => loadState(deviceId), { every: 3_000, immediate: false });
		const stopAlerts = poll(() => loadAlerts(deviceId), { every: 5_000 });
		return () => {
			stopState();
			stopAlerts();
		};
	});

	$effect(() =>
		onRefresh(() => {
			const deviceId = id;
			void loadInfo(deviceId).catch(() => undefined);
			void loadWidgets(deviceId);
			void loadLinked(deviceId);
		})
	);

	/* ── Commands ── */

	const gate = new CommandGate();
	let seq = 0;

	async function command(w: Widget, action: string, value: unknown): Promise<boolean> {
		if (!canCommand || !gate.allow(w.id)) return false;
		const entry = { id: ++seq, time: new Date(), widgetId: w.id, action, value };
		try {
			await sendCommand(id, { widget_id: w.id, action, value });
			log = addLog(log, { ...entry, ok: true, error: '' });
			return true;
		} catch (err) {
			const message = errorText(err) || t('cdap.command_failed');
			log = addLog(log, { ...entry, ok: false, error: message });
			toast.error(t('cdap.command_failed'));
			return false;
		}
	}

	function confirmWidget(w: Widget): Promise<boolean> {
		return confirm({
			title: t('cdap.confirm_command'),
			message: w.confirm || tf('cdap.confirm_trigger', 'Run {label} on this device?', { label: w.label }),
			confirmLabel: t('common.confirm')
		});
	}

	/* ── Linked devices ── */

	async function linkDevice() {
		const peer = await prompt({
			title: t('cdap.link_device'),
			label: t('cdap.link_prompt'),
			hint: t('cdap.link_hint'),
			confirmLabel: t('cdap.link_device'),
			required: true
		});
		const peerId = peer?.trim();
		if (!peerId) return;
		try {
			await setLink(peerId, id);
			toast.success(t('cdap.linked_ok', { id: peerId }));
			void loadLinked(id);
		} catch (err) {
			toast.error(t('cdap.link_failed', { error: errorText(err) }));
		}
	}

	async function unlink(p: LinkedPeer) {
		const ok = await confirm({
			title: t('cdap.unlink_title'),
			message: t('cdap.unlink_confirm'),
			confirmLabel: t('cdap.unlink_device'),
			danger: true
		});
		if (!ok) return;
		try {
			await setLink(p.id, '');
			toast.success(t('cdap.unlinked', { id: p.id }));
			void loadLinked(id);
		} catch (err) {
			toast.error(t('cdap.link_failed', { error: errorText(err) }));
		}
	}

	function typeLabel(x: string): string {
		const key = typeLabelKey(x);
		return key ? t(key) : x;
	}

	const uptime = $derived(info ? connectedSeconds(info, now) : null);
	const facts = $derived([
		{ label: t('cdap.col_status'), value: statusFact },
		{ label: t('cdap.device_id'), value: idFact },
		{ label: t('cdap.col_type'), value: deviceType ? typeFact : '' },
		{ label: t('cdap.firmware'), value: firmware },
		{ label: t('cdap.col_connected_for'), value: uptime === null ? '' : formatDuration(uptime) }
	]);
</script>

{#snippet statusFact()}{#if info}<Status
			tone={connected ? 'good' : 'neutral'}
			label={connected ? t('cdap.connected') : t('cdap.disconnected')}
		/>{:else}<Status tone="waiting" label={t('cdap.loading')} />{/if}{/snippet}
{#snippet idFact()}<ValueCopy value={id} label={t('cdap.device_id')} />{/snippet}
{#snippet typeFact()}<Tag label={typeLabel(deviceType)} />{/snippet}

<div class="page page-wide cdap-device-page">
	<div class="page-head">
		<p class="back"><a href={link('/cdap')}>{t('cdap.back_to_list')}</a></p>
		<h1>{validId && info ? name : validId ? id : t('cdap.device_detail')}</h1>
		<p class="page-description">{t('cdap.device_description')}</p>
	</div>

	{#if !validId || infoError}
		<p class="state is-error" role="alert">
			{!validId || infoError?.notFound
				? t('cdap.device_not_found', { id })
				: t('cdap.device_load_failed', { error: infoError?.message ?? '' })}
			<a href={link('/cdap')}>{t('cdap.back_to_list')}</a>
		</p>
	{:else}
		<div class="page-cols">
			<div class="page-main">
				<div class="device-facts"><Facts items={facts} label={name} /></div>

				{#if info && !connected}
					<Notice tone="warning" message={t('cdap.device_offline_msg')} />
				{/if}

				{#if firing.length}
					<section class="section" aria-labelledby="cdap-alerts-title">
						<h2 id="cdap-alerts-title">{t('cdap.active_alerts')}</h2>
						<p class="count-line">{t('cdap.alerts_count', { count: firing.length })}</p>
						<ul class="list alerts">
							{#each firing as a, i (a.alert_id || i)}
								{@const sev = severityOf(a.severity)}
								<li class="list-row alert-row">
									<Status tone={severityTone(sev)} label={t(`cdap.severity_${sev}`)} />
									<span class="row-main">
										<span class="row-title">{a.label}</span>
										{#if a.message}<span class="row-sub">{a.message}</span>{/if}
									</span>
									<span class="row-end"><Time value={a.fired_at} /></span>
								</li>
							{/each}
						</ul>
					</section>
				{/if}

				<section class="section" aria-labelledby="cdap-widgets-title">
					<h2 id="cdap-widgets-title">{t('cdap.widgets_heading')}</h2>
					{#if manifestState === 'loading'}
						<States kind="loading" message={t('cdap.loading_widgets')} />
					{:else if manifestState === 'error'}
						<States kind="error" message={t('cdap.load_error')} onretry={() => void loadWidgets(id)} />
					{:else if !manifest.widgets.length}
						<States kind="empty" message={t('cdap.no_widgets_sentence')} />
					{:else}
						<div class="widget-grid">
							{#each groups as g, gi (gi)}
								{#if g.category}<h3 class="widget-category">{g.category}</h3>{/if}
								{#each g.widgets as w (w.id)}
									<Widget_
										widget={w}
										value={values[w.id]}
										deviceId={id}
										deviceName={name}
										{access}
										oncommand={command}
										onconfirm={confirmWidget}
									/>
								{/each}
							{/each}
						</div>
					{/if}
				</section>
			</div>

			<aside class="page-side" aria-label={name}>
				{#if manifestState === 'ready' && hasCommands(manifest.widgets)}
					<section class="section" aria-labelledby="cdap-log-title">
						<div class="section-head">
							<h2 id="cdap-log-title">{t('cdap.command_log')}</h2>
							{#if log.length}
								<Button size="sm" onclick={() => (log = [])}>{t('cdap.clear_log')}</Button>
							{/if}
						</div>
						<ul class="list command-log" aria-live="polite">
							{#each log as e (e.id)}
								<li class="log-entry">
									<span class="log-time"
										>{formatDate(e.time, {
											year: undefined,
											month: undefined,
											day: undefined,
											second: '2-digit'
										})}</span
									>
									<Status
										tone={e.ok ? 'good' : 'danger'}
										label={e.ok ? t('cdap.command_ok') : t('cdap.command_error')}
									/>
									<span class="log-detail"
										><span class="mono">{e.widgetId}</span> <span aria-hidden="true">→</span>
										{e.action}{#if e.value !== null && e.value !== undefined}<span class="log-value"
												>{textOf(e.value)}</span
											>{/if}</span
									>
									{#if e.error}<span class="log-error">{e.error}</span>{/if}
								</li>
							{:else}
								<li class="list-row is-empty">{t('cdap.no_commands')}</li>
							{/each}
						</ul>
					</section>
				{/if}

				<section class="section" aria-labelledby="cdap-linked-title">
					<div class="section-head">
						<h2 id="cdap-linked-title">{t('cdap.linked_devices')}</h2>
						{#if canCommand}
							<Button size="sm" icon={ICONS.link} onclick={() => void linkDevice()}
								>{t('cdap.link_device')}</Button
							>
						{/if}
					</div>
					<p class="section-note">{t('cdap.linked_note')}</p>
					{#if linked.length}<p class="count-line">{t('cdap.linked_count', { count: linked.length })}</p>{/if}
					{#if linkedState === 'error'}
						<p class="state is-error">{t('cdap.linked_failed', { error: linkedError })}</p>
					{:else if linkedState === 'loading'}
						<States kind="loading" />
					{:else}
						<RowList label={t('cdap.linked_devices')}>
							{#each linked as p (p.id)}
								{#snippet sub()}<span class="mono">{p.id}</span>{#if p.platform}, {p.platform}{/if}{/snippet}
								{#snippet end()}<Status
										tone={peerOnline(p) ? 'good' : 'neutral'}
										label={peerOnline(p) ? t('cdap.peer_online') : t('cdap.peer_offline')}
									/>{/snippet}
								{#snippet actions()}<Button
										size="sm"
										icon={ICONS.unlink}
										aria-label={t('cdap.unlink_named', { name: p.hostname || p.id })}
										onclick={() => void unlink(p)}>{t('cdap.unlink_device')}</Button
									>{/snippet}
								<ListRow
									title={p.hostname || p.id}
									{sub}
									{end}
									onclick={() => openDevice(p.id)}
									actions={canCommand ? actions : undefined}
								/>
							{:else}
								<ListRow title={t('cdap.no_linked_devices')} empty />
							{/each}
						</RowList>
					{/if}
				</section>
			</aside>
		</div>
	{/if}
</div>

<style>
	.back {
		flex: 0 0 100%;
		order: -1;
		margin: 0;
		font-size: var(--text-sm);
	}
	.device-facts {
		max-width: var(--measure);
	}
	.state {
		margin: 0;
	}
	.state.is-error {
		color: var(--danger);
	}
	.state a {
		margin-inline-start: var(--space-1);
	}
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}
	.list {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		border-top: 1px solid var(--rule);
		list-style: none;
	}
	.alert-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.row-main {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.row-title {
		font-weight: 600;
	}
	.row-sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.row-end {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.widget-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
		gap: var(--space-3);
	}
	.widget-category {
		grid-column: 1 / -1;
		margin: var(--space-3) 0 0;
		font-size: var(--text-base);
		overflow-wrap: anywhere;
	}
	.widget-category:first-child {
		margin-top: 0;
	}
	@media (max-width: 767px) {
		.widget-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.command-log {
		max-height: 260px;
		overflow-y: auto;
	}
	.log-entry {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.log-time {
		min-width: 8ch;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.log-detail {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.log-value::before {
		content: ' = ';
	}
	.log-error {
		flex-basis: 100%;
		color: var(--danger);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.is-empty {
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		color: var(--text-muted);
	}
</style>
