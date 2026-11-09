<!--
  New or edit an organization: name, slug and logo address (three fields,
  a centred dialog). For a new one the slug follows the name until someone
  types in the slug field.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createOrg, updateOrg, type Organization } from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { slugify } from './orgs.ts';

	interface Props {
		org: Organization | null;
		onclose: () => void;
		onsaved: () => void;
	}

	let { org, onclose, onsaved }: Props = $props();

	let slugTouched = untrack(() => !!org);

	const form = createForm({
		initial: untrack(() => ({ name: org?.name ?? '', slug: org?.slug ?? '', logo: org?.logo_url ?? '' })),
		validate: (v) => {
			const missing = t('organizations.name_slug_required');
			return {
				name: v.name.trim() ? undefined : missing,
				slug: v.slug.trim() ? undefined : missing
			};
		},
		submit: async (v) => {
			const body = { name: v.name.trim(), slug: v.slug.trim().toLowerCase(), logo_url: v.logo.trim() };
			if (org) await updateOrg(org.id, body);
			else await createOrg(body);
			toast.success(t(org ? 'organizations.org_updated' : 'organizations.org_created'));
			onsaved();
		}
	});

	/** A new organization's slug follows the name until the slug is typed in */
	function onName(e: Event) {
		if (!slugTouched) form.values.slug = slugify((e.currentTarget as HTMLInputElement).value);
	}
</script>

<Dialog
	title={org ? t('organizations.edit') : t('organizations.create')}
	beforeclose={() => !form.busy}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('organizations.name')} error={form.errors.name}>
			{#snippet children(f)}
				<Input
					{...f}
					maxlength={120}
					autocomplete="off"
					required
					bind:value={form.values.name}
					oninput={onName}
				/>
			{/snippet}
		</Field>
		<Field label={t('organizations.slug')} hint={t('organizations.slug_hint')} error={form.errors.slug}>
			{#snippet children(f)}
				<Input
					{...f}
					width="medium"
					maxlength={64}
					autocomplete="off"
					spellcheck="false"
					required
					bind:value={form.values.slug}
					oninput={() => (slugTouched = true)}
				/>
			{/snippet}
		</Field>
		<Field label={t('organizations.logo_url')} hint={t('organizations.logo_url_hint')}>
			{#snippet children(f)}
				<Input
					{...f}
					type="url"
					width="host"
					autocomplete="off"
					spellcheck="false"
					bind:value={form.values.logo}
				/>
			{/snippet}
		</Field>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{org ? t('actions.save') : t('organizations.create')}</Button
		>
	{/snippet}
</Dialog>
