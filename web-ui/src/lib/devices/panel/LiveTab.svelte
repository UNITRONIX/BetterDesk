<!--
  Live data: the views read from the device's agent when they are opened
  (services, processes, events, activity, files). Each view has its own
  loading, waiting ("requested from the device"), error and empty state.
  Starting and stopping services, ending processes and browsing files need
  device.edit.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { formatBytes, formatDuration, formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import Time from '#lib/ui/Time.svelte';
	import { controlService, downloadFile, endProcess } from '../panel-actions.svelte.ts';
	import type { PanelData } from '../panel-data.svelte.ts';
	import {
		activityOf,
		eventsOf,
		filesOf,
		processesOf,
		servicesOf,
		type FileEntry,
		type LiveView,
		type PanelDevice,
		type Process,
		type Service
	} from '../panel-logic.ts';

	interface Props {
		device: PanelDevice;
		data: PanelData;
		views: LiveView[];
		/** Bindable: the view shown (kept while the panel is open) */
		view: LiveView;
	}

	let { device, data, views, view = $bindable() }: Props = $props();

	const current = $derived(views.includes(view) ? view : (views[0] ?? 'services'));
	const st = $derived(data.views[current]);
	const editable = $derived(!device.soft_deleted && can('device.edit'));
	let busy = $state<string | null>(null);

	$effect(() => {
		const v = current;
		untrack(() => {
			if (data.views[v].state === 'idle') void data.loadView(v);
		});
	});

	const services = $derived(current === 'services' && st.result ? servicesOf(st.result.data) : []);
	const processes = $derived(current === 'processes' && st.result ? processesOf(st.result.data) : []);
	const events = $derived(current === 'events' && st.result ? eventsOf(st.result.data) : []);
	const activity = $derived(current === 'activity' && st.result ? activityOf(st.result.data) : []);
	const folder = $derived(current === 'files' && st.result ? filesOf(st.result.data, st.path) : null);
	const empty = $derived(
		(current === 'services' && !services.length) ||
			(current === 'processes' && !processes.length) ||
			(current === 'events' && !events.length) ||
			(current === 'activity' && !activity.length)
	);

	async function act(key: string, fn: () => Promise<unknown>) {
		if (busy) return;
		busy = key;
		try {
			await fn();
		} finally {
			busy = null;
		}
	}

	const serviceColumns = $derived<Column<Service>[]>([
		{ id: 'name', label: t('device_detail.service_name'), cell: svcName, sortValue: (s) => s.name },
		{
			id: 'display',
			label: t('device_detail.service_display'),
			cell: svcDisplay,
			sortValue: (s) => s.displayName
		},
		{ id: 'status', label: t('device_detail.service_status'), cell: svcStatus, sortValue: (s) => s.status },
		{ id: 'start', label: t('device_detail.service_start'), cell: svcStart, sortValue: (s) => s.startType },
		...(editable
			? [
					{
						id: 'actions',
						label: t('devices.actions'),
						labelHidden: true,
						align: 'actions' as const,
						cell: svcActions
					}
				]
			: [])
	]);
	const processColumns = $derived<Column<Process>[]>([
		{ id: 'pid', label: 'PID', cell: procPid, align: 'num', sortValue: (p) => p.pid },
		{ id: 'name', label: t('device_detail.process_name'), cell: procName, sortValue: (p) => p.name },
		{ id: 'user', label: t('device_detail.process_user'), cell: procUser, sortValue: (p) => p.user },
		{ id: 'cpu', label: 'CPU', cell: procCpu, align: 'num', sortValue: (p) => p.cpu },
		{
			id: 'memory',
			label: t('device_detail.process_memory'),
			cell: procMem,
			align: 'num',
			sortValue: (p) => p.memoryMb
		},
		...(editable
			? [
					{
						id: 'actions',
						label: t('devices.actions'),
						labelHidden: true,
						align: 'actions' as const,
						cell: procActions
					}
				]
			: [])
	]);

	const problemTitle = $derived(
		st.problem === 'offline'
			? t('device_detail.agent_offline')
			: st.problem === 'timeout'
				? t('device_detail.agent_timeout')
				: t('device_detail.agent_error')
	);
	/** Codes the server sends instead of words: the title says it already */
	const problemDetail = $derived(/^agent_(offline|timeout)$/.test(st.error) ? '' : st.error);
</script>

{#snippet svcName(s: Service)}{s.name}{/snippet}
{#snippet svcDisplay(s: Service)}{s.displayName}{/snippet}
{#snippet svcStatus(s: Service)}
	{#if s.status}<Status tone={s.status === 'running' ? 'good' : 'neutral'} label={s.status} />{:else}<Empty
		/>{/if}
{/snippet}
{#snippet svcStart(s: Service)}{#if s.startType}{s.startType}{:else}<Empty />{/if}{/snippet}
{#snippet svcActions(s: Service)}
	<Button
		size="sm"
		aria-label="{t('device_detail.service_start_action')}: {s.name}"
		busy={busy === `start:${s.name}`}
		onclick={() => act(`start:${s.name}`, () => controlService(device, s.name, 'start'))}
		>{t('device_detail.service_start_action')}</Button
	>
	<Button
		size="sm"
		aria-label="{t('device_detail.service_stop_action')}: {s.name}"
		busy={busy === `stop:${s.name}`}
		onclick={() => act(`stop:${s.name}`, () => controlService(device, s.name, 'stop'))}
		>{t('device_detail.service_stop_action')}</Button
	>
{/snippet}

{#snippet procPid(p: Process)}{p.pid ?? '–'}{/snippet}
{#snippet procName(p: Process)}{#if p.name}{p.name}{:else}<Empty />{/if}{/snippet}
{#snippet procUser(p: Process)}{#if p.user}{p.user}{:else}<Empty />{/if}{/snippet}
{#snippet procCpu(p: Process)}{formatPercent(p.cpu, { digits: 1 })}{/snippet}
{#snippet procMem(p: Process)}{formatBytes(p.memoryMb * 1024 * 1024)}{/snippet}
{#snippet procActions(p: Process)}
	{#if p.pid !== null}
		<Button
			size="sm"
			aria-label="{t('device_detail.process_end')}: {p.name || p.pid}"
			busy={busy === `end:${p.pid}`}
			onclick={() => act(`end:${p.pid}`, () => endProcess(device, p))}
			>{t('device_detail.process_end')}</Button
		>
	{/if}
{/snippet}

<div class="dp-live">
	<SegmentedFilter
		label={t('device_detail.tab_live')}
		options={views.map((v) => ({ value: v, label: t(`device_detail.tab_${v}`) }))}
		bind:value={() => current, (v) => (view = v)}
	/>
	<p class="dp-muted">{t('device_detail.live_note')}</p>

	{#if st.state === 'idle' || st.state === 'loading'}
		<States kind="loading" />
	{:else if st.state === 'pending'}
		<div class="dp-pending" role="status">
			<p class="dp-empty">{t('device_detail.agent_pending')}</p>
			<p class="dp-muted">{t('device_detail.agent_pending_hint')}</p>
			<div>
				<Button size="sm" icon="refresh" onclick={() => data.loadView(current)}>{t('actions.refresh')}</Button
				>
			</div>
		</div>
	{:else if st.state === 'error'}
		<Notice tone="danger" title={problemTitle} role="alert">
			{#if problemDetail}<p class="dp-muted">{problemDetail}</p>{/if}
			<div class="dp-retry">
				<Button size="sm" icon="refresh" onclick={() => data.loadView(current)}>{t('actions.retry')}</Button>
			</div>
		</Notice>
	{:else}
		{#if st.result?.cached && st.result.collectedAt}
			<p class="dp-muted">
				{tf('device_detail.agent_cached', 'The device is offline. This is what it sent last:')}
				<Time value={st.result.collectedAt} relative={false} />
			</p>
		{/if}
		{#if empty}
			<p class="dp-empty">{t('device_detail.agent_empty')}</p>
		{:else if current === 'services'}
			<Table
				rows={services}
				columns={serviceColumns}
				key={(s) => s.name}
				label={t('device_detail.tab_services')}
			/>
		{:else if current === 'processes'}
			<Table
				rows={processes}
				columns={processColumns}
				key={(p) => `${p.pid}\n${p.name}`}
				label={t('device_detail.tab_processes')}
			/>
		{:else if current === 'events'}
			<ul class="dp-events">
				{#each events as e, i (i)}
					<li>
						<details class="dp-event is-{e.level}">
							<summary>
								<span class="dp-event-time">{e.time}</span>
								<span class="dp-event-source">{e.source || '-'}</span>
								<span class="dp-event-msg">{e.message}</span>
							</summary>
							<pre class="dp-event-detail">{e.detail}</pre>
						</details>
					</li>
				{/each}
			</ul>
		{:else if current === 'activity'}
			<ul class="dp-activity">
				{#each activity as a, i (i)}
					<li>
						<span class="dp-activity-name">{a.name || '-'}</span>
						<span class="dp-activity-time">{formatDuration(a.seconds, { largest: 'hour' })}</span>
						<span class="dp-activity-bar" aria-hidden="true"
							><span class="dp-activity-fill" style:width="{a.share.toFixed(1)}%"></span></span
						>
					</li>
				{/each}
			</ul>
		{:else if current === 'files' && folder}
			<div class="dp-path">
				{#if folder.parent}
					<Button size="sm" onclick={() => data.loadView('files', folder.parent)}
						>{t('device_detail.parent_folder')}</Button
					>
				{/if}
				<span class="mono">{folder.path}</span>
			</div>
			{#if !folder.entries.length}
				<p class="dp-empty">{t('device_detail.agent_empty')}</p>
			{:else}
				<ul class="dp-files">
					{#each folder.entries as f, i (i)}
						{@render fileRow(f)}
					{/each}
				</ul>
			{/if}
		{/if}
	{/if}
</div>

{#snippet fileRow(f: FileEntry)}
	<!-- Right-click a file downloads it (as before); the Download button is the keyboard way -->
	<li
		oncontextmenu={(e) => {
			if (f.dir) return;
			e.preventDefault();
			void act(`dl:${f.path}`, () => downloadFile(device, f.path));
		}}
	>
		<Icon name={f.dir ? 'folder' : 'description'} />
		{#if f.dir}
			<button type="button" class="dp-file-open" onclick={() => data.loadView('files', f.path)}
				>{f.name}</button
			>
		{:else}
			<span class="dp-file-name">{f.name}</span>
			<span class="dp-muted">{f.size ? formatBytes(f.size) : formatNumber(0) + ' B'}</span>
			<Button
				size="sm"
				icon="download"
				aria-label="{t('device_detail.file_download')}: {f.name}"
				busy={busy === `dl:${f.path}`}
				onclick={() => act(`dl:${f.path}`, () => downloadFile(device, f.path))}
				>{t('device_detail.file_download')}</Button
			>
		{/if}
	</li>
{/snippet}

<style>
	.dp-live {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-empty {
		margin: 0;
	}
	.dp-pending {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.dp-retry {
		margin-top: var(--space-2);
	}
	.dp-events,
	.dp-activity,
	.dp-files {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.dp-events > li,
	.dp-activity > li,
	.dp-files > li {
		border-bottom: 1px solid var(--rule);
	}
	.dp-event > summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		cursor: pointer;
	}
	.dp-event.is-error > summary {
		border-inline-start: 3px solid var(--danger);
	}
	.dp-event.is-warning > summary {
		border-inline-start: 3px solid var(--warning);
	}
	.dp-event-time,
	.dp-event-source {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-event-msg {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dp-event-detail {
		margin: 0;
		padding: var(--space-2) var(--row-pad-x);
		overflow-x: auto;
		background: var(--bg-subtle);
		font-size: var(--text-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.dp-activity > li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		padding: var(--row-pad-y) var(--row-pad-x);
	}
	.dp-activity-name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dp-activity-time {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.dp-activity-bar {
		flex-basis: 100%;
		height: 3px;
		background: var(--hover);
	}
	.dp-activity-fill {
		display: block;
		height: 100%;
		background: var(--text-muted);
	}
	.dp-path {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		overflow-wrap: anywhere;
	}
	.dp-files > li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
	}
	.dp-files > li > :global(.material-icons) {
		color: var(--text-muted);
	}
	.dp-file-name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.dp-file-open {
		flex: 1;
		min-width: 0;
		min-height: 32px;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--accent);
		font: inherit;
		text-align: start;
		overflow-wrap: anywhere;
		cursor: pointer;
	}
	.dp-file-open:hover {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	@media (pointer: coarse) {
		.dp-file-open {
			min-height: 44px;
		}
	}
</style>
