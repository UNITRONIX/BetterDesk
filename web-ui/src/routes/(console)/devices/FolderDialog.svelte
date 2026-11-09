<!--
  New or edit a folder: name, colour, and who may see it (usernames and
  user groups; empty means everyone with device permissions). A short form,
  so a centred dialog.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createFolder, updateFolder, type Folder } from '#lib/api/devices.ts';
	import { listUserGroups, type UserGroup } from '#lib/api/users.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { folder, onclose, onsaved }: { folder: Folder | null; onclose: () => void; onsaved: () => void } =
		$props();

	const uid = $props.id();
	/** The colours the old console offered */
	const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];

	let userGroups = $state.raw<UserGroup[]>([]);
	let groupsLoaded = $state(false);

	$effect(() => {
		if (!can('device.edit') && !can('user.view')) {
			groupsLoaded = true;
			return;
		}
		listUserGroups().then(
			(g) => {
				userGroups = g;
				groupsLoaded = true;
			},
			() => (groupsLoaded = true)
		);
	});

	const form = createForm({
		initial: untrack(() => ({
			name: folder?.name ?? '',
			color:
				folder?.color && COLORS.includes(folder.color)
					? folder.color
					: (folder?.color ?? COLORS[0] ?? '#6366f1'),
			allowedUsers: (folder?.allowed_users ?? []).join(', '),
			allowedGroups: [...(folder?.allowed_groups ?? [])]
		})),
		validate: (v) => ({ name: v.name.trim() ? undefined : t('folders.name_required') }),
		submit: async (v) => {
			const body = {
				name: v.name.trim(),
				color: v.color,
				allowed_users: v.allowedUsers,
				allowed_groups: v.allowedGroups
			};
			if (folder) await updateFolder(folder.id, body);
			else await createFolder(body);
			toast.success(folder ? t('folders.updated') : t('folders.created'));
			onsaved();
		}
	});

	function toggleGroup(guid: string, on: boolean) {
		const v = form.values;
		v.allowedGroups = on
			? [...v.allowedGroups.filter((g) => g !== guid), guid]
			: v.allowedGroups.filter((g) => g !== guid);
	}
</script>

<Dialog title={folder ? t('folders.edit') : t('folders.create')} {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('folders.name')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} maxlength={50} required bind:value={form.values.name} />
			{/snippet}
		</Field>
		<div class="block">
			<span class="label" id="{uid}-color">{t('folders.color')}</span>
			<div class="swatches" role="radiogroup" aria-labelledby="{uid}-color">
				{#each COLORS as c (c)}
					<label class="swatch" style:--swatch={c}>
						<input type="radio" name="{uid}-color" value={c} aria-label={c} bind:group={form.values.color} />
					</label>
				{/each}
			</div>
		</div>
		<Field label={t('devices.group_allowed_users')} hint={t('devices.group_allowed_users_hint')}>
			{#snippet children(f)}
				<Input {...f} autocomplete="off" spellcheck="false" bind:value={form.values.allowedUsers} />
			{/snippet}
		</Field>
		<div class="block">
			<span class="label" id="{uid}-ug">{t('devices.group_allowed_user_groups')}</span>
			{#if userGroups.length}
				<div role="group" aria-labelledby="{uid}-ug" aria-describedby="{uid}-ug-hint">
					<ul class="pick">
						{#each userGroups as g (g.guid)}
							<li>
								<Checkbox
									label={g.name || g.guid}
									checked={form.values.allowedGroups.includes(g.guid)}
									onchange={(e) => toggleGroup(g.guid, (e.currentTarget as HTMLInputElement).checked)}
								/>
							</li>
						{/each}
					</ul>
				</div>
			{:else if groupsLoaded}
				<p class="hint">
					{t('devices.no_user_groups')}
					<a href={link('/users#user-groups')}>{t('devices.manage_user_groups')}</a>
				</p>
			{/if}
			<p class="hint" id="{uid}-ug-hint">{t('devices.group_allowed_user_groups_hint')}</p>
		</div>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('actions.save')}</Button>
	{/snippet}
</Dialog>

<style>
	.block {
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
	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.swatch {
		position: relative;
		display: block;
		width: 28px;
		height: 28px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--swatch);
		cursor: pointer;
	}
	.swatch input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.swatch:has(input:checked) {
		outline: 2px solid var(--text);
		outline-offset: 2px;
	}
	.swatch:has(input:focus-visible) {
		outline: var(--focus-ring);
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		.swatch {
			width: 44px;
			height: 44px;
		}
	}
	.pick {
		max-height: 260px;
		margin: 0;
		overflow-y: auto;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.pick > li {
		border-bottom: 1px solid var(--rule);
	}
	.pick > li > :global(.check-field) {
		padding-block: var(--row-pad-y);
	}
</style>
