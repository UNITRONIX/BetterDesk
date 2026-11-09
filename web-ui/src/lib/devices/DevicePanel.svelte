<!--
  The device panel: one sheet for one device, opened from any page
  (DevicePanelHost mounts it while devicePanel.id is set). Header with the
  name, ID, status, platform and user; tabs Overview, Hardware, Metrics,
  Live data, Tags and notes, Actions (each only when it applies to the
  device and the person); a footer whose buttons keep their place.

  Edit mode (devicePanel.mode 'edit') turns the top of Overview into a
  form: display name, user, note, folder, tags, one Save that sends only
  what changed. The footer has three slots that keep their place and size:
      view:  [Edit]   [Connect]  ...........  [Close]
      edit:  [Cancel] [       ]  ...........  [Save]
  Each slot holds both of its buttons on top of each other; the one that
  doesn't apply is inert and invisible, so the slot is as wide as the
  wider label in either mode.

  Keyboard: Escape closes the panel (focus goes back to what opened it);
  in edit mode it leaves editing first, asking when something changed.
  The close button and a click outside ask the same before closing.

  Sheets opened from the panel (terminal, port relay, access policy,
  groups ...) replace it while they are open (one sheet at a time); when
  they close, the panel comes back with focus on the action that opened
  them. Confirmations sit on top of the panel.

  The device reloads every 15 s while the panel shows (not in a hidden
  tab) and whenever devicePanel.revision changes.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { getDevice, type DeviceDetail } from '#lib/api/devices.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { closeDevice, devicePanel } from '#lib/state/devicePanel.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Sheet, { type SheetParts } from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tabs, { type TabItem } from '#lib/ui/Tabs.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm, type Form } from '#lib/ui/form.svelte.ts';
	import { connectInBrowser, editRemoteTarget } from './actions.svelte.ts';
	import { deviceName } from './model.ts';
	import { saveEdit } from './panel-actions.svelte.ts';
	import { PanelData } from './panel-data.svelte.ts';
	import { clearStatus, panelView } from './panel.svelte.ts';
	import {
		editValuesOf,
		footerSlots,
		hasTag,
		liveViews,
		panelStatus,
		panelTabs,
		type EditValues,
		type FooterSlots,
		type LiveView,
		type PanelTab
	} from './panel-logic.ts';
	import ActionsTab from './panel/ActionsTab.svelte';
	import EditForm from './panel/EditForm.svelte';
	import HardwareTab from './panel/HardwareTab.svelte';
	import LiveTab from './panel/LiveTab.svelte';
	import MetricsTab from './panel/MetricsTab.svelte';
	import OverviewTab from './panel/OverviewTab.svelte';
	import TagsTab from './panel/TagsTab.svelte';

	let { id }: { id: string } = $props();

	const POLL_MS = 15_000;

	const TAB_KEYS: Record<PanelTab, string> = {
		overview: 'device_detail.tab_overview',
		hardware: 'device_detail.tab_hardware',
		metrics: 'device_detail.tab_metrics',
		live: 'device_detail.tab_live',
		tags: 'device_detail.tab_tags',
		actions: 'device_detail.tab_actions'
	};
	const NO_SLOTS: FooterSlots = { edit: false, editTarget: false, connect: false };

	const data = $derived(new PanelData(id));
	let device = $state.raw<DeviceDetail | null>(null);
	let loadError = $state('');
	let sheetOpen = $state(true);
	let sheetEl = $state<HTMLElement | null>(null);
	let editBtn = $state<HTMLElement | null>(null);

	// The tab and live view it opens on (openDeviceAt), used once
	let tab = $state<PanelTab>(panelView.tab ?? 'overview');
	let liveView = $state<LiveView>(panelView.liveView ?? 'services');
	panelView.tab = null;
	panelView.liveView = null;
	clearStatus();

	const slots = $derived(device ? footerSlots(device, can) : NO_SLOTS);
	const tabIds = $derived(device ? panelTabs(device, can) : []);
	const current = $derived<PanelTab>(tabIds.includes(tab) ? tab : 'overview');
	const tabItems = $derived<TabItem[]>(tabIds.map((x) => ({ id: x, label: t(TAB_KEYS[x]) })));
	const views = $derived(device ? liveViews(device, can) : []);
	const status = $derived(device ? panelStatus(device) : null);
	const title = $derived(device ? deviceName(device) || device.id : id);

	/* ── Loading ── */

	let seq = 0;
	async function load(): Promise<void> {
		const n = ++seq;
		try {
			const d = await getDevice(id);
			if (n !== seq) return;
			device = d;
			loadError = '';
		} catch (err) {
			if (n !== seq) return;
			// A failed reload keeps what is shown; only the first load shows the error
			if (!device)
				loadError = err instanceof Error && err.message ? err.message : t('errors.load_device_failed');
			throw err;
		}
	}

	// The first load, and again whenever something changed the device
	$effect(() => {
		void devicePanel.revision;
		untrack(() => load().catch(() => {}));
	});

	// Every 15 s while the panel shows; poll() pauses in a hidden tab
	$effect(() => {
		if (!sheetOpen) return;
		return poll(load, { every: POLL_MS, immediate: false });
	});

	// Folder names for Overview
	$effect(() => {
		void data.loadFolders();
	});

	/* ── Edit mode ── */

	let form = $state.raw<Form<EditValues> | null>(null);
	let before: EditValues | null = null;
	const editing = $derived(form !== null);

	$effect(() => {
		const want = devicePanel.mode === 'edit';
		const loaded = !!device;
		const allowed = slots.edit;
		untrack(() => {
			if (want && loaded && allowed && !form) begin();
			else if (want && loaded && !allowed) devicePanel.mode = 'view';
			else if (!want && form) form = null;
		});
	});

	function begin() {
		if (!device) return;
		const values = editValuesOf(device);
		before = values;
		form = createForm<EditValues>({
			initial: values,
			validate: (v) => ({
				tagInput: v.tagInput.trim() && hasTag(v.tags, v.tagInput) ? t('device_detail.tag_exists') : undefined
			}),
			submit: async (v) => {
				if (device && before) await saveEdit(device, before, v);
			}
		});
		tab = 'overview';
		clearStatus();
		void data.loadFolders();
		void data.loadTags();
		void tick().then(() => sheetEl?.querySelector<HTMLElement>('.dp-edit [data-autofocus]')?.focus());
	}

	function startEdit() {
		if (slots.edit) devicePanel.mode = 'edit';
	}

	async function backToView() {
		devicePanel.mode = 'view';
		await tick();
		editBtn?.focus();
	}

	function confirmDiscard() {
		return confirm({
			title: t('device_detail.discard_title'),
			message: t('device_detail.discard_message'),
			confirmLabel: t('device_detail.discard_confirm'),
			danger: true
		});
	}

	/** Cancel doesn't ask; Escape asks when something changed */
	async function cancelEdit(ask: boolean) {
		if (!form || form.busy) return;
		if (ask && form.dirty && !(await confirmDiscard())) return;
		await backToView();
	}

	async function save() {
		const f = form;
		if (!f) return;
		if (await f.submit()) await backToView();
	}

	// Escape in edit mode leaves editing instead of closing (before the sheet's own handler)
	$effect(() => {
		const el = sheetEl;
		if (!el) return;
		const onkey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented || !form) return;
			e.preventDefault();
			void cancelEdit(true);
		};
		el.addEventListener('keydown', onkey);
		return () => el.removeEventListener('keydown', onkey);
	});

	/* ── Closing, and sheets opened from the panel ── */

	let userClosing = false;
	let running: string | null = null;
	let suspended = false;

	async function beforeclose(): Promise<boolean> {
		if (form?.dirty && !(await confirmDiscard())) return false;
		userClosing = true;
		return true;
	}

	/** The sheet closed: the person closed it, or a sheet opened from the panel took its place */
	function onclose() {
		if (!userClosing && running) {
			suspended = true;
			return;
		}
		userClosing = false;
		closeDevice();
	}

	async function requestClose() {
		if (!(await beforeclose())) return;
		userClosing = false;
		closeDevice();
	}

	/**
	 * Run an action. When it opens a sheet, that sheet replaces the panel;
	 * once the action is done the panel comes back and the action's button
	 * gets focus again.
	 */
	async function run(key: string, fn: () => unknown) {
		if (running) return;
		running = key;
		try {
			await fn();
		} finally {
			running = null;
			if (suspended && devicePanel.id === id) {
				suspended = false;
				sheetOpen = true;
				await tick();
				sheetEl?.querySelector<HTMLElement>(`[data-action-key="${key}"]`)?.focus();
			}
		}
	}

	function editTarget() {
		const d = device;
		if (d) void run('edit-target', () => editRemoteTarget(d));
	}

	function connect() {
		if (device) void connectInBrowser(device);
	}

	/* ── Footer status line ── */

	const statusText = $derived(
		form && (form.status.state === 'saving' || form.status.state === 'error')
			? form.status.message
			: panelView.message
	);
	const statusTone = $derived(
		form?.status.state === 'error' ? 'error' : form?.status.state === 'saving' ? 'neutral' : panelView.tone
	);
</script>

{#snippet header(parts: SheetParts)}
	<div class="sheet-header dp-header">
		<div class="sheet-titles">
			<h2 class="sheet-title" id={parts.titleId}>{title}</h2>
			<p class="dp-id"><ValueCopy value={device?.id ?? id} /></p>
			{#if device && status}
				<p class="dp-status-bar">
					<Status
						tone={status.tone}
						label={t(status.key)}
						title={status.titleKey ? t(status.titleKey) : undefined}
					/>
					<Platform platform={device.platform || device.os} />
					{#if device.username}<span class="dp-user">{device.username}</span>{/if}
				</p>
			{/if}
		</div>
		<IconButton
			icon="close"
			label={t('actions.close')}
			class="modal-close"
			data-autofocus={editing ? undefined : true}
			onclick={requestClose}
		/>
	</div>
{/snippet}

{#snippet body()}
	<div class="dp-body">
		{#if !device}
			<div class="sheet-body">
				{#if loadError}
					<States kind="error" message={loadError} onretry={() => load().catch(() => {})} />
				{:else}
					<States kind="loading" />
				{/if}
			</div>
		{:else}
			{@const d = device}
			<Tabs
				tabs={tabItems}
				bind:value={
					() => current,
					(v) => {
						tab = (v ?? 'overview') as PanelTab;
						clearStatus();
					}
				}
			>
				{#snippet children(cur)}
					<div class="dp-tab">
						{#if cur === 'overview'}
							<OverviewTab device={d} folders={data.folders} {editing}>
								{#if form}
									<EditForm {form} folders={data.folders} knownTags={data.tags} onsubmit={save} />
								{/if}
							</OverviewTab>
						{:else if cur === 'hardware'}
							<HardwareTab device={d} {data} />
						{:else if cur === 'metrics'}
							<MetricsTab device={d} {data} />
						{:else if cur === 'live'}
							<LiveTab device={d} {data} {views} bind:view={liveView} />
						{:else if cur === 'tags'}
							<TagsTab device={d} {data} />
						{:else if cur === 'actions'}
							<ActionsTab device={d} {run} onedit={startEdit} />
						{/if}
					</div>
				{/snippet}
			</Tabs>
		{/if}
	</div>
{/snippet}

{#snippet footer()}
	<div class="dp-footer-start">
		{#if slots.edit || slots.editTarget}
			<span class="dp-slot" data-slot="edit">
				<Button
					icon="edit"
					inert={editing || undefined}
					bind:element={editBtn}
					data-action-key="edit-target"
					onclick={slots.edit ? startEdit : editTarget}>{t('actions.edit')}</Button
				>
				{#if slots.edit}
					<Button inert={!editing || undefined} disabled={form?.busy} onclick={() => cancelEdit(false)}
						>{t('actions.cancel')}</Button
					>
				{/if}
			</span>
		{/if}
		{#if slots.connect}
			<span class="dp-slot" data-slot="connect">
				<Button variant="primary" icon="connect" inert={editing || undefined} onclick={connect}
					>{t('actions.connect')}</Button
				>
			</span>
		{/if}
	</div>
	<span class="dp-slot" data-slot="close">
		<Button variant="ghost" inert={editing || undefined} onclick={requestClose}>{t('actions.close')}</Button>
		{#if slots.edit}
			<Button variant="primary" inert={!editing || undefined} busy={form?.busy} onclick={save}
				>{t('actions.save')}</Button
			>
		{/if}
	</span>
{/snippet}

<Sheet
	bind:open={sheetOpen}
	bind:element={sheetEl}
	class="device-panel"
	status={statusText}
	{statusTone}
	{beforeclose}
	{onclose}
	{header}
	{body}
	{footer}
/>

<style>
	.dp-header {
		align-items: flex-start;
	}
	.dp-id {
		margin: 2px 0 0;
		font-size: var(--text-md);
	}
	.dp-status-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		margin: var(--space-2) 0 0;
		color: var(--text-muted);
	}
	.dp-user {
		overflow-wrap: anywhere;
	}

	/* Tabs stay put; only the open tab scrolls */
	.dp-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.dp-body > :global(div.tabs) {
		flex: none;
		margin-inline: calc(var(--sheet-pad-x) - var(--tab-ring-room, 6px));
		margin-top: var(--space-1);
	}
	.dp-body > :global([role='tabpanel']) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-4) var(--sheet-pad-x) var(--space-6);
	}
	.dp-body > :global([role='tabpanel']:focus-visible) {
		outline-offset: -2px;
	}
	.dp-tab {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}

	/* Footer slots: both buttons of a slot share one grid cell */
	.dp-footer-start {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-inline-end: auto;
	}
	.dp-slot {
		display: inline-grid;
	}
	.dp-slot > :global(*) {
		grid-area: 1 / 1;
	}
	.dp-slot > :global([inert]) {
		visibility: hidden;
	}

	/* Wide screens: room for the charts in Metrics */
	@media (min-width: 1600px) {
		:global(div.sheet.device-panel) {
			width: min(720px, 100vw);
		}
	}
</style>
