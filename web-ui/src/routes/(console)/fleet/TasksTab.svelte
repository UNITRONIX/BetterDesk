<!--
  Fleet > Tasks: one job on many devices, now or on a schedule. Search (name
  and devices, in the page) and a status filter (asks the server); Create
  task opens the form sheet. A click on a row shows the task's output in a
  sheet; Retry for failed tasks; the row menu has Output, Edit and Delete.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		deleteTask,
		isUnavailable,
		listTasks,
		retryTask,
		TASK_STATUSES,
		taskOutput,
		type Task
	} from '#lib/api/fleet.ts';
	import { filterTasks, taskSchedule, taskTargets, taskType } from '#lib/canvas/fleet.ts';
	import { formatDate } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import Filter from './Filter.svelte';
	import OutputSheet from './OutputSheet.svelte';
	import TaskSheet from './TaskSheet.svelte';

	interface Props {
		ready: boolean;
		unavailable: boolean;
		query: string;
		status: string;
	}

	let { ready, unavailable = $bindable(), query = $bindable(), status = $bindable() }: Props = $props();

	const message = (err: unknown) => (err instanceof Error ? err.message : '');

	/* ── Data ── */

	let list = $state.raw<Task[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let inflight: AbortController | null = null;

	async function load(): Promise<void> {
		inflight?.abort();
		inflight = null;
		if (!ready || unavailable) {
			list = [];
			loaded = ready;
			return;
		}
		const ctrl = new AbortController();
		inflight = ctrl;
		try {
			const out = await listTasks(status, ctrl.signal);
			if (inflight !== ctrl) return;
			list = out;
			error = null;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			list = [];
			if (isUnavailable(err)) unavailable = true;
			else error = t('fleet.tasks_failed', { error: message(err) });
		}
		loaded = true;
	}

	$effect(() => {
		void [ready, unavailable, status];
		untrack(() => void load());
	});
	$effect(() => () => untrack(() => inflight?.abort()));

	const rows = $derived(filterTasks(list, query));
	const searching = $derived(query.trim() !== '');

	const statusOptions = $derived([
		{ value: '', label: t('fleet.all_statuses') },
		...TASK_STATUSES.map((s) => ({ value: s as string, label: t(`fleet.status_${s}`) }))
	]);

	const emptyText = $derived(
		unavailable
			? t('fleet.unavailable_table')
			: searching || status
				? t('fleet.no_tasks_match')
				: t('fleet.no_tasks')
	);

	/* ── Sheets and actions ── */

	let sheet = $state<{ kind: 'form'; task: Task | null } | { kind: 'output'; task: Task } | null>(null);
	let menuFor = $state<string | null>(null);

	async function remove(task: Task) {
		const name = task.name || task.id;
		const ok = await confirm({
			title: t('fleet.delete_task_title'),
			message: t('fleet.delete_task_message', { name }),
			confirmLabel: t('fleet.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteTask(task.id);
			toast.success(t('fleet.task_deleted', { name }));
			void load();
		} catch (err) {
			toast.error(t('fleet.delete_failed', { error: message(err) }));
		}
	}

	async function retry(task: Task) {
		try {
			await retryTask(task.id);
			toast.success(t('fleet.task_retried', { name: task.name || task.id }));
			void load();
		} catch (err) {
			toast.error(t('fleet.retry_failed', { error: message(err) }));
		}
	}

	const statusKey = (s: string) =>
		(TASK_STATUSES as readonly string[]).includes(s) ? `fleet.status_${s}` : null;
	const typeKey = (x: string) =>
		['script', 'restart', 'update', 'install', 'file_deploy', 'registry'].includes(x)
			? `fleet.task_type_${x}`
			: null;

	const columns = $derived<Column<Task>[]>([
		{
			id: 'name',
			label: t('fleet.col_task_name'),
			cell: nameCell,
			primary: true,
			sortValue: (x) => x.name.toLowerCase()
		},
		{ id: 'type', label: t('fleet.col_task_type'), cell: typeCell, sortValue: (x) => taskType(x) },
		{ id: 'targets', label: t('fleet.target_devices'), cell: targetsCell },
		{ id: 'schedule', label: t('fleet.col_schedule'), cell: scheduleCell, sortValue: (x) => x.schedule_type },
		{ id: 'status', label: t('fleet.col_status'), cell: statusCell, sortValue: (x) => x.status || 'pending' },
		{ id: 'last_run', label: t('fleet.col_last_run'), cell: lastRunCell, sortValue: (x) => x.last_run },
		{ id: 'actions', label: t('fleet.col_actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet nameCell(x: Task)}{x.name || x.id}{/snippet}

{#snippet typeCell(x: Task)}{@const key = typeKey(taskType(x))}<Tag
		label={key ? t(key) : taskType(x) || '–'}
	/>{/snippet}

{#snippet targetsCell(x: Task)}<ValueCopy value={taskTargets(x)} />{/snippet}

{#snippet scheduleCell(x: Task)}{@const s = taskSchedule(x)}{#if s.kind === 'cron'}{t('fleet.schedule_cron')}:
		<span class="mono">{s.value}</span>{:else if s.kind === 'once'}{s.date
			? formatDate(s.date)
			: s.value || t('fleet.schedule_once')}{:else}{t('fleet.schedule_immediate')}{/if}{/snippet}

{#snippet statusCell(x: Task)}{@const st = x.status || 'pending'}{@const key = statusKey(st)}<Status
		tone={st}
		label={key ? t(key) : st}
	/>{/snippet}

{#snippet lastRunCell(x: Task)}<Time value={x.last_run} />{/snippet}

{#snippet actionsCell(x: Task)}{#if x.status === 'failed'}<Button
			size="sm"
			icon={ICONS.retry}
			onclick={() => void retry(x)}>{t('fleet.task_retry')}</Button
		>{/if}<MenuButton
		kebab
		label={t('fleet.actions_for', { name: x.name || x.id })}
		bind:open={() => menuFor === x.id, (v) => (menuFor = v ? x.id : menuFor === x.id ? null : menuFor)}
	>
		<MenuItem icon={ICONS.view} onselect={() => (sheet = { kind: 'output', task: x })}
			>{t('fleet.show_output')}</MenuItem
		>
		<MenuItem icon={ICONS.edit} onselect={() => (sheet = { kind: 'form', task: x })}
			>{t('fleet.edit')}</MenuItem
		>
		<MenuDivider />
		<MenuItem icon={ICONS.delete} danger onselect={() => void remove(x)}
			>{t('fleet.delete_ellipsis')}</MenuItem
		>
	</MenuButton>{/snippet}

<p class="note">{t('fleet.tasks_note')}</p>
<Toolbar>
	{#snippet search()}<SearchField label={t('fleet.search_tasks')} bind:value={query} />{/snippet}
	<Filter label={t('fleet.col_status')} options={statusOptions} bind:value={status} />
	{#snippet end()}
		<Button variant="primary" icon={ICONS.add} onclick={() => (sheet = { kind: 'form', task: null })}
			>{t('fleet.create_task')}</Button
		>
	{/snippet}
</Toolbar>
<p class="count-line" aria-live="polite">
	{#if list.length}
		{#if searching}
			<CountLine text={t('fleet.count_tasks_filtered')} values={{ count: rows.length, total: list.length }} />
		{:else}
			<CountLine text={t('fleet.count_tasks')} values={{ count: list.length }} />
		{/if}
	{/if}
</p>
<div class="fleet-table">
	<Table
		{rows}
		{columns}
		key={(x) => x.id}
		label={t('fleet.tab_tasks')}
		onrowclick={(x) => (sheet = { kind: 'output', task: x })}
		loading={!loaded}
		loadingText={t('fleet.loading_tasks')}
		{error}
		onretry={() => void load()}
		{emptyText}
	/>
</div>

{#if sheet?.kind === 'form'}
	<TaskSheet
		task={sheet.task}
		{unavailable}
		onclose={() => (sheet = null)}
		onsaved={() => {
			sheet = null;
			void load();
		}}
	/>
{:else if sheet?.kind === 'output'}
	{@const task = sheet.task}
	<OutputSheet
		title={t('fleet.output_of', { name: task.name || task.id })}
		load={(signal) => taskOutput(task.id, signal)}
		onclose={() => (sheet = null)}
	>
		{#snippet actions()}
			{#if task.status === 'failed'}
				<Button icon={ICONS.retry} onclick={() => void retry(task)}>{t('fleet.task_retry')}</Button>
			{/if}
		{/snippet}
	</OutputSheet>
{/if}

<style>
	.note {
		margin: 0;
		color: var(--text-muted);
	}
	.count-line {
		margin: 0;
		min-height: 1.5em;
		color: var(--text-muted);
	}
	.mono {
		font-family: var(--mono);
	}
	.fleet-table :global(.row-open) {
		text-align: start;
		white-space: normal;
	}
	@media (pointer: coarse) {
		.fleet-table :global(.row-open) {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
</style>
