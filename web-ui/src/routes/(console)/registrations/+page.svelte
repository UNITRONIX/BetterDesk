<!--
  Enrollment requests (/registrations): devices that asked to join, from
  two queues (RustDesk clients through the Go server, BetterDesk clients on
  the local network). Approve opens the request's sheet with the approve
  form; Reject asks in a dialog. A click anywhere on a row opens its sheet.
  Approved rows open their device in the device panel, on this page.

  Data: the three lists in parallel on load, again on Refresh and whenever
  a request arrives or is decided elsewhere (/ws/panel-events, through the
  shell). The count in the sidebar is asked for again after each decision.
  Rows decided here keep their new status until the filter changes.

  Needs enrollment.approve (the route and every call); deleting a record
  needs enrollment.manage; the link to change the mode needs server.config.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		listDeviceGroups,
		listFolders,
		listTags,
		type DeviceGroup,
		type Folder
	} from '#lib/api/devices.ts';
	import {
		clearRejection,
		deleteLanRegistration,
		getEnrollmentUi,
		listEnrollmentHistory,
		listLanRegistrations,
		listPendingEnrollments
	} from '#lib/api/registrations.ts';
	import {
		SOURCE_ENROLLMENT,
		bySource,
		canDeleteRecord,
		enrollmentMode,
		fromHistory,
		fromLan,
		fromPending,
		mergeRows,
		modeNotice,
		oldest,
		rowActions,
		visibleRows,
		waitingRows,
		type Decided,
		type EnrollmentMode,
		type RequestRow,
		type StatusFilter
	} from '#lib/clients/registrations.ts';
	import { formatNumber, formatRelative } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { loadRegistrationCount, onPanelEvents } from '#lib/shell/live-events.svelte.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Steps from '#lib/ui/Steps.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Version from '#lib/ui/Version.svelte';
	import { copyText } from '#lib/ui/clipboard.svelte.ts';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import RejectDialog from './RejectDialog.svelte';
	import RequestSheet from './RequestSheet.svelte';
	import { around, decidedText, failure, sourceLabel, statusLabel, statusToneOf } from './labels.ts';

	const allowed = can('enrollment.approve');

	/* ── Data ── */

	let rows = $state.raw<RequestRow[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let decided = $state.raw(new Map<string, Decided>());

	let mode = $state<EnrollmentMode>('managed');
	let modeKnown = $state(false);
	let tagPicker = $state(true);

	let loading = false;
	let again = false;

	async function load(): Promise<void> {
		if (!allowed) return;
		if (loading) {
			again = true;
			return;
		}
		loading = true;
		try {
			const [lan, pending, history] = await Promise.allSettled([
				listLanRegistrations(),
				listPendingEnrollments(),
				listEnrollmentHistory()
			]);
			if (lan.status === 'rejected' && pending.status === 'rejected') {
				rows = [];
				loadError = failure(lan.reason, 'registrations.load_failed').message;
				return;
			}
			const list: RequestRow[] = [];
			if (lan.status === 'fulfilled') list.push(...lan.value.map(fromLan));
			if (pending.status === 'fulfilled') list.push(...pending.value.map(fromPending));
			if (history.status === 'fulfilled') list.push(...history.value.map(fromHistory));
			rows = mergeRows(list);
			loadError = null;
		} finally {
			loaded = true;
			loading = false;
			if (again) {
				again = false;
				void load();
			}
		}
	}

	async function loadMode(): Promise<void> {
		if (!allowed) return;
		try {
			const ui = await getEnrollmentUi();
			mode = enrollmentMode(ui.mode);
			tagPicker = ui.tag_picker;
			modeKnown = true;
		} catch {
			/* the mode section stays hidden, the approve form keeps the tag picker */
		}
	}

	$effect(() => {
		untrack(() => {
			void loadMode();
			void load();
		});
	});
	$effect(() => onRefresh(() => void load()));
	// A request arrived or was decided elsewhere
	$effect(() =>
		onPanelEvents((p) => {
			if (p.type === 'registration_pending' || p.type === 'registration_changed') void load();
		})
	);

	/* ── What the approve form needs, once per visit ── */

	let folders = $state.raw<Folder[]>([]);
	let groups = $state.raw<DeviceGroup[]>([]);
	let tags = $state.raw<string[] | null>(null);
	let formDataReady = $state(false);
	let formData: Promise<void> | null = null;

	function loadFormData(): Promise<void> {
		formData ??= Promise.allSettled([listFolders(), listDeviceGroups(), listTags()]).then(([f, g, tg]) => {
			folders = f.status === 'fulfilled' ? f.value : [];
			groups = g.status === 'fulfilled' ? g.value : [];
			tags = tg.status === 'fulfilled' ? tg.value : [];
			formDataReady = true;
		});
		return formData;
	}

	/* ── Filters ── */

	let filter = $state<StatusFilter>('pending');
	let searchInput = $state('');
	let search = $state('');
	$effect(() => {
		const v = searchInput.trim();
		const timer = setTimeout(() => (search = v), 200);
		return () => clearTimeout(timer);
	});

	function setFilter(next: StatusFilter) {
		filter = next;
		decided = new Map();
	}

	const shown = $derived(visibleRows(rows, decided, filter, search));
	const waiting = $derived(waitingRows(rows, decided));
	const sources = $derived(bySource(waiting));
	const waitingRustdesk = $derived(waiting.filter((r) => r.source === SOURCE_ENROLLMENT).length);
	const notice = $derived(modeNotice(mode, waitingRustdesk));

	const countText = $derived.by(() => {
		if (!loaded || loadError) return '';
		let text: string;
		if (!waiting.length) text = t('registrations.count_none');
		else {
			const first = oldest(waiting);
			const age = formatRelative(first?.asked_at, t('common.not_available'));
			text =
				waiting.length === 1
					? t('registrations.count_one', { age })
					: t('registrations.count_many', { count: formatNumber(waiting.length), age });
		}
		if (search || filter !== 'pending')
			text += ' ' + t('registrations.count_shown', { count: formatNumber(shown.length) });
		return text;
	});

	const emptyText = $derived(
		search
			? t('registrations.empty_search')
			: filter === 'pending'
				? t('registrations.empty_pending')
				: filter === 'approved'
					? t('registrations.empty_approved')
					: filter === 'rejected'
						? t('registrations.empty_rejected')
						: t('registrations.empty_all')
	);

	const filterOptions = $derived([
		{ value: 'pending' as const, label: t('registrations.filter_waiting') },
		{ value: 'approved' as const, label: t('registrations.status_approved') },
		{ value: 'rejected' as const, label: t('registrations.status_rejected') },
		{ value: '' as const, label: t('registrations.filter_all') }
	]);

	/* ── Sheet and dialogs ── */

	let sheetFor = $state.raw<RequestRow | null>(null);
	let rejectFor = $state.raw<RequestRow | null>(null);

	async function openSheet(row: RequestRow) {
		sheetFor = row;
		if (row.status === 'pending' && !decided.has(row.key)) await loadFormData();
	}

	function me(): string {
		return session.user?.username ?? '';
	}

	function decide(row: RequestRow, d: Omit<Decided, 'row' | 'decided_at' | 'decided_by'>, hostname?: string) {
		// A new map each time: decided is $state.raw and replaced, never changed in place
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const next = new Map(decided);
		next.set(row.key, {
			...d,
			decided_at: new Date().toISOString(),
			decided_by: me(),
			row: { ...row, hostname: hostname || row.hostname }
		});
		decided = next;
		void loadRegistrationCount().catch(() => {});
		void focusRow(row.key);
	}

	async function focusRow(key: string) {
		await tick();
		const tr = document.querySelector<HTMLElement>(`.registrations-table tr[data-key="${CSS.escape(key)}"]`);
		const target =
			tr?.querySelector<HTMLElement>('td.col-actions .btn') ??
			tr?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
		target?.focus();
	}

	function approved(row: RequestRow, name: string) {
		sheetFor = null;
		decide(row, { status: 'approved' }, name !== row.device_id ? name : undefined);
		toast.success(t('registrations.approved_named', { name }));
	}

	function rejected(row: RequestRow, banned: boolean) {
		rejectFor = null;
		sheetFor = null;
		decide(row, { status: 'rejected', banned });
		toast.success(t('registrations.rejected_named', { name: row.hostname || row.device_id }));
	}

	async function allowAgain(row: RequestRow) {
		const name = row.hostname || row.device_id;
		const ok = await confirm({
			title: t('registrations.allow_again_title'),
			message: t('registrations.allow_again_text', { name }),
			confirmLabel: t('registrations.allow_again')
		});
		if (!ok) return;
		try {
			await clearRejection(row.rowId);
			sheetFor = null;
			toast.success(t('registrations.allow_again_done', { name }));
			void load();
		} catch (err) {
			toast.error(failure(err, 'registrations.allow_again_failed').message);
		}
	}

	async function removeRecord(row: RequestRow) {
		const ok = await confirm({
			title: t('registrations.delete_record_title'),
			message: t('registrations.delete_record_text', { name: row.hostname || row.device_id }),
			confirmLabel: t('registrations.delete_record'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteLanRegistration(row.rowId);
			sheetFor = null;
			// A new map each time: decided is $state.raw and replaced, never changed in place
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const next = new Map(decided);
			next.delete(row.key);
			decided = next;
			toast.success(t('registrations.deleted_success'));
			void load();
		} catch (err) {
			toast.error(failure(err, 'registrations.delete_failed').message);
		}
	}

	async function copyId(row: RequestRow) {
		if (await copyText(row.device_id)) toast.success(t('registrations.id_copied', { id: row.device_id }));
		else toast.error(t('registrations.copy_failed'));
	}

	function openRowDevice(row: RequestRow) {
		sheetFor = null;
		openDevice(row.device_id);
	}

	/* ── Table ── */

	let menuFor = $state<string | null>(null);
	const canManage = $derived(can('enrollment.manage'));

	const columns = $derived<Column<RequestRow>[]>([
		{
			id: 'device',
			label: t('registrations.col_device'),
			cell: deviceCell,
			primary: true,
			class: 'col-device'
		},
		{ id: 'platform', label: t('registrations.col_platform'), cell: platformCell, class: 'col-platform' },
		{ id: 'ip', label: t('registrations.col_ip'), cell: ipCell, class: 'col-ip' },
		{ id: 'source', label: t('registrations.col_source'), cell: sourceCell, class: 'col-source' },
		{ id: 'asked', label: t('registrations.col_asked'), cell: askedCell, class: 'col-asked' },
		{ id: 'status', label: t('registrations.col_status'), cell: statusCell, class: 'col-status' },
		{
			id: 'actions',
			label: t('common.actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions',
			class: 'col-actions'
		}
	]);

	const modeLinkShown = $derived(can('server.config'));

	// Phones: Reject moves from the row into the row menu
	let narrow = $state(false);
	$effect(() => {
		const mq = matchMedia('(max-width: 640px)');
		const set = () => (narrow = mq.matches);
		set();
		mq.addEventListener('change', set);
		return () => mq.removeEventListener('change', set);
	});
</script>

{#snippet deviceCell(r: RequestRow)}{#if r.hostname}<span class="row-name">{r.hostname}</span>{:else}<span
			class="row-name is-missing">{t('registrations.no_name')}</span
		>{/if}<span class="cell-sub mono">{r.device_id}</span>{/snippet}

{#snippet platformCell(r: RequestRow)}<Platform platform={r.platform} />{#if r.version}{@const [pre, post] =
			around(t('registrations.client_version'), '{version}')}<span class="cell-sub"
			>{pre}<Version version={r.version} />{post}</span
		>{/if}{/snippet}

{#snippet ipCell(r: RequestRow)}<ValueCopy
		value={r.ip}
		copy={false}
		empty={t('common.not_available')}
	/>{/snippet}

{#snippet sourceCell(r: RequestRow)}<Tag label={sourceLabel(r)} />{/snippet}

{#snippet askedCell(r: RequestRow)}<Time value={r.asked_at} empty={t('common.not_available')} />{/snippet}

{#snippet statusCell(r: RequestRow)}<Status
		tone={statusToneOf(r.status)}
		label={statusLabel(r.status)}
	/>{#if decidedText(r)}<span class="cell-sub">{decidedText(r)}</span>{/if}{/snippet}

{#snippet actionsCell(r: RequestRow)}
	{@const acts = rowActions(r, decided.has(r.key))}
	{@const name = r.hostname || r.device_id}
	{#if acts.includes('approve')}
		<Button
			size="sm"
			class="act-approve"
			icon={ICONS.approve}
			aria-label="{t('registrations.approve_btn')}: {name}"
			onclick={() => void openSheet(r)}>{t('registrations.approve_btn')}</Button
		>
		<Button
			size="sm"
			variant="danger-quiet"
			class="act-reject wide-only"
			icon={ICONS.reject}
			aria-label="{t('registrations.reject_btn')}: {name}"
			onclick={() => (rejectFor = r)}>{t('registrations.reject_btn')}</Button
		>
	{:else if acts.includes('open')}
		<Button
			size="sm"
			variant="ghost"
			class="act-open"
			aria-label="{t('registrations.open_device')}: {name}"
			onclick={() => openRowDevice(r)}>{t('registrations.open_device')}</Button
		>
	{:else if acts.includes('allow-again')}
		<Button
			size="sm"
			class="act-allow"
			aria-label="{t('registrations.allow_again')}: {name}"
			onclick={() => void allowAgain(r)}>{t('registrations.allow_again')}</Button
		>
	{/if}
	<MenuButton
		kebab
		label="{t('common.actions')}: {name}"
		bind:open={() => menuFor === r.key, (v) => (menuFor = v ? r.key : menuFor === r.key ? null : menuFor)}
	>
		{#if acts.includes('approve') && narrow}
			<MenuItem class="act-reject-menu" icon={ICONS.reject} danger onselect={() => (rejectFor = r)}
				>{t('registrations.reject_btn')}…</MenuItem
			>
		{/if}
		<MenuItem class="act-copy" icon={ICONS.copy} onselect={() => void copyId(r)}
			>{t('registrations.copy_id')}</MenuItem
		>
		{#if canDeleteRecord(r, canManage)}
			<MenuDivider />
			<MenuItem class="act-delete" icon={ICONS.delete} danger onselect={() => void removeRecord(r)}
				>{t('registrations.delete_record')}</MenuItem
			>
		{/if}
	</MenuButton>
{/snippet}

{#snippet modeSentence()}<strong>{t(`tokens.mode_${mode}`)}</strong>. {t(
		`tokens.mode_${mode}_desc`
	)}{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide registrations-page">
		<div class="page-head">
			<h1>{t('nav.registrations')}</h1>
			<p class="page-description">{t('registrations.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				<section class="section" aria-label={t('nav.registrations')}>
					<Toolbar>
						{#snippet search()}<SearchField
								label={t('registrations.search_label')}
								bind:value={searchInput}
							/>{/snippet}
						<SegmentedFilter
							label={t('registrations.col_status')}
							options={filterOptions}
							value={filter}
							onchange={setFilter}
						/>
					</Toolbar>
					<p class="count-line" aria-live="polite">{countText}</p>

					<div class="registrations-table">
						<Table
							rows={shown}
							{columns}
							key={(r) => r.key}
							label={t('nav.registrations')}
							onrowclick={(r) => void openSheet(r)}
							rowClass={(r) => `is-${r.status}`}
							loading={!loaded}
							loadingText={t('registrations.loading')}
							error={loadError}
							onretry={() => void load()}
							{emptyText}
						/>
					</div>
				</section>
			</div>

			<aside class="page-side" aria-label={t('registrations.side_label')}>
				{#if modeKnown}
					<section class="section reg-mode" aria-labelledby="reg-mode-title">
						<div class="section-head"><h2 id="reg-mode-title">{t('tokens.enrollment_mode')}</h2></div>
						<p class="reg-mode-current">{@render modeSentence()}</p>
						{#if notice}
							<p class="reg-mode-notice">
								{t(`registrations.mode_${notice}_pending`, { count: formatNumber(waitingRustdesk) })}
								{#if !modeLinkShown}{t('registrations.mode_admin_only')}{/if}
							</p>
						{/if}
						{#if modeLinkShown}
							<p><a href={link('/settings#auth')}>{t('registrations.mode_link')}</a></p>
						{/if}
					</section>
				{/if}

				{#if loaded && !loadError && waiting.length}
					<section class="section" aria-labelledby="reg-sources-title">
						<div class="section-head"><h2 id="reg-sources-title">{t('registrations.sources_title')}</h2></div>
						<div class="reg-sources">
							<Facts
								items={[
									{ label: t('registrations.source_rustdesk'), value: formatNumber(sources.rustdesk) },
									{ label: t('registrations.source_lan'), value: formatNumber(sources.lan) }
								]}
							/>
						</div>
					</section>
				{/if}

				<section class="section" aria-labelledby="reg-steps-title">
					<div class="section-head"><h2 id="reg-steps-title">{t('registrations.steps_title')}</h2></div>
					<Steps
						items={[
							t('registrations.step_check'),
							t('registrations.step_approve'),
							t('registrations.step_after'),
							t('registrations.step_reject')
						]}
					/>
				</section>
			</aside>
		</div>
	</div>
{/if}

{#if sheetFor}
	{@const row = sheetFor}
	<RequestSheet
		{row}
		decidedHere={decided.has(row.key)}
		{folders}
		{groups}
		{tags}
		{tagPicker}
		ready={formDataReady}
		onclose={() => (sheetFor = null)}
		onapproved={(name) => approved(row, name)}
		onreject={() => (rejectFor = row)}
		onopen={() => openRowDevice(row)}
		onallow={() => void allowAgain(row)}
		ondelete={() => void removeRecord(row)}
	/>
{/if}

{#if rejectFor}
	{@const row = rejectFor}
	<RejectDialog {row} onclose={() => (rejectFor = null)} onrejected={(banned) => rejected(row, banned)} />
{/if}

<style>
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}
	.row-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.row-name.is-missing {
		color: var(--text-muted);
		font-weight: 400;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.registrations-table :global(td.col-asked),
	.registrations-table :global(td.col-source) {
		white-space: nowrap;
	}
	.registrations-table :global(td.col-asked) {
		color: var(--text-muted);
	}
	.reg-mode p {
		margin: 0;
		max-width: var(--measure);
	}
	/* Short label, number at the end */
	.reg-sources :global(.facts) {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.reg-sources :global(.facts > dd) {
		justify-content: flex-end;
		font-variant-numeric: tabular-nums;
	}

	/* With the side column beside the table, the address and the queue name
	   leave the row (both are in the request's sheet, and the side column
	   counts the queues); also on medium widths */
	@media (min-width: 1200px) and (max-width: 1599px), (max-width: 1100px) {
		.registrations-table :global(.col-ip),
		.registrations-table :global(.col-source) {
			display: none;
		}
	}

	/* Phone: each request is a block with the name, ID, platform and age, and
	   Approve at the end. Reject moves into the row menu. */
	@media (max-width: 640px) {
		.registrations-table :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.registrations-table :global(table),
		.registrations-table :global(tbody) {
			display: block;
		}
		.registrations-table :global(tbody tr:not(.state-row)) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: center;
			gap: 2px var(--space-2);
			padding: var(--row-pad-y) var(--row-pad-x);
			border-bottom: 1px solid var(--rule);
		}
		.registrations-table :global(tbody tr:not(.state-row) > :is(td, th)) {
			display: none;
			height: auto;
			padding: 0;
			border: 0;
			background: transparent;
		}
		.registrations-table :global(tbody tr:not(.state-row) > .col-device) {
			display: block;
			grid-column: 1;
			grid-row: 1;
		}
		.registrations-table :global(tbody tr:not(.state-row) > .col-platform) {
			display: block;
			grid-column: 1;
			grid-row: 2;
			color: var(--text-muted);
		}
		.registrations-table :global(tbody tr:not(.state-row) > .col-platform .cell-sub) {
			display: none;
		}
		.registrations-table :global(tbody tr:not(.state-row) > .col-asked) {
			display: block;
			grid-column: 1;
			grid-row: 3;
		}
		.registrations-table :global(tbody tr:not(.is-pending) > .col-status) {
			display: flex;
			flex-wrap: wrap;
			gap: 0 var(--space-2);
			grid-column: 1;
			grid-row: 4;
		}
		.registrations-table :global(tbody tr:not(.state-row) > .col-actions) {
			display: flex;
			align-items: center;
			grid-column: 2;
			grid-row: 1 / span 4;
		}
		.registrations-table :global(tbody tr:not(.state-row):hover > :is(td, th)) {
			background: transparent;
		}
		.registrations-table :global(.wide-only) {
			display: none;
		}
	}
	/* Touch: the request's name button gets a 44 px hit area */
	@media (pointer: coarse) {
		.registrations-table :global(.row-open) {
			min-height: 44px;
		}
	}
</style>
