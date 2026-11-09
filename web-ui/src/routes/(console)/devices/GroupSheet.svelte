<!--
  New or edit a device group: its name, whether devices join by a tag
  (dynamic) or by hand, and who may see it. The tag field shows only for a
  dynamic group.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { saveDeviceGroup, type DeviceGroup } from '#lib/api/devices.ts';
	import { listUserGroups, type UserGroup } from '#lib/api/users.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let {
		group,
		tags,
		onclose,
		onsaved
	}: { group: DeviceGroup | null; tags: string[]; onclose: () => void; onsaved: () => void } = $props();

	const uid = $props.id();
	let userGroups = $state.raw<UserGroup[]>([]);

	$effect(() => {
		if (!can('device.edit') && !can('user.view')) return;
		listUserGroups().then(
			(g) => (userGroups = g),
			() => (userGroups = [])
		);
	});

	const form = createForm({
		initial: untrack(() => ({
			name: group?.name ?? '',
			dynamic: (group?.source_type || 'manual') === 'tag',
			tag: group?.tag_filter ?? '',
			allowedUsers: (group?.allowed_users ?? []).join(', '),
			allowedGroups: [...(group?.allowed_groups ?? [])]
		})),
		validate: (v) => ({
			name: v.name.trim() ? undefined : t('common.name_required'),
			tag: v.dynamic && !v.tag.trim() ? t('devices.group_tag_required') : undefined
		}),
		submit: async (v) => {
			const teamId = (group as { team_id?: unknown } | null)?.team_id;
			await saveDeviceGroup({
				guid: group?.guid ?? '',
				name: v.name.trim(),
				source_type: v.dynamic ? 'tag' : 'manual',
				tag_filter: v.tag.trim(),
				allowed_users: v.allowedUsers,
				allowed_groups: v.allowedGroups,
				...(typeof teamId === 'string' && teamId ? { team_id: teamId } : {})
			});
			toast.success(t('devices.group_saved'));
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

<Sheet
	title={group ? t('devices.edit_group') : t('devices.create_group')}
	subtitle={tf(
		'devices.group_sheet_desc',
		'A set of devices you can filter the list by, apply access rules to and limit to some people.'
	)}
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('devices.group_name')} hint={t('devices.group_name_hint')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} width="medium" maxlength={80} required bind:value={form.values.name} />
			{/snippet}
		</Field>
		<FormSection title={tf('devices.group_section_members', 'Members')}>
			<Checkbox
				label={t('devices.dynamic_group')}
				hint={tf(
					'devices.dynamic_group_off_hint',
					'When off, you add devices yourself, for example by dragging them onto the group.'
				)}
				aria-controls="{uid}-tag"
				bind:checked={form.values.dynamic}
			/>
			<ShowWhen id="{uid}-tag" when={form.values.dynamic}>
				<Field label={t('devices.tag_filter')} hint={t('devices.dynamic_group_hint')} error={form.errors.tag}>
					{#snippet children(f)}
						<Input
							{...f}
							width="medium"
							maxlength={50}
							list="{uid}-tags"
							autocomplete="off"
							bind:value={form.values.tag}
						/>
						<datalist id="{uid}-tags">
							{#each tags as tag (tag)}<option value={tag}></option>{/each}
						</datalist>
					{/snippet}
				</Field>
			</ShowWhen>
		</FormSection>
		<FormSection title={tf('devices.group_section_access', 'Who can see it')}>
			<Field
				label={t('devices.group_allowed_users')}
				hint={tf(
					'devices.group_allowed_users_hint_list',
					'Usernames, separated by commas. Leave empty to keep the group visible to everyone with device permissions.'
				)}
			>
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
				{:else}
					<p class="hint">{t('devices.no_user_groups')}</p>
				{/if}
				<p class="hint" id="{uid}-ug-hint">
					{t('devices.group_allowed_user_groups_hint')}
					<a href={link('/users#user-groups')}>{t('devices.manage_user_groups')}</a>
				</p>
			</div>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('actions.save')}</Button>
	{/snippet}
</Sheet>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.label {
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.pick {
		margin: 0;
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
