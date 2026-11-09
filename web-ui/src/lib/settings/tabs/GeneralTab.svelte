<!--
  Settings › General. With server.config: one form whose sections save to
  their own endpoints (public client addresses, connection strategy,
  device visibility, availability history). Save sends only the sections
  that changed, one after the other, and the status line says which were
  saved and which were not, and why; a section that failed keeps its
  changes. MeshCentral sits beside them; its list actions save right away.
  The side column shows the addresses clients get now and the server
  information. Without server.config only the server information.

  Element ids are the old page's: links (/settings#public-endpoints) and the
  settings search (search-index.ts) point at them.
-->
<script lang="ts">
	import {
		getAvailabilityHistory,
		getClientConfig,
		getConnectionMode,
		getDeviceScope,
		getMeshGroups,
		getMeshStatus,
		getPublicEndpoints,
		getRecordings,
		getServerInfo,
		meshDownloadHref,
		recordingHref,
		saveAvailabilityHistory,
		saveConnectionMode,
		saveDeviceScope,
		saveMeshGroups,
		savePublicEndpoints,
		type ClientConfig,
		type ConnectionModeSettings,
		type MeshGroup,
		type MeshStatus,
		type Recording,
		type ServerInfo
	} from '#lib/api/settings.ts';
	import type { RestartItem } from '#lib/api/restart.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { formatBytes, formatDuration, formatNumber } from '#lib/i18n/format.ts';
	import { link } from '#lib/nav.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import ConnectionDiagram from '#lib/ui/ConnectionDiagram.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Steps from '#lib/ui/Steps.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import Version from '#lib/ui/Version.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import type { FormStatus as SaveStatus } from '#lib/ui/form.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { trackDirty } from '../dirty.ts';
	import { GENERAL_PARTS, connectionFacts, savedLine, splitHostPort, type GeneralPart } from '../general.ts';
	import { onRestartCanceled, showRestartPrompt } from '../restart.svelte.ts';
	import SettingsGrid from '../SettingsGrid.svelte';
	import SettingsLayout from '../SettingsLayout.svelte';

	const canConfig = can('server.config');
	const errText = (err: unknown) =>
		err instanceof Error && err.message ? err.message : t('errors.server_error');

	/* ── Server information (everyone) ── */

	let info = $state.raw<ServerInfo | null>(null);
	let infoError = $state('');

	async function loadInfo() {
		try {
			info = await getServerInfo();
			infoError = '';
		} catch (err) {
			infoError = errText(err);
		}
	}

	const goVersion = $derived(info?.goServer?.version ?? '');
	const isDevBuild = $derived(goVersion === 'dev' && !!info?.app?.version && info.app.version !== 'dev');
	const uptime = $derived(Number(info?.server?.uptime ?? 0));

	/* ── The form: four parts, one save ── */

	interface Values {
		endpoints: { public_server_id: string; public_relay_server: string; public_api_url: string };
		connection: ConnectionModeSettings;
		scope: 'open' | 'restricted';
		availability: { enabled: boolean; retention_days: number };
	}

	const DEFAULTS: Values = {
		endpoints: { public_server_id: '', public_relay_server: '', public_api_url: '' },
		connection: {
			mode: 'p2p_first',
			p2p_fallback_ms: 2000,
			same_nat_relay: true,
			allow_shared_nat_initiator: false,
			logged_in_only_initiator: false,
			operator_only_outbound: false
		},
		scope: 'open',
		availability: { enabled: false, retention_days: 30 }
	};

	let values = $state<Values>(structuredClone(DEFAULTS));
	let baseline = $state.raw<Values>(structuredClone(DEFAULTS));
	let loaded = $state(false);
	let busy = $state(false);
	let status = $state<SaveStatus>({ state: 'idle', message: '' });

	const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
	const partDirty = (p: GeneralPart) => !same($state.snapshot(values[p]), baseline[p]);
	const dirty = $derived(loaded && GENERAL_PARTS.some((p) => partDirty(p)));
	$effect(() => trackDirty(() => dirty));

	/**
	 * What the server has now for one part. A part the person already changed
	 * (they typed before the answer came) keeps their values, unless force
	 * (after a save or a cancelled restart, the server's values win).
	 */
	function setBaseline<P extends GeneralPart>(part: P, value: Values[P], force = false) {
		const touched = !same($state.snapshot(values[part]), baseline[part]);
		baseline = { ...baseline, [part]: structuredClone(value) };
		if (force || !touched) values[part] = structuredClone(value);
	}

	// Connection strategy: whether this console can store it, what the server runs with
	let connWritable = $state(false);
	let connProblem = $state('');
	let connRuntime = $state('');

	async function loadEndpoints(force = false) {
		const e = await getPublicEndpoints();
		setBaseline(
			'endpoints',
			{
				public_server_id: e.public_server_id ?? '',
				public_relay_server: e.public_relay_server ?? '',
				public_api_url: e.public_api_url ?? ''
			},
			force
		);
	}

	async function loadConnection(force = false) {
		try {
			const facts = connectionFacts(await getConnectionMode());
			setBaseline('connection', facts.settings, force);
			connWritable = facts.writable;
			connProblem = facts.writable ? '' : t('settings.general.conn_readonly');
			connRuntime = facts.runtime
				? t('settings.general.conn_running', {
						mode: facts.runtime.relayOnly ? t('settings.general.conn_relay') : t('settings.general.conn_p2p'),
						ms: facts.runtime.ms
					})
				: '';
		} catch (err) {
			connWritable = false;
			connProblem = errText(err);
			throw err;
		}
	}

	async function loadScope() {
		setBaseline('scope', await getDeviceScope());
	}

	async function loadAvailability() {
		const a = await getAvailabilityHistory();
		setBaseline('availability', {
			enabled: a.enabled === true,
			retention_days: Number(a.retention_days) || 30
		});
	}

	async function loadForm() {
		const results = await Promise.allSettled([
			loadEndpoints(),
			loadConnection(),
			loadScope(),
			loadAvailability()
		]);
		loaded = true;
		const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
		if (failed) status = { state: 'error', message: errText(failed.reason) };
	}

	const TITLES: Record<GeneralPart, string> = {
		endpoints: 'settings.public_endpoints_title',
		connection: 'settings.connection_mode_title',
		scope: 'settings.device_scope_title',
		availability: 'settings.availability_history_title'
	};

	/** Saves one part. false: the person cancelled. A restart the server asks for comes back. */
	async function savePart(part: GeneralPart): Promise<false | { restart: RestartItem | null }> {
		const v = $state.snapshot(values);
		if (part === 'endpoints') {
			const ok = await confirm({
				title: t('settings.public_endpoints_save_title'),
				message: t('settings.public_endpoints_save_confirm'),
				confirmLabel: t('settings.public_endpoints_save')
			});
			if (!ok) return false;
			await savePublicEndpoints({
				public_server_id: v.endpoints.public_server_id.trim(),
				public_relay_server: v.endpoints.public_relay_server.trim(),
				public_api_url: v.endpoints.public_api_url.trim()
			});
			await loadEndpoints(true);
			void loadClientConfig();
			return { restart: null };
		}
		if (part === 'connection') {
			if (!connWritable) throw new Error(t('settings.general.conn_readonly_short'));
			const fallback = Number(v.connection.p2p_fallback_ms);
			const restart = await saveConnectionMode({
				...v.connection,
				p2p_fallback_ms: Number.isFinite(fallback) ? Math.round(fallback) : 2000
			});
			await loadConnection(true);
			return { restart };
		}
		if (part === 'scope') {
			await saveDeviceScope(v.scope);
			setBaseline('scope', v.scope, true);
			return { restart: null };
		}
		let days = Math.round(Number(v.availability.retention_days));
		if (!Number.isFinite(days) || days < 1) days = 30;
		days = Math.min(days, 3650);
		await saveAvailabilityHistory(v.availability.enabled, days);
		setBaseline('availability', { enabled: v.availability.enabled, retention_days: days }, true);
		return { restart: null };
	}

	async function save(e?: SubmitEvent) {
		e?.preventDefault();
		if (busy) return;
		const parts = GENERAL_PARTS.filter((p) => partDirty(p));
		if (!parts.length) {
			status = { state: 'saved', message: t('settings.general.no_changes') };
			return;
		}
		busy = true;
		status = { state: 'saving', message: t('ui_form.saving') };
		const saved: string[] = [];
		const problems: string[] = [];
		let restart: RestartItem | null = null;
		for (const part of parts) {
			const title = t(TITLES[part]);
			try {
				const result = await savePart(part);
				if (result === false) {
					problems.push(t('settings.general.part_cancelled', { part: title }));
					continue;
				}
				restart = result.restart ?? restart;
				saved.push(title);
			} catch (err) {
				problems.push(t('settings.general.part_failed', { part: title, error: errText(err) }));
			}
		}
		busy = false;
		const line = savedLine(saved, (list) => t('settings.general.parts_saved', { parts: list }));
		status = problems.length
			? { state: 'error', message: [line, ...problems].filter(Boolean).join(' ') }
			: { state: 'saved', message: line };
		if (restart) showRestartPrompt(restart);
	}

	// Cancel in the restart prompt put the previous strategy back
	$effect(() => onRestartCanceled(() => void loadConnection(true).catch(() => undefined)));

	/* ── What clients get now (side column) ── */

	let clientConfig = $state.raw<ClientConfig | null>(null);
	let clientError = $state('');
	// The side column's server information waits for the addresses and the
	// connection mode above it, which grow once they arrive and would push it
	// down (a layout shift); a box that appears doesn't count as one
	const sideSettled = $derived(!canConfig || ((clientConfig !== null || clientError !== '') && loaded));

	async function loadClientConfig() {
		try {
			clientConfig = await getClientConfig();
			clientError = '';
		} catch (err) {
			clientError = errText(err);
		}
	}

	function sourceLabel(source: string | undefined): string {
		if (source === 'env') return t('settings.side.src_page');
		if (source === 'panel_host') return t('settings.side.src_overview');
		return t('settings.side.src_auto');
	}

	// The diagram: the addresses typed above, or the ones clients get now
	const diagram = $derived.by(() => {
		const typedId = values.endpoints.public_server_id.trim();
		const typedRelay = values.endpoints.public_relay_server.trim();
		const id = splitHostPort(typedId || clientConfig?.server_id || '', 21116);
		const relay = splitHostPort(typedRelay || typedId || clientConfig?.relay_server || '', 21117);
		return {
			idServer: id.host || '?',
			relay: relay.host || id.host || '?',
			idPort: id.port,
			relayPort: relay.port,
			mode: values.connection.mode === 'relay_only' ? ('relay-only' as const) : ('direct-first' as const)
		};
	});

	/* ── MeshCentral ── */

	type Line = { message: string; tone: 'neutral' | 'ok' | 'error' };

	let mesh = $state.raw<MeshStatus | null>(null);
	let groups = $state.raw<MeshGroup[]>([]);
	let groupsError = $state('');
	let groupsStatus = $state<Line>({ message: '', tone: 'neutral' });
	let recordings = $state.raw<Recording[] | null>(null);
	let recordingsError = $state('');
	let mshName = $state('BetterDesk Mesh');

	async function loadMesh() {
		mesh = await getMeshStatus();
		if (!mesh.enabled) return;
		void loadGroups();
		void loadRecordings();
	}

	async function loadGroups() {
		try {
			groups = await getMeshGroups();
			groupsError = '';
		} catch {
			groupsError = t('mesh.groups_load_error');
		}
	}

	async function loadRecordings() {
		try {
			recordings = await getRecordings();
			recordingsError = '';
		} catch {
			recordingsError = t('mesh.recordings_load_error');
		}
	}

	async function storeGroups(next: MeshGroup[], okMessage: string) {
		groupsStatus = { message: '', tone: 'neutral' };
		await saveMeshGroups(next);
		await loadGroups();
		groupsStatus = { message: okMessage, tone: 'ok' };
		toast.success(okMessage);
	}

	const saveFailed = (err: unknown) =>
		err instanceof Error && err.message ? err.message : t('mesh.groups_save_error');

	// The install disclosure downloads the default group's file (or the first one's)
	const installGroup = $derived(groups.find((g) => g.id === 'default') ?? groups[0]);

	// Add a group: a dialog with name and ID; saved right away
	let adding = $state(false);
	let addName = $state('');
	let addId = $state('');
	let addStatus = $state<Line>({ message: '', tone: 'neutral' });
	let addBusy = $state(false);
	let addNameEl = $state<HTMLInputElement | null>(null);
	let addIdEl = $state<HTMLInputElement | null>(null);

	function openAdd() {
		addName = '';
		addId = '';
		addStatus = { message: '', tone: 'neutral' };
		adding = true;
	}

	async function submitAdd(e?: SubmitEvent) {
		e?.preventDefault();
		if (addBusy) return;
		const name = addName.trim();
		const id = addId.trim();
		if (!id || !name) {
			addStatus = { message: t('settings.general.mesh_group_needs_both'), tone: 'error' };
			(name ? addIdEl : addNameEl)?.focus();
			return;
		}
		if (groups.some((g) => g.id === id)) {
			addStatus = { message: t('settings.general.mesh_group_exists'), tone: 'error' };
			addIdEl?.focus();
			return;
		}
		addBusy = true;
		addStatus = { message: t('branding.status_saving'), tone: 'neutral' };
		try {
			await storeGroups([...groups, { id, name, mesh_id: '' }], t('settings.general.mesh_group_added'));
			adding = false;
		} catch (err) {
			addStatus = { message: saveFailed(err), tone: 'error' };
		} finally {
			addBusy = false;
		}
	}

	async function renameGroup(g: MeshGroup) {
		const name = await prompt({
			title: t('settings.general.mesh_group_rename_title'),
			label: t('mesh.group_name_placeholder'),
			value: g.name,
			hint: t('settings.general.mesh_group_name_hint'),
			confirmLabel: t('settings.general.mesh_group_rename')
		});
		const next = name?.trim();
		if (!next || next === g.name) return;
		try {
			await storeGroups(
				groups.map((x) => (x.id === g.id ? { ...x, name: next } : x)),
				t('settings.general.mesh_group_renamed')
			);
		} catch (err) {
			groupsStatus = { message: saveFailed(err), tone: 'error' };
		}
	}

	async function removeGroup(g: MeshGroup) {
		const ok = await confirm({
			title: t('settings.general.mesh_group_remove_title'),
			message: t('settings.general.mesh_group_remove_msg', { name: g.name || g.id }),
			confirmLabel: t('settings.general.mesh_group_remove'),
			danger: true
		});
		if (!ok) return;
		try {
			await storeGroups(
				groups.filter((x) => x.id !== g.id),
				t('settings.general.mesh_group_removed')
			);
		} catch (err) {
			groupsStatus = { message: saveFailed(err), tone: 'error' };
		}
	}

	const groupColumns: Column<MeshGroup>[] = $derived([
		{ id: 'name', label: t('settings.general.mesh_col_name'), cell: groupName },
		{ id: 'id', label: t('settings.general.mesh_col_id'), cell: groupId },
		{ id: 'meshid', label: t('settings.general.mesh_col_meshid'), cell: groupMeshId, class: 'col-meshid' },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, align: 'actions', cell: groupActions }
	]);

	// Downloading a recording needs device.connect (server.config alone gets 403)
	const canDownloadRecordings = can('device.connect');
	const recordingColumns: Column<Recording>[] = $derived([
		{ id: 'device', label: t('settings.general.rec_device'), cell: recDevice },
		{ id: 'type', label: t('settings.general.rec_type'), cell: recType },
		{ id: 'when', label: t('settings.general.rec_when'), cell: recWhen },
		{ id: 'size', label: t('settings.general.rec_size'), align: 'num', cell: recSize },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, align: 'actions', cell: recActions }
	]);

	/* ── Start ── */

	$effect(() => {
		void loadInfo();
		if (!canConfig) return;
		void loadForm();
		void loadClientConfig();
		void loadMesh();
	});

	const toc = $derived(
		canConfig
			? [
					{ id: 'public-endpoints', label: t('settings.public_endpoints_title') },
					{ id: 'connection-mode-section', label: t('settings.connection_mode_title') },
					{ id: 'device-scope-settings-panel', label: t('settings.device_scope_title') },
					{ id: 'availability-history-settings-panel', label: t('settings.availability_history_title') },
					{ id: 'mesh-settings-panel', label: t('mesh.settings_title') }
				]
			: []
	);
</script>

{#snippet groupName(g: MeshGroup)}{g.name}{/snippet}
{#snippet groupId(g: MeshGroup)}<ValueCopy value={g.id} copy={false} />{/snippet}
{#snippet groupMeshId(g: MeshGroup)}
	{#if g.mesh_id}
		<ValueField value={g.mesh_id} label={`${t('settings.general.mesh_col_meshid')}: ${g.name || g.id}`} />
	{:else}<Empty />{/if}
{/snippet}
{#snippet groupActions(g: MeshGroup)}
	<MenuButton kebab label={t('settings.general.mesh_group_actions', { name: g.name || g.id })}>
		<MenuItem icon="download" href={meshDownloadHref(g.name, g.mesh_id)} download
			>{t('settings.general.mesh_group_download')}</MenuItem
		>
		<MenuItem icon="rename" onselect={() => void renameGroup(g)}
			>{t('settings.general.mesh_group_rename')}</MenuItem
		>
		<MenuDivider />
		<MenuItem icon="delete" danger onselect={() => void removeGroup(g)}
			>{t('settings.general.mesh_group_remove')}</MenuItem
		>
	</MenuButton>
{/snippet}

{#snippet recDevice(r: Recording)}
	<span class="cell-stack">
		<ValueCopy value={r.peer_id} />
		{#if r.transport && r.transport !== 'mesh'}<span class="cell-sub">{r.transport}</span>{/if}
	</span>
{/snippet}
{#snippet recType(r: Recording)}{#if r.session_type}{r.session_type}{:else}<Empty />{/if}{/snippet}
{#snippet recWhen(r: Recording)}<Time value={r.modified} />{/snippet}
{#snippet recSize(r: Recording)}{formatBytes(Number(r.size) || 0)}{/snippet}
{#snippet recActions(r: Recording)}
	{#if canDownloadRecordings && r.transport === 'mesh' && r.id}
		<Button size="sm" icon="download" href={recordingHref(r.id)} download
			>{t('mesh.recording_download')}</Button
		>
	{/if}
{/snippet}

{#snippet consoleVersion()}<Version version={session.appVersion} />{/snippet}
{#snippet serverVersion()}
	{#if isDevBuild}{t('settings.general.dev_build')}{:else}<Version version={goVersion} />{/if}
{/snippet}
{#snippet dbPath()}<ValueCopy
		value={info?.paths?.database}
		label={t('settings.general.database_file')}
	/>{/snippet}

{#snippet serverInfo()}
	<section class="section" id="server-info" aria-labelledby="server-info-title">
		<h2 id="server-info-title">{t('settings.server_info')}</h2>
		{#if infoError}<p class="state is-error" role="alert">{infoError}</p>{/if}
		<Facts
			items={[
				{ label: t('settings.general.console_version'), value: consoleVersion },
				{ label: t('settings.general.server_version'), value: serverVersion },
				{ label: t('settings.general.database_file'), value: dbPath },
				{ label: t('settings.general.running_for'), value: uptime > 0 ? formatDuration(uptime) : '' }
			]}
		/>
		{#if can('audit.view')}
			<p class="settings-audit-link">
				{t('settings.general.audit_moved')}
				<a href={link('/security-audit')}>{t('settings.general.audit_link')}</a>
			</p>
		{/if}
	</section>
{/snippet}

{#snippet address(value: string, source: string | undefined, label: string)}
	<span class="side-value">
		<ValueCopy {value} {label} />
		<span><Tag label={sourceLabel(source)} /></span>
	</span>
{/snippet}
{#snippet idValue()}
	{@render address(
		clientConfig?.server_id ?? '',
		clientConfig?.endpoint_sources?.host,
		t('dashboard.config_server_id')
	)}
{/snippet}
{#snippet relayValue()}
	{@render address(
		clientConfig?.relay_server ?? '',
		clientConfig?.endpoint_sources?.relay,
		t('dashboard.config_relay_server')
	)}
{/snippet}
{#snippet apiValue()}
	{@render address(
		clientConfig?.api_url ?? '',
		clientConfig?.endpoint_sources?.api,
		t('dashboard.config_api_server')
	)}
{/snippet}

{#snippet side()}
	<section class="section" aria-labelledby="general-side-title" data-search-skip>
		<h2 id="general-side-title">{t('settings.side.general_title')}</h2>
		<p class="section-note">{t('settings.side.general_note')}</p>
		{#if clientError}
			<States kind="error" message={clientError} onretry={() => void loadClientConfig()} />
		{:else if !clientConfig}
			<States kind="loading" />
		{:else}
			<Facts
				items={[
					{ label: t('dashboard.config_server_id'), value: idValue },
					{ label: t('dashboard.config_relay_server'), value: relayValue },
					{ label: t('dashboard.config_api_server'), value: apiValue }
				]}
			/>
			{#if clientConfig.phone_unreachable_host}<Notice
					tone="warning"
					message={t('settings.side.local_warning')}
				/>{/if}
		{/if}
		{#if connRuntime}<p class="side-line" id="connection-mode-runtime">{connRuntime}</p>{/if}
	</section>
	{#if sideSettled}{@render serverInfo()}{/if}
{/snippet}

{#snippet meshStatusValue()}<Status tone="good" label={t('mesh.enabled_label')} />{/snippet}
{#snippet meshServerId()}
	{#if mesh?.server_id}<ValueField
			value={mesh.server_id}
			label={t('settings.general.mesh_server_id')}
		/>{:else}<Empty />{/if}
{/snippet}
{#snippet meshCert()}
	{#if mesh?.cert_present}
		{#if mesh.cert_modified}
			{@const parts = t('settings.general.mesh_cert_since').split('{date}')}
			{parts[0]}<Time
				value={mesh.cert_modified}
				relative={false}
				format={{ year: 'numeric', month: 'short', day: 'numeric', hour: undefined, minute: undefined }}
			/>{parts[1] ?? ''}
		{:else}{t('settings.general.mesh_cert_present')}{/if}
	{:else}
		<Status tone="warning" label={t('settings.general.mesh_cert_none')} />
	{/if}
{/snippet}

{#if !canConfig}
	{@render serverInfo()}
{:else}
	<SettingsLayout {toc} {side} sideLabelledby="general-side-title">
		<form id="general-form" class="general-form" onsubmit={save} novalidate>
			<SettingsGrid>
				{#snippet start()}
					<section class="section" id="public-endpoints" aria-labelledby="public-endpoints-title">
						<h2 id="public-endpoints-title">{t('settings.public_endpoints_title')}</h2>
						<p class="section-note">{t('settings.public_endpoints_desc')}</p>
						<div class="form-column" id="public-endpoints-form">
							<Field
								id="public-server-id"
								label={t('settings.public_endpoints_server_id')}
								hint={t('settings.general.endpoint_id_hint')}
								width="host"
							>
								{#snippet children(f)}
									<Input
										{...f}
										class="mono"
										bind:value={values.endpoints.public_server_id}
										autocomplete="off"
										spellcheck={false}
										placeholder={t('settings.public_endpoints_server_id_placeholder')}
									/>
								{/snippet}
							</Field>
							<Field
								id="public-relay-server"
								label={t('settings.public_endpoints_relay')}
								hint={t('settings.general.endpoint_relay_hint')}
								width="host"
							>
								{#snippet children(f)}
									<Input
										{...f}
										class="mono"
										bind:value={values.endpoints.public_relay_server}
										autocomplete="off"
										spellcheck={false}
										placeholder={t('settings.public_endpoints_relay_placeholder')}
									/>
								{/snippet}
							</Field>
							<Field
								id="public-api-url"
								label={t('settings.public_endpoints_api_url')}
								hint={t('settings.general.endpoint_api_hint')}
								width="host"
							>
								{#snippet children(f)}
									<Input
										{...f}
										class="mono"
										bind:value={values.endpoints.public_api_url}
										autocomplete="off"
										spellcheck={false}
										placeholder={t('settings.public_endpoints_api_url_placeholder')}
									/>
								{/snippet}
							</Field>
							<p class="form-hint">{t('settings.general.endpoints_when')}</p>
							<p class="field-effect">{t('settings.general.endpoints_effect')}</p>
						</div>
					</section>

					<section class="section" id="connection-mode-section" aria-labelledby="connection-mode-title">
						<h2 id="connection-mode-title">{t('settings.connection_mode_title')}</h2>
						<p class="section-note">{t('settings.connection_mode_desc')}</p>
						<div class="form-column" id="connection-mode-form">
							{#if connProblem}<Notice id="connection-mode-source" message={connProblem} />{/if}
							<fieldset class="settings-fieldset" id="connection-mode-fields" disabled={!connWritable}>
								<legend class="sr-only">{t('settings.connection_mode_title')}</legend>
								<ChoiceList
									name="connection-mode"
									label={t('settings.connection_mode_label')}
									disabled={!connWritable}
									bind:value={values.connection.mode}
									choices={[
										{
											value: 'p2p_first',
											title: t('settings.general.conn_p2p'),
											description: t('settings.general.conn_p2p_desc')
										},
										{
											value: 'relay_only',
											title: t('settings.general.conn_relay'),
											description: t('settings.general.conn_relay_desc')
										}
									]}
								/>
								<Disclosure title={t('settings.connection_mode_advanced')} level={3}>
									<div class="disclosure-body">
										<Field
											id="conn-p2p-fallback-ms"
											label={t('settings.general.conn_fallback_label')}
											hint={t('settings.general.conn_fallback_hint')}
											width="short"
										>
											{#snippet children(f)}
												<Input
													{...f}
													type="number"
													min="0"
													max="30000"
													step="100"
													bind:value={values.connection.p2p_fallback_ms}
												/>
											{/snippet}
										</Field>
										<Checkbox
											id="conn-same-nat-relay"
											label={t('settings.general.conn_same_nat')}
											hint={t('settings.general.conn_same_nat_hint')}
											bind:checked={values.connection.same_nat_relay}
										/>
										<Checkbox
											id="conn-allow-shared-nat-initiator"
											label={t('settings.general.conn_shared_nat')}
											hint={t('settings.general.conn_shared_nat_hint')}
											bind:checked={values.connection.allow_shared_nat_initiator}
										/>
										<Checkbox
											id="conn-logged-in-only-initiator"
											label={t('settings.general.conn_logged_in')}
											hint={t('settings.general.conn_logged_in_hint')}
											bind:checked={values.connection.logged_in_only_initiator}
										/>
										<Checkbox
											id="conn-operator-only-outbound"
											label={t('settings.general.conn_operator_only')}
											hint={t('settings.general.conn_operator_only_hint')}
											bind:checked={values.connection.operator_only_outbound}
										/>
									</div>
								</Disclosure>
							</fieldset>
							{#if connWritable}<p class="field-effect" id="connection-mode-effect">
									{t('settings.general.conn_effect')}
								</p>{/if}
							<h3 id="connection-diagram-title">{t('diagram.how_title')}</h3>
							<div class="settings-diagram" id="connection-diagram">
								<ConnectionDiagram {...diagram} />
							</div>
							<p class="form-hint" id="connection-mode-info">{t('settings.general.conn_ports_hint')}</p>
						</div>
					</section>
				{/snippet}
				{#snippet end()}
					<section class="section" id="device-scope-settings-panel" aria-labelledby="device-scope-title">
						<h2 id="device-scope-title">{t('settings.device_scope_title')}</h2>
						<p class="section-note">{t('settings.general.scope_note')}</p>
						<div class="form-column" id="device-scope-form">
							<ChoiceList
								name="device_scope_mode"
								label={t('settings.device_scope_title')}
								bind:value={values.scope}
								choices={[
									{
										value: 'open',
										title: t('settings.general.scope_open'),
										description: t('settings.general.scope_open_desc')
									},
									{
										value: 'restricted',
										title: t('settings.general.scope_restricted'),
										description: t('settings.general.scope_restricted_desc'),
										controls: 'device-scope-warning'
									}
								]}
							/>
							<ShowWhen id="device-scope-warning" when={values.scope === 'restricted'}>
								<Notice tone="warning" message={t('settings.general.scope_restricted_warning')} />
							</ShowWhen>
							<p class="field-effect">{t('settings.general.scope_effect')}</p>
						</div>
					</section>

					<section
						class="section"
						id="availability-history-settings-panel"
						aria-labelledby="availability-title"
					>
						<h2 id="availability-title">{t('settings.availability_history_title')}</h2>
						<p class="section-note">{t('settings.general.availability_note')}</p>
						<div class="form-column" id="availability-history-form">
							<Checkbox
								id="availability-history-enabled"
								label={t('settings.availability_history_enable')}
								hint={t('settings.general.availability_enable_hint')}
								bind:checked={values.availability.enabled}
								{...showWhenControl('availability-retention-group', values.availability.enabled)}
							/>
							<ShowWhen id="availability-retention-group" when={values.availability.enabled}>
								<Field
									id="availability-history-retention"
									label={t('settings.general.retention_label')}
									hint={t('settings.general.retention_hint')}
									width="short"
								>
									{#snippet children(f)}
										<Input
											{...f}
											type="number"
											min="1"
											max="3650"
											bind:value={values.availability.retention_days}
										/>
									{/snippet}
								</Field>
							</ShowWhen>
							<p class="field-effect">{t('settings.general.availability_effect')}</p>
						</div>
					</section>

					<section class="section" id="mesh-settings-panel" aria-labelledby="mesh-title">
						<h2 id="mesh-title">{t('mesh.settings_title')}</h2>
						<p class="section-note">{t('settings.general.mesh_note2')}</p>
						{#if !mesh}
							<States kind="loading" />
						{:else if !mesh.enabled}
							<p class="state" id="mesh-state">{t('settings.general.mesh_off')}</p>
						{:else}
							<div class="settings-mesh-body" id="mesh-body">
								<Facts
									items={[
										{ label: t('settings.general.mesh_status'), value: meshStatusValue },
										{
											label: t('settings.general.mesh_agents'),
											value: formatNumber(Number(mesh.agents_online ?? 0))
										},
										{ label: t('settings.general.mesh_server_id'), value: meshServerId },
										{ label: t('settings.general.mesh_cert'), value: meshCert }
									]}
								/>
								{#if !mesh.cert_present}<Notice
										tone="warning"
										id="mesh-cert-banner"
										message={t('settings.general.mesh_cert_missing')}
									/>{/if}

								<div class="settings-subgroup" id="mesh-groups-form">
									<div class="section-head">
										<h3 id="mesh-groups-title">{t('mesh.groups_title')}</h3>
										<Button size="sm" icon="add" id="mesh-group-add" onclick={openAdd}
											>{t('mesh.group_add')}</Button
										>
									</div>
									<p class="form-hint">{t('settings.general.mesh_groups_note')}</p>
									{#if groupsError}
										<States kind="error" message={groupsError} onretry={() => void loadGroups()} />
									{:else if !groups.length}
										<p class="state">{t('settings.general.mesh_groups_empty')}</p>
									{:else}
										<div class="mesh-groups-table">
											<Table
												rows={groups}
												columns={groupColumns}
												key={(g) => g.id}
												label={t('mesh.groups_title')}
											/>
										</div>
									{/if}
									{#if groupsStatus.message}<FormStatus
											message={groupsStatus.message}
											tone={groupsStatus.tone}
										/>{/if}
								</div>

								<div id="mesh-install">
									<Disclosure title={t('settings.general.mesh_install_title')} level={3}>
										<div class="disclosure-body">
											<Steps
												items={[
													t('settings.general.mesh_install_step1'),
													t('settings.general.mesh_install_step2'),
													t('settings.general.mesh_install_step3')
												]}
											/>
											<Field
												id="mesh-msh-name"
												label={t('settings.general.mesh_msh_name')}
												hint={t('settings.general.mesh_msh_name_hint')}
												width="host"
											>
												{#snippet children(f)}
													<Input
														{...f}
														bind:value={mshName}
														onkeydown={(e) => {
															// Not the page's save
															if (e.key === 'Enter') e.preventDefault();
														}}
													/>
												{/snippet}
											</Field>
											<p class="install-download">
												<Button
													icon="download"
													href={meshDownloadHref(mshName, installGroup?.mesh_id)}
													download>{t('mesh.download_msh')}</Button
												>
											</p>
										</div>
									</Disclosure>
								</div>

								<div class="settings-subgroup" id="mesh-recordings">
									<h3>{t('settings.general.rec_title')}</h3>
									{#if recordingsError}
										<States kind="error" message={recordingsError} onretry={() => void loadRecordings()} />
									{:else if !recordings}
										<States kind="loading" />
									{:else if !recordings.length}
										<p class="form-hint">{t('settings.general.rec_empty')}</p>
									{:else}
										<p class="form-hint">{t('settings.general.rec_note')}</p>
										<Table
											rows={recordings}
											columns={recordingColumns}
											key={(r) => `${r.id}|${r.peer_id}|${r.modified}`}
											label={t('settings.general.rec_title')}
										/>
									{/if}
								</div>
							</div>
						{/if}
					</section>
				{/snippet}
			</SettingsGrid>
			<SaveBar label={t('settings.general.save_all')} {dirty} {busy} {status} />
		</form>
	</SettingsLayout>
{/if}

{#if adding}
	<Dialog title={t('settings.general.mesh_group_add_title')} onclose={() => (adding = false)}>
		<form id="mesh-group-add-form" class="dialog-form" onsubmit={submitAdd} novalidate>
			<Field
				id="mesh-group-name"
				label={t('mesh.group_name_placeholder')}
				hint={t('settings.general.mesh_group_name_hint')}
			>
				{#snippet children(f)}
					<Input {...f} bind:value={addName} bind:element={addNameEl} maxlength={80} autocomplete="off" />
				{/snippet}
			</Field>
			<Field
				id="mesh-group-id"
				label={t('mesh.group_id_placeholder')}
				hint={t('settings.general.mesh_group_id_hint')}
				width="medium"
			>
				{#snippet children(f)}
					<Input
						{...f}
						class="mono"
						bind:value={addId}
						bind:element={addIdEl}
						maxlength={64}
						autocomplete="off"
						spellcheck={false}
					/>
				{/snippet}
			</Field>
			<FormStatus message={addStatus.message} tone={addStatus.tone} />
		</form>
		{#snippet footer()}
			<Button onclick={() => (adding = false)}>{t('actions.cancel')}</Button>
			<Button type="submit" form="mesh-group-add-form" variant="primary" icon="add" busy={addBusy}
				>{t('mesh.group_add')}</Button
			>
		{/snippet}
	</Dialog>
{/if}

<style>
	.general-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}
	.form-column {
		max-width: var(--measure);
	}
	.form-column > :global(.check-field),
	.form-column > :global(div[role='radiogroup']),
	.form-column > :global(.notice),
	.form-column > :global(.show-when),
	.form-column > .field-effect,
	.form-column > .form-hint,
	.form-column > .settings-fieldset {
		margin-bottom: var(--space-3);
	}
	.form-column > :last-child {
		margin-bottom: 0;
	}
	.settings-fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.disclosure-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) 0 var(--space-2);
	}
	.disclosure-body > :global(.form-group) {
		margin-bottom: 0;
	}
	.form-hint,
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	h3 {
		margin: 0;
		font-size: var(--text-md);
	}
	.settings-diagram {
		margin-bottom: var(--space-3);
	}
	.settings-mesh-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.settings-subgroup {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.section-head h3 {
		margin-inline-end: auto;
	}
	.install-download {
		margin: 0;
	}
	.state {
		margin: 0;
		padding: var(--space-4) 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
	.settings-audit-link {
		margin: 0;
		color: var(--text-muted);
	}
	.side-value {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-width: 0;
	}
	.side-line {
		margin: 0;
	}
	.cell-stack {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.cell-sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* MeshIDs are long: the column takes what is left and cuts the value */
	.mesh-groups-table :global(.col-meshid) {
		width: 50%;
		max-width: 0;
	}
	.dialog-form {
		display: flex;
		flex-direction: column;
	}
</style>
