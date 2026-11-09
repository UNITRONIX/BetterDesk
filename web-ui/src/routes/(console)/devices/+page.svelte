<!--
  The device list (/devices). The list is the page: folders and groups
  beside it filter it, the toolbar above it searches and narrows it, and a
  click anywhere on a row opens the device panel. Access rules are folded
  under it.

  Data: GET /api/devices returns every device the user may see; search,
  filters and sorting run here on that list. One request per refresh: on
  load, every 60 s while the tab is visible (poll), after an action
  (deviceChanges), and on "Show deleted". Status changes arrive on
  /ws/device-status and are merged into the list in batches.

  URL: ?open=<id> opens the panel and follows the open device (lib/devices/url.ts);
  ?search= fills the search; ?status=online|offline|banned|mesh_agent picks the status filter.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { pushState, replaceState } from '$app/navigation';
	import {
		deleteDeviceGroup,
		deleteFolder,
		listDeviceGroups,
		listDevices,
		listFolders,
		listTags,
		setDeviceGroups,
		syncStatus,
		type Device,
		type DeviceGroup,
		type Folder
	} from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import * as act from '#lib/devices/actions.svelte.ts';
	import { deviceChanges, deviceMenu, devicesChanged } from '#lib/devices/actions.svelte.ts';
	import { preloadDialogs } from '#lib/devices/ask.svelte.ts';
	import { applyStatuses, parseLiveMessage } from '#lib/devices/live.ts';
	import {
		countDevices,
		deviceName,
		deviceState,
		filterDevices,
		isFiltered,
		isStatusFilter,
		lastSeenValue,
		searchText,
		stateLabelKey,
		stateTone,
		typeLabel,
		type Filters,
		type Scope,
		type StatusFilter
	} from '#lib/devices/model.ts';
	import { OPEN_PARAM, panelToUrl, urlToPanel, withOpen } from '#lib/devices/url.ts';
	import { closeDevice, devicePanel, openDevice, refreshDevice } from '#lib/state/devicePanel.svelte.ts';
	import { poll, socket } from '#lib/state/live.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ColumnChooser from '#lib/ui/ColumnChooser.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import OsIcon from '#lib/ui/OsIcon.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import TagSet from '#lib/ui/TagSet.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column, SortState } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import { readJsonPref, readPref, writeJsonPref, writePref } from '#lib/util/storage.ts';
	import AccessRules from './AccessRules.svelte';
	import FolderDialog from './FolderDialog.svelte';
	import GroupBillingSheet from './GroupBillingSheet.svelte';
	import GroupSheet from './GroupSheet.svelte';
	import ManageTagsSheet from './ManageTagsSheet.svelte';
	import ScopeList, { type DropTarget } from './ScopeList.svelte';
	import TagFilter from './TagFilter.svelte';

	/** Same storage keys as the old page, so switching back and forth keeps the choices */
	const PREF_DELETED = 'bd_devices_show_deleted';
	const PREF_COLUMNS = 'devices-visible-columns';
	/** Above this many rows the table renders only what is on screen, rows stay one line high */
	const LONG = 200;

	/* ── Data ── */

	let devices = $state.raw<Device[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let folders = $state.raw<Folder[]>([]);
	let groups = $state.raw<DeviceGroup[]>([]);
	let knownTags = $state.raw<string[]>([]);
	let syncing = $state(false);

	let showDeleted = $state(readPref(PREF_DELETED) === '1');

	let inflight: AbortController | null = null;

	async function loadDevices(): Promise<void> {
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		try {
			const list = await listDevices({ includeDeleted: showDeleted }, ctrl.signal);
			if (inflight !== ctrl) return;
			performance.mark('devices:data');
			devices = list;
			loadError = null;
			loaded = true;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			loaded = true;
			loadError = err instanceof Error && err.message ? err.message : t('errors.load_devices_failed');
			throw err;
		}
	}

	const quiet = (p: Promise<unknown>) => p.catch(() => undefined);
	const loadFolders = () => quiet(listFolders().then((f) => (folders = f)));
	const loadGroups = () => quiet(listDeviceGroups().then((g) => (groups = g)));
	const loadTags = () => quiet(listTags().then((x) => (knownTags = x)));

	// The list: now, every 60 s while the tab is visible, once when it is shown again
	$effect(() => poll(loadDevices, { every: 60_000 }));
	// What filters and menus need, in parallel with the list
	$effect(() => {
		untrack(() => {
			void loadFolders();
			void loadGroups();
			void loadTags();
		});
	});

	// After an action (here or in the panel): the list again
	let seenRevision = untrack(() => deviceChanges.revision);
	$effect(() => {
		const r = deviceChanges.revision;
		if (r === seenRevision) return;
		seenRevision = r;
		untrack(() => {
			void quiet(loadDevices());
			void loadTags();
		});
	});

	// Status pushes, applied in batches of 250 ms
	$effect(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a buffer, flushed into the list
		const pending = new Map<string, string>();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const flush = () => {
			timer = null;
			const next = applyStatuses(devices, pending);
			pending.clear();
			if (next !== devices) devices = next as Device[];
		};
		const sock = socket('/ws/device-status', {
			onmessage: (data) => {
				const m = parseLiveMessage(data);
				if (!m) return;
				if (m.kind === 'status') {
					pending.set(m.id, m.status);
					timer ??= setTimeout(flush, 250);
					if (devicePanel.id === m.id) refreshDevice(m.id);
				} else {
					// The open device got a new ID: follow it
					if (devicePanel.id === m.oldId) openDevice(m.newId);
					void quiet(loadDevices());
				}
			}
		});
		return () => {
			sock.close();
			if (timer) clearTimeout(timer);
		};
	});

	/* ── Filters ── */

	const urlParams = untrack(() => page.url.searchParams);
	let searchInput = $state(urlParams.get('search')?.trim() ?? '');
	let query = $state(untrack(() => searchInput));
	let status = $state<StatusFilter>(
		isStatusFilter(urlParams.get('status')) ? (urlParams.get('status') as StatusFilter) : 'all'
	);
	let scope = $state.raw<Scope>({ kind: 'all' });
	let tagFilter = $state.raw<string[]>([]);
	let sort = $state<SortState | null>({ column: 'last_online', dir: 'desc' });
	let selection = $state.raw(new Set<string>());

	// Typing stays instant; the list follows a moment later (sooner for short lists)
	$effect(() => {
		const v = searchInput.trim();
		if (v === untrack(() => query)) return;
		const wait = untrack(() => devices.length) > 1000 ? 150 : 50;
		const timer = setTimeout(() => (query = v), wait);
		return () => clearTimeout(timer);
	});

	// Search text per device, built once per loaded device (not per keystroke)
	const textCache = new WeakMap<Device, string>();
	function textOf(d: Device): string {
		let s = textCache.get(d);
		if (s === undefined) {
			s = searchText(d);
			textCache.set(d, s);
		}
		return s;
	}

	const filters = $derived<Filters>({ query, status, scope, tags: tagFilter, showDeleted });
	const filtered = $derived(filterDevices(devices, filters, groups, textOf));
	const counts = $derived(countDevices(devices, folders, groups));
	const liveCount = $derived(devices.reduce((n, d) => n + (d.soft_deleted ? 0 : 1), 0));
	const long = $derived(filtered.length > LONG);

	function setShowDeleted(on: boolean) {
		showDeleted = on;
		writePref(PREF_DELETED, on ? '1' : '0');
		void quiet(loadDevices());
	}

	// A folder or group that is gone (deleted elsewhere) stops filtering
	$effect(() => {
		const s = scope;
		if (s.kind === 'folder' && folders.length && !folders.some((f) => f.id === s.id)) scope = { kind: 'all' };
		if (s.kind === 'group' && groups.length && !groups.some((g) => g.guid === s.guid))
			scope = { kind: 'all' };
	});

	/* ── The open device in the URL ── */

	type PanelState = { devicesOpen?: string };
	const urlOpen = $derived(page.url.searchParams.get(OPEN_PARAM) || null);
	let lastPanelId: string | null = null;

	// The URL changed (deep link, Back, Forward): open or close the panel
	$effect(() => {
		const open = urlOpen;
		untrack(() => {
			const step = urlToPanel(open, devicePanel.id);
			if (step?.do === 'open') openDevice(step.id);
			else if (step?.do === 'close') closeDevice();
			lastPanelId = devicePanel.id;
		});
	});

	// The open device changed: the URL follows (Back closes the panel)
	$effect(() => {
		const id = devicePanel.id;
		untrack(() => {
			if (id === lastPanelId) return;
			lastPanelId = id;
			const pushed = !!(page.state as PanelState).devicesOpen;
			const step = panelToUrl(urlOpen, id, pushed);
			if (!step) return;
			// This page's own URL with ?open= changed: resolve() is for route paths
			const next = withOpen(page.url, step.do === 'back' ? null : step.id);
			const state: PanelState =
				step.do !== 'back' && step.id && (step.do === 'push' || pushed) ? { devicesOpen: step.id } : {};
			/* eslint-disable svelte/no-navigation-without-resolve */
			if (step.do === 'push') pushState(next, state);
			else if (step.do === 'replace') replaceState(next, state);
			else history.back();
			/* eslint-enable svelte/no-navigation-without-resolve */
		});
	});

	// Leaving the page closes the panel the page opened
	$effect(() => () => {
		if (devicePanel.id && untrack(() => urlOpen)) closeDevice();
	});

	/* ── Columns ── */

	let hiddenColumns = $state<string[]>(
		readJsonPref<string[]>(PREF_COLUMNS, []).filter((x) => typeof x === 'string')
	);

	function setColumn(id: string, visible: boolean) {
		hiddenColumns = visible
			? hiddenColumns.filter((c) => c !== id)
			: [...hiddenColumns.filter((c) => c !== id), id];
		writeJsonPref(PREF_COLUMNS, hiddenColumns);
	}

	const shown = (id: string) => !hiddenColumns.includes(id);

	const columns = $derived<Column<Device>[]>([
		{ id: 'id', label: t('devices.id'), cell: idCell, sortValue: (d) => d.id, class: 'col-id' },
		{
			id: 'hostname',
			label: t('devices.hostname'),
			cell: nameCell,
			primary: true,
			sortValue: (d) => deviceName(d).toLowerCase(),
			class: 'col-name'
		},
		{
			id: 'device_type',
			label: t('devices.device_type'),
			cell: typeCell,
			sortValue: (d) => d.device_type,
			hideable: true,
			visible: shown('device_type'),
			class: 'col-type'
		},
		{
			id: 'platform',
			label: t('devices.platform'),
			cell: platformCell,
			sortValue: (d) => d.platform || d.os,
			hideable: true,
			visible: shown('platform'),
			class: 'col-platform'
		},
		{
			id: 'last_online',
			label: t('devices.last_seen'),
			cell: seenCell,
			sortValue: lastSeenValue,
			hideable: true,
			visible: shown('last_online'),
			class: 'col-seen'
		},
		{
			id: 'status',
			label: t('devices.status'),
			cell: statusCell,
			hideable: true,
			visible: shown('status'),
			class: 'col-status'
		},
		{
			id: 'tags',
			label: t('devices.tags'),
			cell: tagsCell,
			hideable: true,
			visible: shown('tags'),
			class: 'col-tags'
		},
		{
			id: 'actions',
			label: t('devices.actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions',
			class: 'col-actions'
		}
	]);

	/* ── Rows ── */

	/** The row whose menu is open (also opened by a right-click on the row) */
	let rowMenuFor = $state<string | null>(null);

	function rowClass(d: Device) {
		return [
			d.banned && 'banned-row',
			d.soft_deleted && 'deleted-row',
			!d.tags?.length && 'no-tags',
			dragId === d.id && 'dragging'
		];
	}

	function onRowContextMenu(e: MouseEvent) {
		const el = e.target instanceof Element ? e.target : null;
		if (!el || el.closest('.copy-btn, .menu-anchor, [role="menu"]')) return;
		const tr = el.closest<HTMLElement>('tr[data-key]');
		if (!tr?.dataset.key) return;
		e.preventDefault();
		rowMenuFor = tr.dataset.key;
	}

	/* ── Selection and bulk actions ── */

	const canEdit = $derived(can('device.edit'));
	const canDelete = $derived(can('device.delete'));
	const canGuest = $derived(can('guest.create'));
	const selectable = $derived(canEdit || canDelete || canGuest);
	const selected = $derived(selection.size ? filtered.filter((d) => selection.has(d.id)) : []);
	const selectedLive = $derived(selected.filter((d) => !d.soft_deleted && !d.remote_target));

	function clearSelection() {
		selection = new Set();
	}

	async function bulk(run: (list: Device[]) => Promise<boolean>) {
		if (await run(selectedLive)) clearSelection();
	}

	/* ── Drag a row onto a folder or group ── */

	let dragId = $state<string | null>(null);
	const canDrag = $derived(
		canEdit && !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
	);
	let dragImage: HTMLElement | null = $state(null);
	let dragDevice = $state.raw<Device | null>(null);
	const BLANK = typeof Image !== 'undefined' ? new Image() : null;
	if (BLANK) BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

	function rowFor(el: EventTarget | null): HTMLElement | null {
		return el instanceof Element ? el.closest<HTMLElement>('tbody tr[data-key]') : null;
	}

	// The row becomes draggable when the pointer comes onto it (not over its
	// controls): the browser decides at mousedown whether a drag can start
	function onPointerOver(e: PointerEvent) {
		if (!canDrag || e.pointerType === 'touch') return;
		const tr = rowFor(e.target);
		if (!tr) return;
		const d = devices.find((x) => x.id === tr.dataset.key);
		tr.draggable =
			!!d && !d.soft_deleted && !(e.target as Element).closest('button, a, input, label, [role="menu"]');
	}

	function onDragStart(e: DragEvent) {
		const tr = rowFor(e.target);
		const d = tr ? devices.find((x) => x.id === tr.dataset.key) : undefined;
		if (!tr || !d || !e.dataTransfer) return;
		dragId = d.id;
		dragDevice = d;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', d.id);
		if (BLANK && typeof e.dataTransfer.setDragImage === 'function') e.dataTransfer.setDragImage(BLANK, 0, 0);
		moveDragImage(e.clientX, e.clientY);
	}

	function moveDragImage(x: number, y: number) {
		if (!dragImage || (x === 0 && y === 0)) return;
		const rtl = getComputedStyle(dragImage).direction === 'rtl';
		const left = rtl ? x - dragImage.offsetWidth - 12 : x + 12;
		dragImage.style.transform = `translate(${Math.round(left)}px, ${Math.round(y + 12)}px)`;
		dragImage.hidden = false;
	}

	function endDrag() {
		dragId = null;
		dragDevice = null;
		document
			.querySelectorAll<HTMLElement>('tbody tr[draggable="true"]')
			.forEach((tr) => (tr.draggable = false));
	}

	// While dragging: the preview follows the pointer, the page scrolls near its edges
	$effect(() => {
		if (!dragId) return;
		let y: number | null = null;
		let raf = 0;
		const over = (e: DragEvent) => {
			y = e.clientY;
			moveDragImage(e.clientX, e.clientY);
		};
		const tickScroll = () => {
			raf = requestAnimationFrame(tickScroll);
			if (y === null) return;
			const edge = 56;
			const speed = (depth: number) => 4 + Math.min(1, Math.max(0, depth / edge)) * 16;
			if (y < edge) window.scrollBy(0, -speed(edge - y));
			else if (y > window.innerHeight - edge) window.scrollBy(0, speed(y - (window.innerHeight - edge)));
		};
		document.addEventListener('dragover', over, true);
		raf = requestAnimationFrame(tickScroll);
		return () => {
			document.removeEventListener('dragover', over, true);
			cancelAnimationFrame(raf);
		};
	});

	async function onDrop(target: DropTarget, id: string) {
		endDrag();
		const d = devices.find((x) => x.id === id);
		if (!d) return;
		if (target.kind === 'folder') await act.moveToFolder([d], target.id);
		else if (target.kind === 'unassigned') await act.moveToFolder([d], null);
		else await dropOnGroup(d, target);
	}

	/** A device is in at most one manual group: dropping on one replaces it; "All groups" takes it out of the open one */
	async function dropOnGroup(d: Device, target: DropTarget) {
		const manual = (d.groups ?? [])
			.filter((g) => (g.source_type || 'manual') !== 'tag')
			.map((g) => g.guid ?? '');
		try {
			if (target.kind === 'all-groups') {
				if (scope.kind !== 'group') return;
				const open = scope.guid;
				if (!manual.includes(open)) return;
				await setDeviceGroups(
					d.id,
					manual.filter((g) => g !== open)
				);
				toast.success(t('devices.group_membership_removed'));
			} else if (target.kind === 'group') {
				if (manual.length === 1 && manual[0] === target.guid) return;
				await setDeviceGroups(d.id, [target.guid]);
				toast.success(t('devices.group_membership_added'));
			}
			devicesChanged(d.id);
			void loadGroups();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		}
	}

	/* ── Page actions, folders, groups, tags ── */

	async function sync() {
		if (syncing) return;
		syncing = true;
		try {
			await syncStatus();
			toast.success(t('devices.sync_success'));
			await quiet(loadDevices());
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.sync_failed'));
		} finally {
			syncing = false;
		}
	}

	let folderDialog = $state<{ folder: Folder | null } | null>(null);
	let groupSheet = $state<{ group: DeviceGroup | null } | null>(null);
	let billingFor = $state.raw<DeviceGroup | null>(null);
	let manageTags = $state(false);

	async function removeFolder(f: Folder) {
		const ok = await confirm({
			title: t('folders.delete'),
			message: t('folders.delete_confirm'),
			confirmLabel: t('actions.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteFolder(f.id);
			toast.success(t('folders.delete_success'));
			if (scope.kind === 'folder' && scope.id === f.id) scope = { kind: 'all' };
			void loadFolders();
			devicesChanged();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		}
	}

	async function removeGroup(g: DeviceGroup) {
		const ok = await confirm({
			title: t('devices.delete_group'),
			message: t('devices.delete_group_confirm').replace('{name}', g.name ?? ''),
			confirmLabel: t('actions.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteDeviceGroup(g.guid ?? '');
			toast.success(t('devices.group_deleted'));
			if (scope.kind === 'group' && scope.guid === g.guid) scope = { kind: 'all' };
			void loadGroups();
			devicesChanged();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		}
	}

	/* ── Speed check: first rows on screen after the data arrived ── */

	$effect(() => {
		if (!loaded || !devices.length) return;
		// The row menu's dialogs, fetched while nobody needs them yet
		const idle = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 200));
		idle(() => preloadDialogs());
		void tick().then(() =>
			requestAnimationFrame(() => {
				performance.mark('devices:rows');
				try {
					performance.measure('devices:render', 'devices:data', 'devices:rows');
				} catch {
					/* no data mark yet */
				}
			})
		);
	});

	const statusOptions = $derived([
		{ value: 'all' as const, label: t('devices.filter_all') },
		{ value: 'online' as const, label: t('devices.filter_online') },
		{ value: 'offline' as const, label: t('devices.filter_offline') },
		{ value: 'mesh_agent' as const, label: t('mesh.filter_mesh') },
		{ value: 'banned' as const, label: t('devices.filter_banned') }
	]);
</script>

{#snippet idCell(d: Device)}<ValueCopy value={d.id} />{/snippet}

{#snippet nameCell(d: Device)}<span class="device-name">{deviceName(d) || '–'}</span>{#if d.soft_deleted}<span
			class="row-note">{t('devices.deleted_badge')}</span
		>{/if}{/snippet}

{#snippet typeCell(d: Device)}{#if d.device_type}<Tag label={typeLabel(d.device_type, t)} />{:else}<Empty
		/>{/if}{#if d.linked_peer_id}<span class="row-note" title={tf('mesh.linked_peer', 'Linked device')}
			><span aria-hidden="true">↔</span>
			<span class="sr-only">{tf('mesh.linked_peer', 'Linked device')}:</span>
			<span class="mono">{d.linked_peer_id}</span></span
		>{/if}{/snippet}

{#snippet platformCell(d: Device)}<Platform platform={d.platform || d.os} />{/snippet}

{#snippet seenCell(d: Device)}<Time value={d.last_online} empty={t('time.never')} />{/snippet}

{#snippet statusCell(d: Device)}{@const s = deviceState(d)}<Status
		tone={stateTone(s)}
		label={t(stateLabelKey(s))}
		title={s === 'no_signal' ? t('devices.no_signal_tooltip') : undefined}
	/>{/snippet}

{#snippet tagsCell(d: Device)}<span class="tags-cell"><TagSet tags={d.tags} /></span>{/snippet}

{#snippet actionsCell(d: Device)}<MenuButton
		kebab
		label="{t('devices.actions')}: {deviceName(d) || d.id}"
		bind:open={
			() => rowMenuFor === d.id, (v) => (rowMenuFor = v ? d.id : rowMenuFor === d.id ? null : rowMenuFor)
		}
	>
		{#each deviceMenu(d, { knownTags }) as group, gi (gi)}
			{#if gi > 0}<MenuDivider />{/if}
			{#each group as item (item.id)}
				<MenuItem class="act-{item.id}" icon={item.icon} danger={item.danger} onselect={() => void item.run()}
					>{item.label}</MenuItem
				>
			{/each}
		{/each}
	</MenuButton>{/snippet}

<div class="page page-wide devices-page">
	<div class="page-head">
		<h1>{t('devices.title')}</h1>
		<div class="page-meta" aria-live="polite">
			{#if loaded && !loadError}
				<CountLine text={t('devices.summary')} values={{ count: liveCount, online: counts.online }} />
			{/if}
		</div>
		<div class="page-actions">
			<Button class="sync-btn" icon={ICONS.refresh} busy={syncing} onclick={sync}
				>{t('devices.sync_status')}</Button
			>
			{#if can('remote_target.edit')}
				<Button
					class="add-target-btn"
					variant="primary"
					icon={ICONS.add}
					onclick={() => void act.addRemoteTarget()}>{t('devices.add_remote_target')}</Button
				>
			{/if}
		</div>
	</div>

	<div class="devices-layout">
		<div class="devices-toolbar">
			<div class="toolbar-search">
				<SearchField label={t('devices.search_placeholder')} bind:value={searchInput} />
			</div>
			<div class="status-filter">
				<SegmentedFilter label={t('devices.status')} options={statusOptions} bind:value={status} />
			</div>
			<div class="toolbar-end">
				<Checkbox
					inline
					class="show-deleted"
					label={t('devices.show_deleted')}
					checked={showDeleted}
					onchange={(e) => setShowDeleted((e.currentTarget as HTMLInputElement).checked)}
				/>
				<TagFilter
					tags={knownTags}
					selected={tagFilter}
					onchange={(next) => (tagFilter = next)}
					onmanage={canEdit ? () => (manageTags = true) : undefined}
				/>
				<ColumnChooser {columns} onchange={setColumn} label={t('devices.columns')} />
			</div>
		</div>

		<aside class="devices-filters">
			<ScopeList
				{folders}
				{groups}
				{counts}
				{scope}
				canManage={canEdit}
				canBilling={can('billing.manage')}
				dragging={!!dragId}
				onscope={(s) => (scope = s)}
				onnewfolder={() => (folderDialog = { folder: null })}
				oneditfolder={(f) => (folderDialog = { folder: f })}
				ondeletefolder={removeFolder}
				onnewgroup={() => (groupSheet = { group: null })}
				oneditgroup={(g) => (groupSheet = { group: g })}
				ondeletegroup={removeGroup}
				onbilling={(g) => (billingFor = g)}
				ondrop={onDrop}
			/>
		</aside>

		<section class="devices-list" aria-label={t('devices.title')}>
			{#if selected.length || (loaded && isFiltered(filters))}
				<div class="list-head" role="status">
					{#if selected.length}
						<CountLine
							text={tf('devices.selected_count', '{count} selected')}
							values={{ count: selected.length }}
						/>
						<div class="bulk">
							{#if canEdit}
								<Button
									class="bulk-tags"
									size="sm"
									icon={ICONS.tags}
									disabled={!selectedLive.length}
									onclick={() => bulk((l) => act.tagDevices(l, knownTags))}>{t('devices.tags')}</Button
								>
								<Button
									class="bulk-folder"
									size="sm"
									icon={ICONS.folder}
									disabled={!selectedLive.length}
									onclick={() => bulk(act.chooseFolder)}
									>{tf('devices.move_to_folder', 'Move to folder')}</Button
								>
							{/if}
							{#if canGuest}
								<Button
									class="bulk-guest"
									size="sm"
									icon={ICONS.guest_link}
									disabled={!selectedLive.length}
									onclick={() => bulk(act.createGuestLink)}>{t('guest_access.menu')}</Button
								>
							{/if}
							{#if canDelete}
								<Button
									class="bulk-delete"
									size="sm"
									variant="danger-quiet"
									icon={ICONS.delete}
									disabled={!selectedLive.length}
									onclick={() => bulk(act.deleteDevices)}>{t('actions.delete')}</Button
								>
							{/if}
							<Button class="bulk-clear" size="sm" variant="ghost" onclick={clearSelection}
								>{tf('devices.clear_selection', 'Clear selection')}</Button
							>
						</div>
					{:else}
						<CountLine
							text={tf('devices.showing_count', 'Showing {shown} of {total}')}
							values={{ shown: filtered.length, total: showDeleted ? devices.length : liveCount }}
						/>
					{/if}
				</div>
			{/if}

			<!-- Mouse conveniences (drag, right-click); keyboard users have the row menu and the panel -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class={['devices-table', long && 'is-long', shown('tags') && 'has-tags']}
				onpointerover={onPointerOver}
				ondragstart={onDragStart}
				ondragend={endDrag}
				oncontextmenu={onRowContextMenu}
			>
				<Table
					rows={filtered}
					{columns}
					key={(d) => d.id}
					label={t('devices.title')}
					bind:sort
					{selectable}
					bind:selection
					selectLabel={(d) => t('table.select_row', { name: deviceName(d) || d.id })}
					onrowclick={(d) => openDevice(d.id)}
					{rowClass}
					loading={!loaded}
					error={loadError && !devices.length ? loadError : null}
					onretry={() => void quiet(loadDevices())}
					emptyText={devices.length ? t('devices.empty_text') : t('devices.empty_title')}
					virtualThreshold={LONG}
					height={long ? 'max(24rem, calc(100dvh - var(--topbar-h, 56px) - 12rem))' : undefined}
				/>
			</div>
		</section>
	</div>

	<AccessRules {groups} {devices} />
</div>

{#if dragDevice}
	<div class="drag-image" bind:this={dragImage} aria-hidden="true" hidden>
		<span class="drag-box">
			<OsIcon platform={dragDevice.platform || dragDevice.os} />
			<span class="drag-text">
				{#if deviceName(dragDevice)}<span class="drag-name">{deviceName(dragDevice)}</span>{/if}
				<span class="drag-id mono">{dragDevice.id}</span>
			</span>
		</span>
	</div>
{/if}

{#if folderDialog}
	<FolderDialog
		folder={folderDialog.folder}
		onclose={() => (folderDialog = null)}
		onsaved={() => {
			folderDialog = null;
			void loadFolders();
		}}
	/>
{/if}

{#if groupSheet}
	<GroupSheet
		group={groupSheet.group}
		tags={knownTags}
		onclose={() => (groupSheet = null)}
		onsaved={() => {
			groupSheet = null;
			void loadGroups();
		}}
	/>
{/if}

{#if billingFor}
	<GroupBillingSheet group={billingFor} onclose={() => (billingFor = null)} />
{/if}

{#if manageTags}
	<ManageTagsSheet
		tags={knownTags}
		{devices}
		{groups}
		onclose={() => (manageTags = false)}
		onchanged={async (from, to) => {
			if (from && tagFilter.includes(from))
				tagFilter = to ? tagFilter.map((x) => (x === from ? to : x)) : tagFilter.filter((x) => x !== from);
			await Promise.all([loadTags(), loadGroups(), quiet(loadDevices())]);
		}}
	/>
{/if}

<style>
	/* The count sits right after the title; the page's buttons stay at the end */
	.devices-page .page-head h1 {
		margin-inline-end: 0;
	}
	.devices-page .page-head .page-meta {
		margin-inline-end: auto;
	}

	.devices-layout {
		display: grid;
		grid-template-columns: 200px minmax(0, 1fr);
		grid-template-areas:
			'. toolbar'
			'filters list';
		gap: 0 var(--space-6);
		align-items: start;
	}
	.devices-toolbar {
		grid-area: toolbar;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		min-width: 0;
		margin-bottom: var(--space-3);
	}
	.toolbar-search {
		flex: 1 1 200px;
		min-width: 0;
		max-width: 360px;
	}
	.status-filter {
		min-width: 0;
		max-width: 100%;
	}
	/* Phones: the five status buttons stay on one line */
	@media (max-width: 480px) {
		.status-filter {
			--control-pad-x: var(--space-2);
		}
	}
	.toolbar-end {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-inline-start: auto;
	}
	/* Folders start on the table's header line: "Folders" lines up with the column headings */
	.devices-filters {
		grid-area: filters;
		position: sticky;
		top: calc(var(--topbar-h, 56px) + var(--space-4));
		max-height: calc(100vh - var(--topbar-h, 56px) - var(--space-6));
		overflow-y: auto;
		min-width: 0;
	}
	.devices-list {
		grid-area: list;
		min-width: 0;
		container: devlist / inline-size;
	}
	.list-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		min-height: var(--control-h-sm);
		margin-bottom: var(--space-2);
	}
	.bulk {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* ── Table cells ── */

	/* Wide: every column fits its content; tags take what is left, so the
	   row menu ends at the table's edge. Without tags the name takes the rest. */
	@container devlist (min-width: 601px) {
		.devices-table :global(:is(th, td).col-id),
		.devices-table :global(:is(th, td).col-type),
		.devices-table :global(:is(th, td).col-seen),
		.devices-table :global(:is(th, td).col-status),
		.devices-table :global(:is(th, td).col-actions) {
			width: 1%;
			white-space: nowrap;
		}
		.devices-table :global(:is(th, td).col-name) {
			white-space: nowrap;
		}
		.devices-table.has-tags :global(:is(th, td).col-name) {
			width: 1%;
		}
		.devices-table :global(tbody th.col-name) {
			max-width: 280px;
		}
		/* Platform has a fixed width: short names stay on one line, long ones
		   ("Linux 6.6 (Raspberry Pi)") wrap; an older date in Last seen wraps
		   after its comma. A long list keeps every row on one line instead. */
		.devices-table :global(:is(th, td).col-platform) {
			width: 10.5rem;
		}
		.devices-table:not(.is-long) :global(td.col-platform .platform),
		.devices-table:not(.is-long) :global(td.col-seen),
		.devices-table:not(.is-long) :global(td.col-seen .time) {
			white-space: normal;
		}
		.devices-table :global(td.col-tags) {
			min-width: 6.5rem;
			max-width: 0;
		}
	}
	.devices-table :global(td.col-seen),
	.devices-table :global(td.col-type) {
		color: var(--text-muted);
	}
	.device-name {
		font-weight: 600;
	}
	.row-note {
		margin-inline-start: var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.tags-cell {
		display: block;
		min-width: 0;
	}
	.tags-cell :global(.tag-set) {
		display: flex;
		flex-wrap: wrap;
	}
	.tags-cell :global(.tag) {
		min-width: 0;
	}
	.devices-table :global(tr.deleted-row > :is(td, th)) {
		color: var(--text-muted);
	}
	.devices-table :global(tr.dragging) {
		opacity: 0.5;
	}

	/* A long list: every row one line high, so the table can render only the rows on screen.
	   Fixed column widths, so rows that scroll in and out don't make the browser
	   measure the whole table again. */
	/* An opaque scroll box lets the browser scroll it on the compositor
	   instead of painting the rows again on every step */
	.devices-table.is-long > :global(.table-scroll) {
		background: var(--bg);
	}
	@container devlist (min-width: 601px) {
		.devices-table.is-long :global(table) {
			table-layout: fixed;
		}
		.devices-table.is-long :global(th.select-col) {
			width: 2.75rem;
		}
		.devices-table.is-long :global(th.col-id) {
			width: 9.5rem;
		}
		.devices-table.is-long :global(th.col-name) {
			width: auto;
		}
		.devices-table.is-long :global(th.col-type) {
			width: 7rem;
		}
		.devices-table.is-long :global(th.col-seen) {
			width: 8rem;
		}
		.devices-table.is-long :global(th.col-status) {
			width: 7rem;
		}
		.devices-table.is-long :global(th.col-tags) {
			width: 22%;
		}
		.devices-table.is-long :global(th.col-actions) {
			width: 3.5rem;
		}
		.devices-table.is-long :global(:is(td, tbody th)) {
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}
	/* A long list: every row one line high */
	.devices-table.is-long :global(:is(td, tbody th)) {
		white-space: nowrap;
	}
	.devices-table.is-long :global(td.col-platform .platform),
	.devices-table.is-long :global(tbody th.col-name .row-open) {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.devices-table.is-long .tags-cell :global(.tag-set) {
		flex-wrap: nowrap;
		overflow: hidden;
	}

	/* ── The table adapts to the width of the list, not the window ── */

	@container devlist (max-width: 860px) {
		.devices-table :global(.col-type) {
			display: none;
		}
	}
	@container devlist (max-width: 780px) {
		.devices-table :global(.col-tags) {
			display: none;
		}
		.devices-table :global(:is(th, td).col-platform) {
			width: auto;
		}
	}
	/* Narrow: each device is a short block instead of a wide row */
	@container devlist (max-width: 600px) {
		.devices-table :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.devices-table :global(table),
		.devices-table :global(tbody) {
			display: block;
		}
		.devices-table :global(tbody tr:not(.spacer, .state-row)) {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr) auto;
			gap: 2px var(--space-3);
			padding: var(--space-3) var(--row-pad-x);
			border-bottom: 1px solid var(--rule);
		}
		.devices-table :global(tbody tr:not(.spacer, .state-row) > :is(td, th)) {
			display: block;
			width: auto;
			max-width: none;
			height: auto;
			padding: 0;
			border: 0;
			background: transparent;
			white-space: normal;
		}
		.devices-table :global(tbody tr > .select-col) {
			grid-column: 1;
			grid-row: 1 / span 3;
			align-self: center;
		}
		.devices-table :global(tbody tr > .col-name) {
			grid-column: 2;
			grid-row: 1;
		}
		.devices-table :global(tbody tr > .col-status) {
			grid-column: 3;
			grid-row: 1;
			text-align: end;
		}
		.devices-table :global(tbody tr > .col-id) {
			grid-column: 2;
			grid-row: 2;
		}
		.devices-table :global(tbody tr > .col-seen) {
			grid-column: 3;
			grid-row: 2;
			text-align: end;
		}
		.devices-table :global(tbody tr > .col-platform) {
			grid-column: 2;
			grid-row: 3;
			color: var(--text-muted);
		}
		.devices-table :global(tbody tr > .col-actions) {
			grid-column: 3;
			grid-row: 3;
			align-self: end;
		}
		/* Tags on a fourth line when there are any; the type stays in the panel and the search */
		.devices-table :global(tbody tr:not(.spacer, .state-row) > .col-tags) {
			grid-column: 2 / span 2;
			grid-row: 4;
		}
		.devices-table :global(tbody tr:not(.spacer, .state-row) > .col-type),
		.devices-table :global(tbody tr.no-tags > .col-tags),
		.devices-table.is-long :global(tbody tr:not(.spacer, .state-row) > .col-tags) {
			display: none;
		}
		.devices-table :global(tbody tr:not(.spacer, .state-row):hover > :is(td, th)) {
			background: transparent;
		}
		.devices-table :global(tbody tr.spacer),
		.devices-table :global(tbody tr.state-row) {
			display: block;
		}
	}

	/* Drag preview: OS mark, name and ID next to the pointer */
	.drag-image {
		position: fixed;
		top: 0;
		left: 0;
		z-index: var(--layer-menu);
		pointer-events: none;
	}
	.drag-image[hidden] {
		display: none;
	}
	.drag-box {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		max-width: 280px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		font-size: var(--text-sm);
		line-height: 1.35;
	}
	.drag-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.drag-name {
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.drag-id {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	/* ── Narrow screens ── */

	@media (max-width: 899px) {
		.devices-layout {
			grid-template-columns: minmax(0, 1fr);
			grid-template-areas:
				'filters'
				'toolbar'
				'list';
			gap: var(--space-4);
		}
		.devices-toolbar {
			margin-bottom: 0;
		}
		.devices-filters {
			position: static;
			max-height: none;
			overflow: visible;
		}
		.toolbar-search {
			flex-basis: 100%;
			max-width: none;
		}
		.toolbar-end {
			margin-inline-start: 0;
		}
	}
	@media (max-width: 640px) {
		.page-actions {
			width: 100%;
		}
		.page-actions > :global(.btn) {
			flex: 1;
		}
	}
	/* Touch: the device name gets a 44px hit area; so does a row's checkbox,
	   through its cell (a tap anywhere in the cell ticks it) */
	@media (pointer: coarse) {
		.devices-table :global(:is(td, th).select-col) {
			min-width: 44px;
			min-height: 44px;
		}
		.devices-table :global(.row-open) {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
</style>
