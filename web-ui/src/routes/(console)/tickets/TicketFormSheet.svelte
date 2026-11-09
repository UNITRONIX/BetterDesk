<!--
  New ticket or edit ticket: title, description, then priority, category
  and device. A sheet (more than a few fields). Edit sends only what
  changed; the device can be changed or cleared (the API takes device_id
  on PATCH since P10). Cancel and Save keep the sheet footer order.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		createTicket,
		TICKET_CATEGORIES,
		TICKET_PRIORITIES,
		updateTicket,
		type Ticket,
		type TicketChanges
	} from '#lib/api/tickets.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	interface Props {
		/** null: a new ticket */
		ticket: Ticket | null;
		onclose: () => void;
		/** After a save, with the ticket's id */
		onsaved: (id: number) => void;
	}

	let { ticket, onclose, onsaved }: Props = $props();

	const editing = untrack(() => ticket);

	const form = createForm({
		initial: {
			title: editing?.title ?? '',
			description: editing?.description ?? '',
			priority: editing?.priority || 'medium',
			category: editing?.category || 'general',
			device: editing?.device_id ?? ''
		},
		validate: (v) => ({ title: v.title.trim() ? undefined : t('tickets.title_required') }),
		submit: async (v) => {
			if (!editing) {
				const id = await createTicket({
					title: v.title.trim(),
					description: v.description.trim(),
					priority: v.priority,
					category: v.category,
					device_id: v.device.trim()
				});
				toast.success(t('tickets.created_success'));
				onsaved(id);
				return;
			}
			const changes: TicketChanges = {};
			if (v.title.trim() !== editing.title) changes.title = v.title.trim();
			if (v.description.trim() !== editing.description) changes.description = v.description.trim();
			if (v.priority !== editing.priority) changes.priority = v.priority;
			if (v.category !== editing.category) changes.category = v.category;
			if (v.device.trim() !== editing.device_id) changes.device_id = v.device.trim() || null;
			if (Object.keys(changes).length) {
				await updateTicket(editing.id, changes);
				toast.success(t('tickets.updated_success'));
			}
			onsaved(editing.id);
		}
	});

	const priorityOptions = $derived(
		[...TICKET_PRIORITIES].reverse().map((p) => ({ value: p, label: t(`tickets.priority_${p}`) }))
	);
	const categoryOptions = $derived(
		TICKET_CATEGORIES.map((c) => ({ value: c, label: t(`tickets.category_${c}`) }))
	);
</script>

<Sheet
	title={editing ? t('tickets.edit') : t('tickets.create')}
	class="ticket-form-sheet"
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('tickets.ticket_title')} hint={t('tickets.title_hint')} error={form.errors.title}>
			{#snippet children(f)}
				<Input {...f} maxlength={200} required bind:value={form.values.title} />
			{/snippet}
		</Field>
		<Field label={t('tickets.description')}>
			{#snippet children(f)}
				<Textarea {...f} rows={5} maxlength={5000} bind:value={form.values.description} />
			{/snippet}
		</Field>
		<FormSection title={t('tickets.section_sorting')}>
			<Field label={t('tickets.priority')} hint={t('tickets.priority_hint')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={priorityOptions} bind:value={form.values.priority} />
				{/snippet}
			</Field>
			<Field label={t('tickets.category')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={categoryOptions} bind:value={form.values.category} />
				{/snippet}
			</Field>
			<Field label={t('tickets.device')} hint={t('tickets.device_hint')}>
				{#snippet children(f)}
					<Input
						{...f}
						class="mono"
						width="medium"
						maxlength={64}
						autocomplete="off"
						spellcheck="false"
						bind:value={form.values.device}
					/>
				{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{editing ? t('actions.save') : t('tickets.save_create')}</Button
		>
	{/snippet}
</Sheet>
