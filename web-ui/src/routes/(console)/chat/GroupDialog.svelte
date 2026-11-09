<!--
  New group: a name and its members (console users and devices, ticked in
  two lists). A short form, so a centred dialog. The console is always a
  member (the chat page lists groups that include "panel"); the page adds
  it when it sends.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import type { Contact } from '#lib/support/chat.svelte.ts';

	interface Props {
		contacts: readonly Contact[];
		onclose: () => void;
		/** Returns false when the group could not be sent (chat not connected) */
		oncreate: (name: string, members: string[]) => boolean;
	}

	let { contacts, onclose, oncreate }: Props = $props();

	const uid = $props.id();
	const people = $derived(contacts.filter((c) => c.role === 'operator'));
	const devices = $derived(contacts.filter((c) => c.role !== 'operator'));

	const form = createForm({
		initial: { name: '', members: [] as string[] },
		validate: (v) => ({
			name: v.name.trim() ? undefined : t('chat.group_name_required'),
			members: v.members.length ? undefined : t('chat.group_members_required')
		}),
		submit: (v) => {
			if (!oncreate(v.name.trim(), v.members)) throw new FormError(t('chat.send_failed'));
			onclose();
		}
	});

	function toggle(id: string, on: boolean) {
		const v = form.values;
		v.members = on ? [...v.members.filter((x) => x !== id), id] : v.members.filter((x) => x !== id);
	}
</script>

{#snippet block(title: string, list: readonly Contact[])}
	{#if list.length}
		<fieldset class="member-group">
			<legend>{title}</legend>
			<ul class="member-list">
				{#each list as c (c.id)}
					<li>
						<Checkbox
							label={c.name || c.id}
							checked={form.values.members.includes(c.id)}
							onchange={(e) => toggle(c.id, (e.currentTarget as HTMLInputElement).checked)}
						/>
					</li>
				{/each}
			</ul>
		</fieldset>
	{/if}
{/snippet}

<Dialog title={t('chat.create_group')} {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('chat.group_name')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} maxlength={64} required bind:value={form.values.name} />
			{/snippet}
		</Field>
		<div class="members">
			<span class="label" id="{uid}-members">{t('chat.group_members')}</span>
			<p class="hint" id="{uid}-hint">{t('chat.group_members_hint')}</p>
			<div
				class="member-select"
				role="group"
				aria-labelledby="{uid}-members"
				aria-describedby={form.errors.members ? `${uid}-error ${uid}-hint` : `${uid}-hint`}
			>
				{#if contacts.length}
					{@render block(t('chat.role_operators'), people)}
					{@render block(t('chat.role_devices'), devices)}
				{:else}
					<p class="hint">{t('chat.no_contacts')}</p>
				{/if}
			</div>
			{#if form.errors.members}<p class="error" id="{uid}-error">{form.errors.members}</p>{/if}
		</div>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('chat.create_group')}</Button>
	{/snippet}
</Dialog>

<style>
	.members {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label {
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.error {
		margin: 0;
		color: var(--danger);
		font-size: var(--text-sm);
	}
	.member-select {
		max-height: 300px;
		overflow-y: auto;
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}
	.member-group {
		margin: 0;
		padding: 0;
		border: 0;
	}
	.member-group + .member-group {
		margin-top: var(--space-2);
	}
	.member-group legend {
		padding: var(--space-1) 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.member-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
