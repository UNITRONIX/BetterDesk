<!--
  Organizations (/organizations): one row per organization with its
  people and devices; a click on a row opens it. org.create adds one,
  org.edit and org.delete sit in the row menu.

  Data: GET /api/panel/org, then per organization its members (only with
  user.view and org.manage_users, which that list needs) and devices, four
  at a time and for the first 12 rows: the list has no counts and the
  general API limit is 100 requests a minute.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { deleteOrg, listOrgDevices, listOrgs, listOrgUsers, type Organization } from '#lib/api/orgs.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { plural, t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { go } from '#lib/people/go.ts';
	import OrgDialog from '#lib/people/OrgDialog.svelte';
	import { eachLimited } from '#lib/people/users.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column, SortState } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	const COUNT_LIMIT = 12;

	const canCreate = can('org.create');
	const canEdit = can('org.edit');
	const canDelete = can('org.delete');
	/** The members list needs both */
	const canCountUsers = can('user.view') && can('org.manage_users');

	let orgs = $state.raw<Organization[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	/** Per organization: its counts (null: not known) */
	const counts = new SvelteMap<string, { users: number | null; devices: number | null }>();
	let generation = 0;
	/** The count requests of the last load; stopped by a new load or by leaving the page */
	let countRequests: AbortController | null = null;

	async function load() {
		const gen = ++generation;
		countRequests?.abort();
		const ctrl = new AbortController();
		countRequests = ctrl;
		try {
			const list = await listOrgs();
			if (gen !== generation) return;
			orgs = list;
			loadError = null;
			loaded = true;
			counts.clear();
			for (const o of list.slice(COUNT_LIMIT)) counts.set(o.id, { users: null, devices: null });
			void eachLimited(list.slice(0, COUNT_LIMIT), 4, async (o) => {
				if (ctrl.signal.aborted) return;
				const [users, devices] = await Promise.all([
					canCountUsers
						? listOrgUsers(o.id, ctrl.signal).then(
								(u) => u.length,
								() => null
							)
						: Promise.resolve(null),
					listOrgDevices(o.id, ctrl.signal).then(
						(d) => d.length,
						() => null
					)
				]);
				if (gen === generation && !ctrl.signal.aborted) counts.set(o.id, { users, devices });
			});
		} catch {
			if (gen !== generation) return;
			loaded = true;
			loadError = t('organizations.list_failed');
		}
	}

	$effect(() => {
		untrack(() => void load());
		const stop = onRefresh(() => void load());
		return () => {
			stop();
			countRequests?.abort();
		};
	});

	let sort = $state<SortState | null>(null);
	let dialog = $state<{ org: Organization | null } | null>(null);

	const href = (o: Organization) => link(`/organizations/${encodeURIComponent(o.id)}`);

	async function remove(o: Organization) {
		const ok = await confirm({
			title: t('organizations.delete_org'),
			message: t('organizations.delete_confirm_named', { name: o.name || o.id }),
			confirmLabel: t('organizations.delete_org'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteOrg(o.id);
			toast.success(t('organizations.org_deleted'));
			void load();
		} catch (err) {
			toast.error(`${t('organizations.delete_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		}
	}

	const columns = $derived<Column<Organization>[]>([
		{
			id: 'name',
			label: t('organizations.name'),
			cell: nameCell,
			sortValue: (o) => o.name.toLowerCase(),
			class: 'col-name'
		},
		...(canCountUsers
			? [
					{
						id: 'users',
						label: t('organizations.users'),
						cell: usersCell,
						align: 'num' as const,
						sortValue: (o: Organization) => counts.get(o.id)?.users ?? null
					}
				]
			: []),
		{
			id: 'devices',
			label: t('organizations.devices'),
			cell: devicesCell,
			align: 'num',
			sortValue: (o) => counts.get(o.id)?.devices ?? null
		},
		{
			id: 'created',
			label: t('organizations.created'),
			cell: createdCell,
			sortValue: (o) => o.created_at ?? ''
		},
		...(canEdit || canDelete
			? [
					{
						id: 'actions',
						label: t('common.actions'),
						labelHidden: true,
						cell: actionsCell,
						align: 'actions' as const
					}
				]
			: [])
	]);
</script>

{#snippet nameCell(o: Organization)}<a class="org-name" href={href(o)}>{o.name || o.id}</a>{#if o.slug}<span
			class="cell-sub mono">{o.slug}</span
		>{/if}{/snippet}

{#snippet count(n: number | null | undefined)}{#if n === undefined}<span class="text-muted" aria-hidden="true"
			>…</span
		><span class="sr-only">{t('common.loading')}</span>{:else if n === null}<Empty />{:else}{formatNumber(
			n
		)}{/if}{/snippet}

{#snippet usersCell(o: Organization)}{@render count(counts.get(o.id)?.users)}{/snippet}
{#snippet devicesCell(o: Organization)}{@render count(counts.get(o.id)?.devices)}{/snippet}

{#snippet createdCell(o: Organization)}<Time
		value={o.created_at}
		relative={false}
		format={{ hour: undefined, minute: undefined }}
	/>{/snippet}

{#snippet actionsCell(o: Organization)}<MenuButton
		kebab
		label={t('organizations.actions_for', { name: o.name })}
	>
		{#if canEdit}
			<MenuItem class="act-edit" icon={ICONS.edit} onselect={() => (dialog = { org: o })}
				>{t('common.edit')}</MenuItem
			>
		{/if}
		{#if canEdit && canDelete}<MenuDivider />{/if}
		{#if canDelete}
			<MenuItem class="act-delete" icon={ICONS.delete} danger onselect={() => void remove(o)}
				>{t('common.delete')}</MenuItem
			>
		{/if}
	</MenuButton>{/snippet}

<div class="page page-wide org-page">
	<div class="page-head">
		<h1>{t('nav.organizations')}</h1>
		{#if canCreate}
			<div class="page-actions">
				<Button class="create-org" variant="primary" icon={ICONS.add} onclick={() => (dialog = { org: null })}
					>{t('organizations.create')}</Button
				>
			</div>
		{/if}
		<p class="page-description">{t('organizations.page_description')}</p>
	</div>

	<section class="section" aria-labelledby="org-list-title">
		<h2 id="org-list-title" class="sr-only">{t('nav.organizations')}</h2>
		<div class="count-row" aria-live="polite">
			{#if loaded && !loadError && orgs.length}
				<CountLine
					text={plural(orgs.length, { one: t('users.org_count_one'), other: t('users.org_count_many') })}
				/>
			{/if}
		</div>
		<div class="org-table">
			<Table
				rows={orgs}
				{columns}
				key={(o) => o.id}
				label={t('nav.organizations')}
				bind:sort
				onrowclick={(o) => go(href(o))}
				loading={!loaded}
				loadingText={t('organizations.loading_list')}
				error={loadError}
				onretry={() => void load()}
				emptyText={t('organizations.empty_list')}
			/>
		</div>
	</section>
</div>

{#if dialog}
	<OrgDialog
		org={dialog.org}
		onclose={() => (dialog = null)}
		onsaved={() => {
			dialog = null;
			void load();
		}}
	/>
{/if}

<style>
	.count-row {
		min-height: 1.5em;
		margin: 0;
	}
	.org-name {
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}
	.org-name:hover {
		text-decoration: underline;
	}
	.org-table :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.org-table :global(td.col-name) {
		min-width: 16ch;
	}
	.org-table :global(tbody tr) {
		cursor: pointer;
	}
</style>
