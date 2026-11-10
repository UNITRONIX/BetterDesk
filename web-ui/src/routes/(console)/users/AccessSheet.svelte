<!--
  Panel access of a user or a user group: per catalog group a setting for
  all its sections, then each section with none, read or full access (or
  no setting, so it falls back), and the client features. Under each row,
  what applies now and where it comes from; for a user, a warning where a
  setting goes above what the role allows (the role's limit still applies
  on the server). Hard-locked features are always off and have no control.

  user.edit edits and saves the whole policy at once; with only user.view
  the sheet shows what applies now, without controls.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		getAccessCatalog,
		getAccessPolicy,
		saveAccessPolicy,
		type AccessCatalog,
		type AccessPolicy,
		type AccessSubject
	} from '#lib/api/access.ts';
	import { has, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		aboveRole,
		catalogGroups,
		LEVEL_KEYS,
		sectionLabelKeys,
		sourceKey,
		toDraft,
		toPayload,
		type Draft
	} from '#lib/people/access.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet, { type SheetParts } from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import { createForm, warnOnLeave } from '#lib/ui/form.svelte.ts';

	interface Props {
		subject: AccessSubject;
		/** The user's or group's name for the title */
		name: string;
		/** The user's role (users only), shown with the groups */
		role?: string;
		roleLabel?: (role: string) => string;
		onclose: () => void;
	}

	let { subject, name, role, roleLabel, onclose }: Props = $props();

	const uid = $props.id();
	const editable = can('user.edit');
	const kind = untrack(() => subject.kind);
	const isMe = untrack(
		() => subject.kind === 'user' && String(subject.id) === String(session.user?.id ?? '')
	);

	let catalog = $state.raw<AccessCatalog | null>(null);
	let effective = $state.raw<AccessPolicy['effective'] | null>(null);
	let loadError = $state('');
	let formEl = $state<HTMLFormElement>();

	const form = createForm<Draft>({
		initial: { sections: {}, groups: {}, features: {} },
		submit: async (values) => {
			if (!catalog) return;
			const saved = await saveAccessPolicy(subject, toPayload(catalog, values));
			effective = saved.effective;
			return toDraft(catalog, saved);
		},
		savedMessage: tf('users.access_saved', 'Panel access saved.')
	});

	$effect(() => warnOnLeave(() => form.dirty));

	/** Closing the sheet stops a load that is still running */
	const aborter = new AbortController();
	$effect(() => () => aborter.abort());

	async function load() {
		loadError = '';
		try {
			const [c, p] = await Promise.all([
				getAccessCatalog(aborter.signal),
				getAccessPolicy(subject, aborter.signal)
			]);
			catalog = c;
			effective = p.effective;
			form.reset(toDraft(c, p));
			// The sheet focused a footer button while loading; the first field is where work starts
			await tick();
			const active = document.activeElement;
			if (!active || active === document.body || active.closest('.sheet-footer'))
				formEl?.querySelector<HTMLElement>('select')?.focus();
		} catch (err) {
			if (aborter.signal.aborted) return;
			loadError =
				err instanceof Error && err.message
					? err.message
					: tf('users.access_load_failed', 'Could not load the panel access.');
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	const groups = $derived(catalog ? catalogGroups(catalog) : []);

	/** The first of the keys that has a string, else the catalog's label */
	function label(keys: string | string[], fallback: string): string {
		for (const key of Array.isArray(keys) ? keys : [keys]) if (has(key)) return t(key);
		return fallback || String(keys);
	}

	const inheritLabel = $derived(
		kind === 'user' ? t('users.access_policy_inherit') : tf('users.access_not_set', 'Not set')
	);
	const levelOptions = $derived([
		{ value: 'inherit', label: inheritLabel },
		{ value: 'none', label: t('users.access_none') },
		{ value: 'read', label: t('users.access_read') },
		{ value: 'write', label: t('users.access_write') }
	]);
	const featureOptions = $derived([
		{ value: 'inherit', label: tf('users.access_feature_inherit', 'Default') },
		{ value: 'on', label: t('common.on') },
		{ value: 'off', label: t('common.off') }
	]);

	/** English for the source words until the server has loaded the new strings */
	const SOURCE_FALLBACK: Record<string, string> = {
		'users.access_source_user': 'set for this person',
		'users.access_source_group': 'from a group',
		'users.access_source_group_own': 'set for this group',
		'users.access_source_role': 'from the role',
		'users.access_source_unset': 'not set',
		'users.access_source_default': 'default'
	};
	function sourceText(source: string): string {
		const key = sourceKey(source, kind);
		return tf(key, SOURCE_FALLBACK[key] ?? source);
	}

	const levelText = (level: string | undefined) =>
		t(LEVEL_KEYS[level as keyof typeof LEVEL_KEYS] ?? 'users.access_none');

	/** What applies now and where from; for a user's own or group setting also what the role allows at most */
	function nowLine(level: string, source: string, limit?: string): string {
		const params = { level: levelText(level), source: sourceText(source) };
		return limit
			? tf('users.access_now_role', 'Now: {level}, {source}. Role limit: {limit}', {
					...params,
					limit: levelText(limit)
				})
			: tf('users.access_now', 'Now: {level}, {source}', params);
	}

	function featureNow(enabled: boolean, source: string): string {
		return tf('users.access_now', 'Now: {level}, {source}', {
			level: enabled ? t('common.on') : t('common.off'),
			source: sourceText(source)
		});
	}

	const memberOf = $derived(effective?.groups.map((g) => g.name || g.guid).join(', ') ?? '');
</script>

{#snippet roleValue()}{#if role}<Tag label={roleLabel ? roleLabel(role) : role} />{:else}<Empty
		/>{/if}{/snippet}

{#snippet sectionRow(key: string, text: string, isGroup: boolean)}
	{@const eff = isGroup ? null : effective?.sections[key]}
	{@const value = isGroup ? form.values.groups[key] : form.values.sections[key]}
	{@const above = !!eff && kind === 'user' && !!value && aboveRole(value, eff.role_ceiling)}
	<li class={['row', isGroup && 'is-group']} data-access={isGroup ? `group:${key}` : key}>
		<span class="text">
			{#if editable}
				<label class="name" for="{uid}-{isGroup ? 'g' : 's'}-{key}">{text}</label>
			{:else}
				<span class="name">{text}</span>
			{/if}
			{#if eff}
				<span class="now" id="{uid}-s-{key}-now"
					>{nowLine(
						eff.access,
						eff.source,
						kind === 'user' && !above && eff.source !== 'role' ? eff.role_ceiling : undefined
					)}</span
				>
				{#if above}
					<span class="warn" id="{uid}-s-{key}-warn"
						>{tf('users.access_role_limit', 'The role allows {level} here; that limit still applies.', {
							level: levelText(eff.role_ceiling)
						})}</span
					>
				{/if}
			{/if}
		</span>
		{#if editable}
			{#if isGroup}
				<Select id="{uid}-g-{key}" small options={levelOptions} bind:value={form.values.groups[key]} />
			{:else}
				<Select
					id="{uid}-s-{key}"
					small
					options={levelOptions}
					aria-describedby={eff ? `${uid}-s-${key}-now${above ? ` ${uid}-s-${key}-warn` : ''}` : undefined}
					bind:value={form.values.sections[key]}
				/>
			{/if}
		{/if}
	</li>
{/snippet}

{#snippet content()}
	{#if loadError}
		<States kind="error" message={loadError} onretry={() => void load()} />
	{:else if !catalog}
		<States kind="loading" message={t('users.loading_access_policy')} />
	{:else}
		<form id={form.id} class="access-form" bind:this={formEl} onsubmit={form.onsubmit} novalidate>
			<p class="note">
				{kind === 'user'
					? tf(
							'users.access_user_note',
							"A setting here wins over this person's groups. Without one, the highest setting of their groups applies, then their role."
						)
					: tf(
							'users.access_group_note',
							'Members get the highest level any of their groups gives, unless their own setting says otherwise.'
						)}
			</p>
			{#if isMe && editable}
				<Notice
					tone="warning"
					message={tf(
						'users.access_self_warning',
						'These settings apply to your own account. If you take away your access to Users, you cannot change them back yourself.'
					)}
				/>
			{/if}
			{#if kind === 'user'}
				{#snippet groupsValue()}{#if memberOf}{memberOf}{:else}<Empty />{/if}{/snippet}
				<Facts
					items={[
						{ label: t('users.role'), value: roleValue },
						{ label: t('users.user_groups'), value: groupsValue }
					]}
				/>
			{/if}

			{#each groups as g (g.key)}
				<FormSection title={label(`users.access_group_${g.key}`, g.label)}>
					<ul class="rows">
						{#if editable}
							{@render sectionRow(g.key, tf('users.access_whole_group', 'All sections in this group'), true)}
						{/if}
						{#each g.sections as s (s.key)}
							{@render sectionRow(s.key, label(sectionLabelKeys(s.key), s.label), false)}
						{/each}
					</ul>
				</FormSection>
			{/each}

			<FormSection title={t('users.client_features')}>
				<ul class="rows">
					{#each catalog.features as f (f.key)}
						{@const eff = effective?.features[f.key]}
						{@const text = label(`users.access_feature_${f.key}`, f.label)}
						<li class="row" data-feature={f.key}>
							<span class="text">
								{#if editable && !f.hardLock}
									<label class="name" for="{uid}-f-{f.key}">{text}</label>
								{:else}
									<span class="name">{text}</span>
								{/if}
								{#if f.hardLock}
									<span class="now">{tf('users.access_locked', 'Always off')}</span>
								{:else if eff}
									<span class="now" id="{uid}-f-{f.key}-now">{featureNow(eff.enabled, eff.source)}</span>
								{/if}
							</span>
							{#if editable && !f.hardLock}
								<Select
									id="{uid}-f-{f.key}"
									small
									options={featureOptions}
									aria-describedby={eff ? `${uid}-f-${f.key}-now` : undefined}
									bind:value={form.values.features[f.key]}
								/>
							{/if}
						</li>
					{/each}
				</ul>
			</FormSection>
		</form>
	{/if}
{/snippet}

<Sheet
	wide
	class="access-sheet"
	title={tf('users.access_sheet_title', 'Panel access for {name}', { name })}
	subtitle={editable ? t('users.access_policy_hint') : undefined}
	status={editable ? form.status.message : undefined}
	statusTone={form.status.state === 'error' ? 'error' : form.status.state === 'saved' ? 'ok' : 'neutral'}
	beforeclose={() => !form.busy}
	{onclose}
>
	{#snippet body(parts: SheetParts)}
		{#if editable}
			<div class="sheet-body">{@render content()}</div>
		{:else}
			<!-- Nothing in the list takes focus without controls, so the list does, to scroll it with the keyboard -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div class="sheet-body" tabindex="0" role="region" aria-labelledby={parts.titleId}>
				{@render content()}
			</div>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if editable}
			<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
			<Button variant="primary" type="submit" form={form.id} busy={form.busy} disabled={!catalog}
				>{t('actions.save')}</Button
			>
		{:else}
			<Button onclick={onclose}>{t('actions.close')}</Button>
		{/if}
	{/snippet}
</Sheet>

<style>
	.access-form {
		display: block;
	}
	.note {
		margin: 0 0 var(--space-4);
		max-width: var(--measure);
		color: var(--text-muted);
	}
	.access-form :global(.notice) {
		margin-bottom: var(--space-4);
	}
	.access-form :global(.facts) {
		margin-bottom: var(--space-4);
	}
	.rows {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.row.is-group {
		background: var(--bg-subtle);
	}
	.text {
		display: flex;
		flex: 1 1 14rem;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.name {
		font-weight: 600;
	}
	.row:not(.is-group) .name {
		font-weight: 400;
	}
	.now {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.warn {
		color: var(--warning);
		font-size: var(--text-sm);
	}
	.row :global(select) {
		flex: 0 0 auto;
		width: 14rem;
		max-width: 100%;
	}
	@media (max-width: 480px) {
		.row :global(select) {
			width: 100%;
		}
	}
</style>
