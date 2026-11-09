<!--
  One enrollment request in a side sheet: its facts, and what can be done
  with it. A waiting request gets the approve form (name, folder, tags,
  groups, and for RustDesk clients how often it reports), with Reject and
  Approve in the footer. A decided one shows its status, with Open device,
  Allow again or Delete record when they apply.

  The folders, groups and tags for the form come from the page (loaded once
  per visit when the first sheet opens).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { Folder, DeviceGroup } from '#lib/api/devices.ts';
	import { approveEnrollment, approveLan, type ApproveInput, type SyncMode } from '#lib/api/registrations.ts';
	import {
		SOURCE_ENROLLMENT,
		canDeleteRecord,
		rowActions,
		splitTags,
		tagsValue,
		type RequestRow
	} from '#lib/clients/registrations.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Version from '#lib/ui/Version.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import { around, decidedText, plainly, sourceLabel, statusLabel, statusToneOf } from './labels.ts';

	interface Props {
		row: RequestRow;
		/** The request was decided on this page */
		decidedHere: boolean;
		folders: Folder[];
		groups: DeviceGroup[];
		tags: string[] | null;
		/** The server wants a tag picker instead of a text field */
		tagPicker: boolean;
		/** Folders, groups and tags have arrived */
		ready: boolean;
		onclose: () => void;
		onapproved: (name: string) => void;
		onreject: () => void;
		onopen: () => void;
		onallow: () => void;
		ondelete: () => void;
	}

	let {
		row,
		decidedHere,
		folders,
		groups,
		tags,
		tagPicker,
		ready,
		onclose,
		onapproved,
		onreject,
		onopen,
		onallow,
		ondelete
	}: Props = $props();

	const uid = $props.id();
	const isGo = $derived(row.source === SOURCE_ENROLLMENT);
	const pending = $derived(row.status === 'pending' && !decidedHere);
	const actions = $derived(rowActions(row, decidedHere));
	const name = $derived(row.hostname || row.device_id);
	const canApprove = $derived(can('enrollment.approve'));

	const SYNC: SyncMode[] = ['standard', 'silent', 'turbo'];

	const form = createForm({
		initial: untrack(() => ({
			display_name: row.hostname,
			folder_id: 0,
			picked: [] as string[],
			tagText: '',
			groups: [] as string[],
			sync_mode: 'standard' as SyncMode
		})),
		submit: async (v) => {
			const body: ApproveInput = {
				display_name: v.display_name.trim(),
				tags: tagPicker ? tagsValue(v.picked) : tagsValue(splitTags(v.tagText)),
				folder_id: Number(v.folder_id) || 0,
				group_guids: v.groups
			};
			await plainly(
				() =>
					isGo
						? approveEnrollment(row.rowId, { ...body, sync_mode: v.sync_mode })
						: approveLan(row.rowId, body),
				'registrations.approve_failed'
			);
			onapproved(body.display_name || name);
		}
	});

	// The sheet opens on the name, selected, so typing replaces the name the device sent
	let selected = false;
	function selectOnce(e: FocusEvent) {
		if (selected) return;
		selected = true;
		(e.currentTarget as HTMLInputElement).select();
	}

	/* ── Tags: the known ones as ticks, a new one added ticked ── */

	let added = $state<string[]>([]);
	let newTag = $state('');
	const tagChoices = $derived([...(tags ?? []), ...added.filter((x) => !(tags ?? []).includes(x))]);

	function addTag() {
		const tag = newTag.trim();
		if (!tag) return;
		if (!tagChoices.includes(tag)) added = [...added, tag];
		if (!form.values.picked.includes(tag)) form.values.picked = [...form.values.picked, tag];
		newTag = '';
	}

	function toggle(list: 'picked' | 'groups', value: string, on: boolean) {
		const cur = form.values[list];
		form.values[list] = on ? [...cur.filter((x) => x !== value), value] : cur.filter((x) => x !== value);
	}

	const folderOptions = $derived([
		{ value: 0, label: t('registrations.field_folder_none') },
		...folders.map((f) => ({ value: f.id, label: f.name || `#${f.id}` }))
	]);
	const syncOptions = $derived(SYNC.map((m) => ({ value: m, label: t(`registrations.reporting_${m}`) })));
	// Devices join tag groups by their tags; only manual groups can be picked
	const manualGroups = $derived(
		groups
			.filter((g) => g.guid && (g.source_type || 'manual') !== 'tag')
			.map((g) => ({ guid: g.guid ?? '', name: g.name || g.guid || '' }))
	);

	/* ── Facts ── */

	const facts = $derived.by((): Fact[] => {
		const list: Fact[] = [
			{ label: t('registrations.col_device_id'), value: idFact },
			{ label: t('registrations.col_hostname'), value: row.hostname, empty: t('registrations.no_name') },
			{ label: t('registrations.col_platform'), value: platformFact },
			{ label: t('registrations.col_ip'), value: ipFact },
			{ label: t('registrations.col_asked'), value: askedFact },
			{ label: t('registrations.col_source'), value: sourceFact }
		];
		if (!pending) list.push({ label: t('registrations.col_status'), value: statusFact });
		return list;
	});

	const status = $derived(
		form.status.state === 'saving'
			? t('registrations.approving')
			: form.status.state === 'error'
				? form.status.message
				: ''
	);
</script>

{#snippet idFact()}<ValueCopy value={row.device_id} label={t('registrations.col_device_id')} />{/snippet}
{#snippet platformFact()}<Platform
		platform={row.platform}
		empty={t('common.not_available')}
	/>{#if row.version}{@const [pre, post] = around(t('registrations.client_version'), '{version}')}<span
			class="text-muted">{pre}<Version version={row.version} />{post}</span
		>{/if}{/snippet}
{#snippet ipFact()}<ValueCopy value={row.ip} copy={false} empty={t('common.not_available')} />{/snippet}
{#snippet askedFact()}<Time
		value={row.asked_at}
		relative={false}
		empty={t('common.not_available')}
	/>{#if row.asked_at}<span class="text-muted"><Time value={row.asked_at} /></span>{/if}{/snippet}
{#snippet sourceFact()}<Tag label={sourceLabel(row)} />{/snippet}
{#snippet statusFact()}<Status
		tone={statusToneOf(row.status)}
		label={statusLabel(row.status)}
	/>{#if decidedText(row)}<span class="text-muted">{decidedText(row)}</span>{/if}{/snippet}

<Sheet
	title={pending ? t('registrations.approve_title_named', { name }) : name}
	subtitle={pending
		? tf(
				'registrations.approve_sheet_desc',
				'The device gets the server settings and can connect. Name, folder, tags and groups can be changed later.'
			)
		: undefined}
	{status}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	class="request-sheet"
	{onclose}
>
	<Facts items={facts} label={t('registrations.col_device')} />

	{#if pending && canApprove}
		<form id={form.id} class="approve-form" onsubmit={form.onsubmit} novalidate aria-busy={!ready}>
			<Field label={t('registrations.field_name')} hint={t('registrations.field_name_hint')}>
				{#snippet children(f)}
					<Input
						{...f}
						width="medium"
						maxlength={120}
						autocomplete="off"
						data-autofocus
						onfocus={selectOnce}
						bind:value={form.values.display_name}
					/>
				{/snippet}
			</Field>
			<Field label={t('registrations.field_folder')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={folderOptions} bind:value={form.values.folder_id} />
				{/snippet}
			</Field>

			{#if tagPicker}
				<FormSection title={t('registrations.field_tags')} class="approve-choices">
					{#if tagChoices.length}
						<ul class="pick" aria-label={t('registrations.field_tags')}>
							{#each tagChoices as tag (tag)}
								<li>
									<Checkbox
										label={tag}
										checked={form.values.picked.includes(tag)}
										onchange={(e) => toggle('picked', tag, (e.currentTarget as HTMLInputElement).checked)}
									/>
								</li>
							{/each}
						</ul>
					{:else if ready}
						<p class="hint">{t('registrations.no_tags_yet')}</p>
					{/if}
					<Field
						label={t('registrations.field_tag_add_placeholder')}
						hint={tf('registrations.field_tag_add_hint', 'Adds it to the list above, ticked.')}
					>
						{#snippet children(f)}
							<div class="add-row">
								<Input
									{...f}
									width="medium"
									autocomplete="off"
									bind:value={newTag}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											addTag();
										}
									}}
								/>
								<Button class="add-tag" onclick={addTag}>{t('registrations.field_tag_add_btn')}</Button>
							</div>
						{/snippet}
					</Field>
				</FormSection>
			{:else}
				<Field label={t('registrations.field_tags')} hint={t('registrations.field_tags_hint')}>
					{#snippet children(f)}
						<Input {...f} autocomplete="off" bind:value={form.values.tagText} />
					{/snippet}
				</Field>
			{/if}

			{#if manualGroups.length}
				<FormSection title={t('registrations.field_groups')} class="approve-choices">
					<ul class="pick" aria-label={t('registrations.field_groups')} aria-describedby="{uid}-groups-hint">
						{#each manualGroups as g (g.guid)}
							<li>
								<Checkbox
									label={g.name}
									checked={form.values.groups.includes(g.guid)}
									onchange={(e) => toggle('groups', g.guid, (e.currentTarget as HTMLInputElement).checked)}
								/>
							</li>
						{/each}
					</ul>
					<p class="hint" id="{uid}-groups-hint">
						{tf(
							'registrations.field_groups_hint',
							'Optional. A group decides who can see the device and which access rules apply to it.'
						)}
					</p>
				</FormSection>
			{/if}

			{#if isGo}
				<FormSection title={t('registrations.field_reporting')}>
					<Field
						label={tf('registrations.field_reporting_how_often', 'How often it reports')}
						hint={t(`registrations.reporting_${form.values.sync_mode}_desc`)}
					>
						{#snippet children(f)}
							<Select {...f} width="medium" options={syncOptions} bind:value={form.values.sync_mode} />
						{/snippet}
					</Field>
				</FormSection>
			{/if}
		</form>
	{/if}

	{#snippet footer()}
		{#if pending && canApprove}
			<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
			<Button class="sheet-reject" variant="danger-quiet" icon={ICONS.reject} onclick={onreject}
				>{t('registrations.reject_btn')}…</Button
			>
			<Button
				class="sheet-approve"
				variant="primary"
				icon={ICONS.approve}
				type="submit"
				form={form.id}
				busy={form.busy}>{t('registrations.approve_btn')}</Button
			>
		{:else}
			{#if actions.includes('open')}
				<Button class="sheet-open" icon={ICONS.open} onclick={onopen}>{t('registrations.open_device')}</Button
				>
			{/if}
			{#if actions.includes('allow-again')}
				<Button class="sheet-allow" onclick={onallow}>{t('registrations.allow_again')}</Button>
			{/if}
			{#if canDeleteRecord(row, can('enrollment.manage'))}
				<Button class="sheet-delete" variant="danger-quiet" icon={ICONS.delete} onclick={ondelete}
					>{t('registrations.delete_record')}</Button
				>
			{/if}
			<Button class="sheet-close" variant="primary" onclick={onclose}>{t('common.close')}</Button>
		{/if}
	{/snippet}
</Sheet>

<style>
	.approve-form {
		margin-top: var(--space-5);
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.pick {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.add-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}
	.add-row > :global(.form-input) {
		flex: 0 1 auto;
	}
</style>
