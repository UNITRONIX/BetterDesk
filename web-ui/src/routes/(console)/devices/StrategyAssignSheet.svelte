<!--
  Where an access rule applies: devices, users and device groups (a side
  sheet; the pick lists are long). A long device list has a filter above
  it; ticked devices stay ticked while they are filtered out.
-->
<script lang="ts">
	import type { Device, DeviceGroup } from '#lib/api/devices.ts';
	import { assignStrategy, getStrategy, type Strategy } from '#lib/api/strategies.ts';
	import { listUsers, type UserRow } from '#lib/api/users.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let {
		rule,
		groups,
		devices,
		onclose,
		onsaved
	}: { rule: Strategy; groups: DeviceGroup[]; devices: Device[]; onclose: () => void; onsaved: () => void } =
		$props();

	const uid = $props.id();
	let users = $state.raw<UserRow[]>([]);
	let peers = $state<string[]>([]);
	let userNames = $state<string[]>([]);
	let groupGuids = $state<string[]>([]);
	let filter = $state('');
	let status = $state('');
	let tone = $state<'neutral' | 'error'>('neutral');
	let busy = $state(false);

	$effect(() => {
		listUsers().then(
			(u) => (users = u),
			() => (users = [])
		);
		getStrategy(rule.guid).then(
			(s) => {
				peers = [...s.peer_ids];
				userNames = [...s.user_names];
				groupGuids = [...s.group_guids];
			},
			() => undefined
		);
	});

	const deviceItems = $derived(
		devices.slice(0, 500).map((d) => ({ key: d.id, label: d.hostname ? `${d.id}, ${d.hostname}` : d.id }))
	);
	const q = $derived(filter.trim().toLowerCase());
	const shownDevices = $derived(
		q ? deviceItems.filter((i) => i.label.toLowerCase().includes(q)) : deviceItems
	);
	const userItems = $derived(users.map((u) => u.username || String(u.id)).filter(Boolean));

	function toggle(list: string[], key: string, on: boolean): string[] {
		return on ? [...list.filter((k) => k !== key), key] : list.filter((k) => k !== key);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		if (!peers.length && !userNames.length && !groupGuids.length) {
			status = tf('devices.strategy_assign_none_selected', 'Tick at least one device, user or device group.');
			tone = 'error';
			return;
		}
		busy = true;
		status = tf('ui_form.saving', 'Saving…');
		tone = 'neutral';
		try {
			await assignStrategy(rule.guid, { peers, users: userNames, groups: groupGuids });
			toast.success(t('devices.strategy_assign_saved'));
			onsaved();
		} catch (err) {
			status = err instanceof Error ? err.message : t('errors.server_error');
			tone = 'error';
		} finally {
			busy = false;
		}
	}
</script>

{#snippet picks(
	items: { key: string; label: string }[],
	selected: string[],
	set: (next: string[]) => void,
	empty: string,
	labelledby: string
)}
	{#if items.length}
		<div role="group" aria-labelledby={labelledby}>
			<ul class="pick">
				{#each items as item (item.key)}
					<li>
						<Checkbox
							label={item.label}
							checked={selected.includes(item.key)}
							onchange={(e) => {
								set(toggle(selected, item.key, (e.currentTarget as HTMLInputElement).checked));
								status = '';
							}}
						/>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<p class="hint">{empty}</p>
	{/if}
{/snippet}

<Sheet
	title={t('devices.strategy_assign_title', { name: rule.name ?? '' })}
	{status}
	statusTone={tone}
	{onclose}
>
	<form id="{uid}-form" onsubmit={submit} novalidate>
		<p class="hint intro">{t('devices.strategy_assign_hint')}</p>
		<FormSection title={t('devices.strategy_assign_devices')} id="{uid}-devices">
			{#if deviceItems.length > 8}
				<Field
					label={tf('devices.strategy_assign_filter', 'Find devices')}
					hint={tf(
						'devices.strategy_assign_filter_hint',
						'Type part of an ID or name. Ticked devices stay ticked when they are hidden.'
					)}
				>
					{#snippet children(f)}
						<Input
							{...f}
							type="search"
							width="medium"
							autocomplete="off"
							spellcheck="false"
							aria-controls="{uid}-device-list"
							bind:value={filter}
							onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && e.preventDefault()}
						/>
					{/snippet}
				</Field>
			{/if}
			<div id="{uid}-device-list" class="scroll">
				{@render picks(
					shownDevices,
					peers,
					(n) => (peers = n),
					q
						? tf('devices.strategy_assign_no_match', 'No device matches.')
						: tf('devices.strategy_assign_no_devices', 'No devices.'),
					`${uid}-devices-title`
				)}
			</div>
		</FormSection>
		<FormSection title={t('devices.strategy_assign_users')} id="{uid}-users">
			{@render picks(
				userItems.map((u) => ({ key: u, label: u })),
				userNames,
				(n) => (userNames = n),
				tf('devices.strategy_assign_no_users', 'No users.'),
				`${uid}-users-title`
			)}
		</FormSection>
		<FormSection title={t('devices.strategy_assign_groups')} id="{uid}-groups">
			{@render picks(
				groups.map((g) => ({ key: g.guid ?? '', label: g.name || g.guid || '' })),
				groupGuids,
				(n) => (groupGuids = n),
				tf('devices.strategy_assign_no_groups', 'No device groups yet.'),
				`${uid}-groups-title`
			)}
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form="{uid}-form" {busy}>{t('actions.save')}</Button>
	{/snippet}
</Sheet>

<style>
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.intro {
		margin-bottom: var(--space-4);
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
	/* A long device list scrolls in its own box under its filter */
	.scroll {
		max-height: 18rem;
		overflow-y: auto;
	}
</style>
