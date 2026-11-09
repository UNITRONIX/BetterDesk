<!--
  Settings tab: the connection settings stored with the organization (one
  form, one save; the server keeps them but does not apply them yet, the
  note says so and links to Policies), every stored value, and deleting
  the organization. org.edit saves, org.delete deletes; without org.edit
  the settings are shown as facts.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		deleteOrg,
		listOrgSettings,
		saveOrgSetting,
		type OrgSetting,
		type Organization
	} from '#lib/api/orgs.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { go } from '#lib/people/go.ts';
	import {
		CONNECTION_POLICIES,
		readSessionSettings,
		sessionSettingRows,
		SETTING_DEFAULTS,
		type OrgSessionSettings
	} from '#lib/people/orgs.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import DangerZone from '#lib/ui/DangerZone.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm, FormError, warnOnLeave } from '#lib/ui/form.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let { org, canPolicies }: { org: Organization; canPolicies: boolean } = $props();

	const canEdit = can('org.edit');
	const canDelete = can('org.delete');
	const uid = $props.id();

	let rows = $state.raw<OrgSetting[] | null>(null);
	let loadError = $state('');
	let deleting = $state(false);

	type Values = Omit<OrgSessionSettings, 'max_session_duration_min'> & {
		max_session_duration_min: number | string;
	};

	const form = createForm<Values>({
		initial: { ...SETTING_DEFAULTS },
		validate: (v) => {
			const n = Number(v.max_session_duration_min);
			return {
				max_session_duration_min:
					Number.isInteger(n) && n >= 0
						? undefined
						: tf('organizations.max_session_invalid', 'Enter a whole number of minutes, 0 or more.')
			};
		},
		submit: async (v) => {
			const values = { ...v, max_session_duration_min: Number(v.max_session_duration_min) };
			try {
				for (const [key, value] of sessionSettingRows(values)) await saveOrgSetting(org.id, key, value);
			} catch (err) {
				throw new FormError(`${t('ui_form.save_failed')} ${err instanceof Error ? err.message : ''}`.trim());
			}
			void load(false);
			return values;
		},
		savedMessage: t('organizations.settings_saved')
	});

	$effect(() => warnOnLeave(() => form.dirty));

	async function load(resetForm = true) {
		try {
			const list = await listOrgSettings(org.id);
			rows = list;
			loadError = '';
			if (resetForm) form.reset(readSessionSettings(list));
		} catch (err) {
			loadError = err instanceof Error ? err.message : t('organizations.loading_failed');
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	async function removeOrg() {
		const ok = await confirm({
			title: t('organizations.delete_org'),
			message: t('organizations.delete_confirm_named', { name: org.name || org.id }),
			confirmLabel: t('organizations.delete_org'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		deleting = true;
		try {
			await deleteOrg(org.id);
			toast.success(t('organizations.org_deleted'));
			go(link('/organizations'));
		} catch (err) {
			toast.error(`${t('organizations.delete_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		} finally {
			deleting = false;
		}
	}

	const policyLabel = (p: string) =>
		t(p === 'ask_always' ? 'organizations.policy_ask' : `organizations.policy_${p}`);
	const policyOptions = $derived(
		CONNECTION_POLICIES.map((p) => ({ value: p as string, label: policyLabel(p) }))
	);

	const rawColumns = $derived<Column<OrgSetting>[]>([
		{ id: 'key', label: t('organizations.key'), cell: keyCell, sortValue: (r) => r.key, class: 'col-key' },
		{ id: 'value', label: t('organizations.value'), cell: valueCell, class: 'col-value' }
	]);
</script>

{#snippet keyCell(r: OrgSetting)}<span class="mono">{r.key}</span>{/snippet}
{#snippet valueCell(r: OrgSetting)}<span class="mono">{r.value}</span>{/snippet}
{#snippet fileTransfer()}<BooleanStatus value={form.values.allow_file_transfer} />{/snippet}
{#snippet clipboard()}<BooleanStatus value={form.values.allow_clipboard} />{/snippet}

<section class="section settings" aria-labelledby="{uid}-conn">
	<h2 id="{uid}-conn">{t('organizations.session_settings')}</h2>
	<p class="section-note">
		{t('organizations.session_settings_note')}
		<a href={link(canPolicies ? `/policies/${encodeURIComponent(org.id)}` : '/policies')}
			>{t('organizations.policies_link')}</a
		>
	</p>
	{#if rows === null && !loadError}
		<States kind="loading" />
	{:else if loadError && rows === null}
		<States kind="error" message={loadError} onretry={() => void load()} />
	{:else if canEdit}
		<form id={form.id} onsubmit={form.onsubmit} novalidate>
			<Field label={t('organizations.connection_policy')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={policyOptions} bind:value={form.values.connection_policy} />
				{/snippet}
			</Field>
			<div class="checks">
				<Checkbox
					label={t('organizations.allow_file_transfer')}
					bind:checked={form.values.allow_file_transfer}
				/>
				<Checkbox label={t('organizations.allow_clipboard')} bind:checked={form.values.allow_clipboard} />
			</div>
			<Field label={t('organizations.max_session_duration')} error={form.errors.max_session_duration_min}>
				{#snippet children(f)}
					<Input
						{...f}
						type="number"
						width="short"
						min={0}
						bind:value={form.values.max_session_duration_min}
					/>
				{/snippet}
			</Field>
			<SaveBar {form} label={t('organizations.save')} />
		</form>
	{:else}
		<Facts
			items={[
				{ label: t('organizations.connection_policy'), value: policyLabel(form.values.connection_policy) },
				{ label: t('organizations.allow_file_transfer'), value: fileTransfer },
				{ label: t('organizations.allow_clipboard'), value: clipboard },
				{
					label: t('organizations.max_session_duration'),
					value: String(form.values.max_session_duration_min)
				}
			]}
		/>
	{/if}
</section>

<Disclosure title={t('organizations.raw_settings')}>
	<p class="section-note">{t('organizations.raw_settings_note')}</p>
	{#if rows && rows.length}
		<div class="raw">
			<Table {rows} columns={rawColumns} key={(r) => r.key} label={t('organizations.raw_settings')} />
		</div>
	{:else if rows}
		<States message={t('organizations.no_settings')} />
	{:else if loadError}
		<States kind="error" message={loadError} onretry={() => void load()} />
	{/if}
</Disclosure>

{#if canDelete}
	<DangerZone
		title={t('common.delete')}
		rows={[
			{
				title: t('organizations.delete_org'),
				consequence: t('organizations.delete_org_desc'),
				action: t('organizations.delete_org_button'),
				onclick: () => void removeOrg(),
				busy: deleting
			}
		]}
	/>
{/if}

<style>
	.settings {
		max-width: var(--measure);
	}
	.checks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-bottom: var(--space-4);
	}
	.raw :global(td.col-value) {
		overflow-wrap: anywhere;
	}
	.raw :global(td.col-key) {
		white-space: nowrap;
	}
</style>
