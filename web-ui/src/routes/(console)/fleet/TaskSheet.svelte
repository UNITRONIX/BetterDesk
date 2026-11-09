<!--
  Create or edit a task (old fleet.js taskForm): name and type, the devices
  and when it runs (right away, once at a time, or on a cron schedule; the
  time field shows only for the last two), the script, and retries and the
  time limit. Without fleet on the server the sheet opens with a note and
  Save is off.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { saveTask, TASK_TYPES, type Task } from '#lib/api/fleet.ts';
	import { taskNumbers, taskProblem, taskTargets, taskType } from '#lib/canvas/fleet.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	interface Props {
		/** null: a new task */
		task: Task | null;
		unavailable: boolean;
		onclose: () => void;
		onsaved: () => void;
	}

	let { task, unavailable, onclose, onsaved }: Props = $props();

	const uid = $props.id();
	const noteId = `${uid}-note`;
	const whenId = `${uid}-when`;
	const editing = untrack(() => task);

	const form = createForm({
		initial: {
			name: editing?.name ?? '',
			type: (editing && taskType(editing)) || 'script',
			targets: editing ? taskTargets(editing) : '',
			schedule_type: editing?.schedule_type || 'immediate',
			schedule_value: editing?.schedule_value || editing?.cron || '',
			script: editing?.script || editing?.payload || '',
			retries: String(editing?.retries ?? 0),
			timeout: String(editing?.timeout ?? 300)
		},
		validate: (v) => {
			const problem = taskProblem({
				name: v.name.trim(),
				targets: v.targets.trim(),
				schedule_type: v.schedule_type,
				schedule_value: v.schedule_value.trim()
			});
			if (!problem) return null;
			const field = problem.field === 'schedule' ? 'schedule_value' : problem.field;
			return { [field]: t(problem.key) };
		},
		submit: async (v) => {
			const body = {
				name: v.name.trim(),
				type: v.type,
				targets: v.targets.trim(),
				schedule_type: v.schedule_type,
				schedule_value: v.schedule_type === 'immediate' ? '' : v.schedule_value.trim(),
				script: v.script,
				...taskNumbers(v.retries, v.timeout)
			};
			try {
				await saveTask(editing?.id ?? null, body);
			} catch (err) {
				throw new FormError(t('fleet.save_failed', { error: err instanceof Error ? err.message : '' }));
			}
			toast.success(t('fleet.task_created', { name: body.name }));
			onsaved();
		}
	});

	const typeOptions = $derived(
		TASK_TYPES.map((x) => ({ value: x as string, label: t(`fleet.task_type_${x}`) }))
	);
	const scheduleOptions = $derived(
		(['immediate', 'once', 'cron'] as const).map((x) => ({
			value: x as string,
			label: t(`fleet.schedule_${x}`)
		}))
	);
	const cron = $derived(form.values.schedule_type === 'cron');
</script>

<Sheet
	title={editing ? t('fleet.edit_task') : t('fleet.create_task')}
	subtitle={t('fleet.task_sheet_desc')}
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} class="fleet-form" onsubmit={form.onsubmit} novalidate>
		{#if unavailable}
			<Notice tone="warning" id={noteId} message={t('fleet.unavailable_dialog')} />
		{/if}
		<Field label={t('fleet.col_task_name')} hint={t('fleet.task_name_hint')} error={form.errors.name}>
			{#snippet children(f)}<Input
					{...f}
					maxlength={120}
					required
					autocomplete="off"
					bind:value={form.values.name}
				/>{/snippet}
		</Field>
		<Field label={t('fleet.col_task_type')}>
			{#snippet children(f)}<Select
					{...f}
					width="medium"
					options={typeOptions}
					bind:value={form.values.type}
				/>{/snippet}
		</Field>
		<FormSection title={t('fleet.section_where_when')}>
			<Field label={t('fleet.target_devices')} hint={t('fleet.target_hint')} error={form.errors.targets}>
				{#snippet children(f)}<Input
						{...f}
						class="mono"
						required
						autocomplete="off"
						spellcheck="false"
						bind:value={form.values.targets}
					/>{/snippet}
			</Field>
			<Field label={t('fleet.col_schedule')}>
				{#snippet children(f)}<Select
						{...f}
						width="host"
						options={scheduleOptions}
						aria-controls={whenId}
						bind:value={form.values.schedule_type}
					/>{/snippet}
			</Field>
			<ShowWhen id={whenId} when={form.values.schedule_type !== 'immediate'}>
				<Field
					label={cron ? t('fleet.schedule_cron_label') : t('fleet.schedule_when')}
					hint={cron ? t('fleet.cron_hint', { value: t('fleet.cron_placeholder') }) : undefined}
					error={form.errors.schedule_value}
				>
					{#snippet children(f)}<Input
							{...f}
							type={cron ? 'text' : 'datetime-local'}
							class={cron ? 'mono' : ''}
							width="medium"
							autocomplete="off"
							spellcheck="false"
							bind:value={form.values.schedule_value}
						/>{/snippet}
				</Field>
			</ShowWhen>
		</FormSection>
		<FormSection title={t('fleet.section_script')}>
			<Field label={t('fleet.script_content')} hint={t('fleet.script_hint')}>
				{#snippet children(f)}<Textarea
						{...f}
						class="mono"
						rows={8}
						spellcheck="false"
						bind:value={form.values.script}
					/>{/snippet}
			</Field>
		</FormSection>
		<FormSection title={t('fleet.section_failures')}>
			<Field label={t('fleet.retry_count')} hint={t('fleet.retry_hint')}>
				{#snippet children(f)}<Input
						{...f}
						type="number"
						width="short"
						min="0"
						max="3"
						bind:value={form.values.retries}
					/>{/snippet}
			</Field>
			<Field label={t('fleet.timeout_sec')} hint={t('fleet.timeout_hint')}>
				{#snippet children(f)}<Input
						{...f}
						type="number"
						width="short"
						min="30"
						max="3600"
						bind:value={form.values.timeout}
					/>{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('fleet.cancel')}</Button>
		<Button
			variant="primary"
			type="submit"
			form={form.id}
			busy={form.busy}
			disabled={unavailable}
			aria-describedby={unavailable ? noteId : undefined}
			>{editing ? t('fleet.save') : t('fleet.create_task')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.fleet-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.fleet-form :global(textarea.mono) {
		font-family: var(--mono);
	}
</style>
