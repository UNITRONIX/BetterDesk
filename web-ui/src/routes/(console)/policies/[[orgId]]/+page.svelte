<!--
  Organization policies (/policies, /policies/<orgId>). Five groups of
  settings per organization (connection, features, security, network,
  updates), each stored on its own; one Save sends only the groups that
  changed, so untouched groups stay "Not set". Below the form, the change
  log; beside it, the organization and the contents with each group's state.

  URL: the organization is in the path. Choosing another one rewrites the
  address (replaceState), as the old page did; with a single organization
  it opens without one. An unknown ID in the address says so.

  Who: the four admin roles (requireAdmin); everyone else gets the 403 text.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		countOrgDevices,
		countOrgUsers,
		getPolicies,
		getPolicyAudit,
		listOrgs,
		savePolicyGroup,
		type AuditEntry,
		type Org,
		type Policies
	} from '#lib/api/policies.ts';
	import { ApiError } from '#lib/api/client.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { isAdminRole } from '#lib/rules/access.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		auditSection,
		auditTime,
		bodyFor,
		changedSections,
		invalidNumbers,
		isSet,
		NUMBER_LIMITS,
		SECTION_TITLE,
		SECTIONS,
		setCount,
		valuesFrom,
		type NumberField,
		type PolicyValues,
		type Section
	} from '#lib/rules/policies.ts';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { warnOnLeave, type FormStatus } from '#lib/ui/form.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';

	const allowed = $derived(isAdminRole(session.user?.role));
	$effect(() => setPageTitle(t('nav.policies')));

	/* ── Organizations ── */

	let orgs = $state.raw<Org[]>([]);
	let orgsState = $state<'loading' | 'ready' | 'error'>('loading');

	async function loadOrgs() {
		orgsState = 'loading';
		try {
			orgs = await listOrgs();
			orgsState = 'ready';
		} catch {
			orgsState = 'error';
		}
	}

	$effect(() => {
		if (allowed) untrack(() => void loadOrgs());
	});

	const urlOrg = $derived(page.params.orgId ?? null);
	// With one organization there is nothing to choose
	const orgId = $derived(
		urlOrg ?? (orgsState === 'ready' && orgs.length === 1 ? (orgs[0]?.id ?? null) : null)
	);
	const org = $derived(orgs.find((o) => o.id === orgId) ?? null);
	const notFound = $derived(orgsState === 'ready' && !!urlOrg && !org);

	/* ── The open organization's policies ── */

	let policies = $state.raw<Policies | null>(null);
	let loadState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
	let values = $state<PolicyValues>(valuesFrom({}));
	let loaded = $state.raw<PolicyValues>(valuesFrom({}));
	let seq = 0;

	async function loadPolicies(id: string, quiet = false) {
		const mine = ++seq;
		if (!quiet) loadState = 'loading';
		try {
			const p = await getPolicies(id);
			if (mine !== seq) return;
			policies = p;
			if (!quiet) {
				const v = valuesFrom(p);
				values = v;
				loaded = $state.snapshot(v) as PolicyValues;
				errors = {};
				status = { state: 'idle', message: '' };
			}
			loadState = 'ready';
		} catch {
			if (mine !== seq || quiet) return;
			loadState = 'error';
		}
	}

	$effect(() => {
		const id = org?.id ?? null;
		untrack(() => {
			if (!id) {
				seq++;
				policies = null;
				loadState = 'idle';
				audit = null;
				return;
			}
			void loadPolicies(id);
			void loadAudit(id);
			void loadCounts(id);
		});
	});

	$effect(() =>
		onRefresh(() => {
			if (!org) return void loadOrgs();
			if (!dirty) void loadPolicies(org.id);
			void loadAudit(org.id);
			void loadCounts(org.id);
		})
	);

	const changed = $derived(changedSections(values, loaded));
	const dirty = $derived(changed.length > 0);
	$effect(() => warnOnLeave(() => dirty));

	/* ── Choosing an organization ── */

	// Follows the address; set back when a discard is refused
	let selected = $derived(orgId ?? '');
	/** Focus goes to the first group after a pick from the list, as before */
	let focusFirst = false;

	async function pickOrg(next: string) {
		if (next === (orgId ?? '')) return;
		if (dirty) {
			const ok = await confirm({
				title: t('policies.discard_title'),
				message: t('policies.discard_message'),
				confirmLabel: t('policies.discard_confirm'),
				danger: true
			});
			if (!ok) {
				selected = orgId ?? '';
				return;
			}
			values = $state.snapshot(loaded) as PolicyValues;
		}
		await goto(
			next
				? resolve('/(console)/policies/[[orgId]]', { orgId: next })
				: resolve('/(console)/policies/[[orgId]]', {}),
			{ replace: true, reset: false }
		);
	}

	$effect(() => {
		if (loadState !== 'ready' || !focusFirst) return;
		focusFirst = false;
		untrack(() => {
			const h = document.getElementById('pol-connection-title');
			h?.focus({ preventScroll: true });
		});
	});

	/* ── Side column ── */

	let deviceCount = $state<number | null | undefined>(undefined);
	let peopleCount = $state<number | null | undefined>(undefined);
	const canPeople = $derived(can('user.view') && can('org.manage_users'));

	async function loadCounts(id: string) {
		deviceCount = undefined;
		peopleCount = undefined;
		const [d, p] = await Promise.all([
			countOrgDevices(id).catch(() => null),
			canPeople ? countOrgUsers(id).catch(() => null) : Promise.resolve(null)
		]);
		if (org?.id !== id) return;
		deviceCount = d;
		peopleCount = p;
	}

	const facts = $derived([
		{
			label: t('nav.devices'),
			value:
				deviceCount === undefined
					? '…'
					: deviceCount === null
						? t('policies.count_unknown')
						: formatNumber(deviceCount)
		},
		...(canPeople && peopleCount !== null
			? [
					{
						label: t('policies.fact_people'),
						value: peopleCount === undefined ? '…' : formatNumber(peopleCount)
					}
				]
			: []),
		{
			label: t('policies.fact_groups_set'),
			value: t('policies.groups_set_value', { set: setCount(policies), total: SECTIONS.length })
		}
	]);

	/* ── Contents: which group is in view ── */

	let inView = $state<Section | null>(null);
	$effect(() => {
		if (loadState !== 'ready' || typeof IntersectionObserver !== 'function') return;
		const seen: Record<string, boolean> = {};
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) seen[e.target.id] = e.isIntersecting;
				const first = SECTIONS.find((s) => seen[`pol-${s}-title`]);
				if (first) inView = first;
			},
			{ rootMargin: '-80px 0px -55% 0px' }
		);
		for (const s of SECTIONS) {
			const el = document.getElementById(`pol-${s}-title`);
			if (el) io.observe(el);
		}
		return () => io.disconnect();
	});

	/* ── Save ── */

	let errors = $state<Partial<Record<NumberField, { message: string; value: unknown }>>>({});
	let status = $state<FormStatus>({ state: 'idle', message: '' });
	let saving = $state(false);

	function numberOf(field: NumberField): unknown {
		const [s, k] = field.split('.') as [Section, string];
		return (values[s] as Record<string, unknown>)[k];
	}
	// An error stays while its field keeps the refused value
	function errorOf(field: NumberField): string | undefined {
		const e = errors[field];
		return e && Object.is(e.value, numberOf(field)) ? e.message : undefined;
	}

	const LABEL: Readonly<Record<NumberField, string>> = {
		'connection.max_session_duration': 'policies.max_session',
		'connection.idle_lock_timeout': 'policies.idle_lock',
		'security.password_min_length': 'policies.password_min_length',
		'security.password_max_age_days': 'policies.password_max_age'
	};
	const fieldId = (field: NumberField) => 'pol-' + field.replace(/[._]/g, '-');

	async function save(e: SubmitEvent) {
		e.preventDefault();
		if (saving || !org) return;
		const sections = changed;
		if (!sections.length) {
			status = { state: 'saved', message: t('policies.no_changes') };
			return;
		}
		// Check everything first, so a typo doesn't leave the save half done
		const bad = invalidNumbers(values, sections);
		if (bad.length) {
			const next: typeof errors = {};
			for (const f of bad) {
				const [min, max] = NUMBER_LIMITS[f];
				next[f] = {
					message: t('policies.invalid_number', { field: t(LABEL[f]), min, max }),
					value: numberOf(f)
				};
			}
			errors = next;
			status = { state: 'error', message: next[bad[0] as NumberField]?.message ?? '' };
			document.getElementById(fieldId(bad[0] as NumberField))?.focus();
			return;
		}
		errors = {};
		saving = true;
		status = { state: 'saving', message: t('ui_form.saving') };
		const id = org.id;
		const snapshot = $state.snapshot(values) as PolicyValues;
		const failed: string[] = [];
		const next = $state.snapshot(loaded) as PolicyValues;
		try {
			// Each group has its own endpoint: save every changed one, then name the ones that failed
			for (const s of sections) {
				try {
					await savePolicyGroup(id, s, bodyFor(s, snapshot));
					(next as Record<Section, unknown>)[s] = snapshot[s];
				} catch (err) {
					failed.push(`${t(SECTION_TITLE[s])} (${err instanceof ApiError ? err.message : ''})`);
				}
			}
			loaded = next;
			status = failed.length
				? {
						state: 'error',
						message: `${t('ui_form.save_failed')} ${t('policies.save_failed_groups', { groups: failed.join(', ') })}`
					}
				: { state: 'saved', message: t('policies.save_success') };
			if (failed.length < sections.length) {
				// The group states and the change log
				void loadPolicies(id, true);
				void loadAudit(id);
			}
		} finally {
			saving = false;
		}
	}

	/* ── Change log ── */

	let audit = $state.raw<AuditEntry[] | null>(null);
	let auditError = $state(false);

	async function loadAudit(id: string) {
		auditError = false;
		try {
			const list = await getPolicyAudit(id);
			if (org?.id === id) audit = list;
		} catch {
			if (org?.id === id) auditError = true;
		}
	}

	const sectionName = (cat: string) =>
		(SECTIONS as readonly string[]).includes(cat) ? t(SECTION_TITLE[cat as Section]) : cat;

	const auditColumns = $derived<Column<AuditEntry>[]>([
		{ id: 'time', label: t('policies.col_time'), cell: timeCell, class: 'col-time' },
		{ id: 'policy', label: t('policies.col_policy'), cell: policyCell },
		{ id: 'source', label: t('policies.col_source'), cell: sourceCell }
	]);
	const auditRows = $derived((audit ?? []).map((e, i) => ({ ...e, key: `${auditTime(e)}-${i}` })));

	/* ── Options ── */

	const modeOptions = $derived([
		{ value: 'attended', label: t('policies.mode_attended') },
		{ value: 'unattended', label: t('policies.mode_unattended') },
		{ value: 'ask_always', label: t('policies.mode_ask') }
	]);
	const wallpaperOptions = $derived([
		{ value: 'show', label: t('policies.wallpaper_show') },
		{ value: 'hide_during_session', label: t('policies.wallpaper_hide_session') },
		{ value: 'hide_always', label: t('policies.wallpaper_hide_always') }
	]);
	const channelOptions = $derived([
		{ value: 'stable', label: t('policies.channel_stable') },
		{ value: 'beta', label: t('policies.channel_beta') },
		{ value: 'dev', label: t('policies.channel_dev') }
	]);
	const orgOptions = $derived([
		{ value: '', label: t('policies.select_org_placeholder') },
		...orgs.map((o) => ({ value: o.id, label: o.name || o.id }))
	]);
</script>

{#snippet timeCell(e: AuditEntry)}<Time value={auditTime(e)} />{/snippet}

{#snippet policyCell(e: AuditEntry)}{@const cat = auditSection(e)}{#if cat}<Tag
			label={sectionName(cat)}
		/>{:else}<Empty />{/if}{#if e.detail || e.description}<span class="cell-sub"
			>{e.detail || e.description}</span
		>{/if}{/snippet}

{#snippet sourceCell(e: AuditEntry)}{#if e.actor || e.user}<User user={e.actor || e.user} />{:else}<Empty
		/>{/if}{#if e.target}<span class="cell-sub">{e.target}</span>{/if}{/snippet}

{#snippet sectionState(s: Section)}<span class={['policy-state', isSet(policies?.[s]) && 'is-set']}
		>{isSet(policies?.[s]) ? t('policies.configured') : t('policies.not_configured')}</span
	>{/snippet}

{#snippet toc(side: boolean)}
	<nav class={['policy-toc', side ? 'is-side' : 'is-inline']} aria-label={t('policies.on_this_page')}>
		<ul class="toc">
			{#each SECTIONS as s (s)}
				<li>
					<a href="#pol-{s}-title" aria-current={inView === s ? 'true' : undefined}>{t(SECTION_TITLE[s])}</a>
					{#if side}{@render sectionState(s)}{/if}
				</li>
			{/each}
			<li><a href="#pol-audit-title">{t('policies.audit_title')}</a></li>
		</ul>
	</nav>
{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide policy-page">
		<div class="page-head">
			<h1>{t('nav.policies')}</h1>
			<p class="page-description">{t('policies.page_description')}</p>
		</div>

		{#if orgsState === 'loading'}
			<States kind="loading" message={t('policies.loading')} />
		{:else if orgsState === 'error'}
			<States kind="error" message={t('policies.orgs_failed')} onretry={() => void loadOrgs()} />
		{:else if !orgs.length}
			<States kind="empty" message={t('policies.no_orgs')} />
		{:else}
			<div class="form-column org-field">
				<Field label={t('policies.select_org')} hint={t('policies.org_hint')} width="host">
					{#snippet children(f)}
						<Select
							{...f}
							options={orgOptions}
							bind:value={selected}
							onchange={() => void pickOrg(selected)}
						/>
					{/snippet}
				</Field>
			</div>

			{#if notFound}
				<Notice tone="danger" role="alert" message={t('policies.org_not_found')} />
			{/if}

			{#if !org}
				<section class="section org-pick" aria-labelledby="policy-org-pick-title">
					<h2 id="policy-org-pick-title" class="sr-only">{t('policies.select_org')}</h2>
					{#if !notFound}<p class="state-line">{t('policies.pick_org_state')}</p>{/if}
					<!-- Opening one replaces the address, like choosing it in the select -->
					<div
						class="org-list"
						data-sveltekit-replacestate
						data-sveltekit-noscroll
						onclickcapture={() => (focusFirst = true)}
						role="presentation"
					>
						<RowList label={t('policies.select_org')}>
							{#each orgs as o (o.id)}
								<ListRow
									title={o.name || o.id}
									href={resolve('/(console)/policies/[[orgId]]', { orgId: o.id })}
								/>
							{/each}
						</RowList>
					</div>
				</section>
			{:else if loadState === 'loading' || loadState === 'idle'}
				<States kind="loading" message={t('policies.loading')} />
			{:else if loadState === 'error'}
				<States kind="error" message={t('policies.load_failed')} onretry={() => void loadPolicies(org.id)} />
			{:else}
				<div class="page-cols policy-cols">
					<div class="page-main">
						{@render toc(false)}

						<form class="policy-form" autocomplete="off" novalidate onsubmit={save}>
							<div class="policy-groups">
								<section class="section" aria-labelledby="pol-connection-title">
									<div class="section-head">
										<h2 id="pol-connection-title" tabindex="-1">{t('policies.connection_title')}</h2>
										{@render sectionState('connection')}
									</div>
									<p class="section-note">{t('policies.connection_desc')}</p>
									<Field label={t('policies.connection_mode')}>
										{#snippet children(f)}<Select
												{...f}
												options={modeOptions}
												bind:value={values.connection.mode}
											/>{/snippet}
									</Field>
									<Field
										id={fieldId('connection.max_session_duration')}
										label={t('policies.max_session')}
										hint={t('policies.max_session_hint')}
										error={errorOf('connection.max_session_duration')}
										width="short"
									>
										{#snippet children(f)}<Input
												{...f}
												type="number"
												min={0}
												max={1440}
												step={1}
												inputmode="numeric"
												bind:value={values.connection.max_session_duration}
											/>{/snippet}
									</Field>
									<Field
										id={fieldId('connection.idle_lock_timeout')}
										label={t('policies.idle_lock')}
										hint={t('policies.idle_lock_hint')}
										error={errorOf('connection.idle_lock_timeout')}
										width="short"
									>
										{#snippet children(f)}<Input
												{...f}
												type="number"
												min={0}
												max={120}
												step={1}
												inputmode="numeric"
												bind:value={values.connection.idle_lock_timeout}
											/>{/snippet}
									</Field>
									<Field label={t('policies.wallpaper_policy')}>
										{#snippet children(f)}<Select
												{...f}
												options={wallpaperOptions}
												bind:value={values.connection.wallpaper}
											/>{/snippet}
									</Field>
									<p class="field-effect">{t('policies.effect_device')}</p>
								</section>

								<section class="section" aria-labelledby="pol-features-title">
									<div class="section-head">
										<h2 id="pol-features-title" tabindex="-1">{t('policies.features_title')}</h2>
										{@render sectionState('features')}
									</div>
									<p class="section-note">{t('policies.features_desc')}</p>
									<div class="checks">
										<Checkbox
											label={t('policies.allow_file_transfer')}
											bind:checked={values.features.allow_file_transfer}
										/>
										<Checkbox
											label={t('policies.allow_clipboard')}
											bind:checked={values.features.allow_clipboard}
										/>
										<Checkbox label={t('policies.allow_audio')} bind:checked={values.features.allow_audio} />
										<Checkbox
											label={t('policies.allow_recording')}
											bind:checked={values.features.allow_recording}
										/>
									</div>
									<p class="field-effect">{t('policies.effect_device')}</p>
								</section>

								<section class="section" aria-labelledby="pol-security-title">
									<div class="section-head">
										<h2 id="pol-security-title" tabindex="-1">{t('policies.security_title')}</h2>
										{@render sectionState('security')}
									</div>
									<p class="section-note">{t('policies.security_desc')}</p>
									<Checkbox label={t('policies.require_2fa')} bind:checked={values.security.require_2fa} />
									<Field
										id={fieldId('security.password_min_length')}
										label={t('policies.password_min_length')}
										hint={t('policies.password_min_hint')}
										error={errorOf('security.password_min_length')}
										width="short"
									>
										{#snippet children(f)}<Input
												{...f}
												type="number"
												min={6}
												max={128}
												step={1}
												inputmode="numeric"
												bind:value={values.security.password_min_length}
											/>{/snippet}
									</Field>
									<Checkbox
										label={t('policies.password_require_special')}
										bind:checked={values.security.password_require_special}
									/>
									<Field
										id={fieldId('security.password_max_age_days')}
										label={t('policies.password_max_age')}
										hint={t('policies.password_max_age_hint')}
										error={errorOf('security.password_max_age_days')}
										width="short"
									>
										{#snippet children(f)}<Input
												{...f}
												type="number"
												min={0}
												max={365}
												step={1}
												inputmode="numeric"
												bind:value={values.security.password_max_age_days}
											/>{/snippet}
									</Field>
									<Field label={t('policies.allowed_operators')} hint={t('policies.allowed_operators_hint')}>
										{#snippet children(f)}<Input
												{...f}
												placeholder={tf('policies.allowed_operators_example', 'admin, helpdesk')}
												bind:value={values.security.allowed_operators}
											/>{/snippet}
									</Field>
									<p class="field-effect">{t('policies.effect_device')}</p>
								</section>

								<section class="section" aria-labelledby="pol-network-title">
									<div class="section-head">
										<h2 id="pol-network-title" tabindex="-1">{t('policies.network_title')}</h2>
										{@render sectionState('network')}
									</div>
									<p class="section-note">{t('policies.network_desc')}</p>
									<Checkbox
										label={t('policies.block_direct_p2p')}
										hint={t('policies.block_direct_p2p_hint')}
										effect={t('policies.effect_server')}
										bind:checked={values.network.block_direct_p2p}
									/>
									<Field
										label={t('policies.allowed_relays')}
										hint={t('policies.allowed_relays_hint')}
										effect={t('policies.effect_server')}
									>
										{#snippet children(f)}<Textarea
												{...f}
												class="mono"
												rows={3}
												dir="ltr"
												spellcheck={false}
												placeholder={tf('policies.allowed_relays_example', 'relay1.example.com:21117')}
												bind:value={values.network.allowed_relay_servers}
											/>{/snippet}
									</Field>
									<Field
										label={t('policies.ip_allowlist')}
										hint={t('policies.ip_allowlist_hint')}
										effect={t('policies.effect_device')}
									>
										{#snippet children(f)}<Textarea
												{...f}
												class="mono"
												rows={3}
												dir="ltr"
												spellcheck={false}
												placeholder={tf('policies.ip_allowlist_example', '192.168.1.0/24')}
												bind:value={values.network.ip_allowlist}
											/>{/snippet}
									</Field>
								</section>

								<section class="section" aria-labelledby="pol-update-title">
									<div class="section-head">
										<h2 id="pol-update-title" tabindex="-1">{t('policies.update_title')}</h2>
										{@render sectionState('update')}
									</div>
									<p class="section-note">{t('policies.update_desc')}</p>
									<Checkbox label={t('policies.auto_update')} bind:checked={values.update.auto_update} />
									<Field
										label={t('policies.update_channel')}
										hint={t('policies.update_channel_hint')}
										width="medium"
									>
										{#snippet children(f)}<Select
												{...f}
												options={channelOptions}
												bind:value={values.update.channel}
											/>{/snippet}
									</Field>
									<p class="field-effect">{t('policies.effect_device')}</p>
								</section>
							</div>

							<SaveBar label={t('policies.save_button')} {dirty} busy={saving} {status} />
						</form>

						<section class="section" aria-labelledby="pol-audit-title">
							<h2 id="pol-audit-title">{t('policies.audit_title')}</h2>
							<p class="section-note">{t('policies.audit_desc')}</p>
							{#if auditError}
								<States
									kind="error"
									message={t('policies.audit_failed')}
									onretry={() => void loadAudit(org.id)}
								/>
							{:else if audit === null}
								<States kind="loading" message={t('policies.audit_loading')} />
							{:else if !audit.length}
								<States kind="empty" message={t('policies.no_audit')} />
							{:else}
								<CountLine text={t('policies.audit_count')} values={{ count: audit.length }} />
								<Table
									rows={auditRows}
									columns={auditColumns}
									key={(e) => e.key}
									label={t('policies.audit_title')}
								/>
							{/if}
						</section>
					</div>

					<aside class="page-side is-sticky policy-side" aria-labelledby="policy-org-name">
						<section class="section org-summary">
							<h2 id="policy-org-name">{org.name || org.id}</h2>
							<Facts items={facts} />
							<p class="hint">{t('policies.groups_default_hint')}</p>
							<p>
								<a href={link(`/organizations/${encodeURIComponent(org.id)}`)}>{t('policies.open_org')}</a>
							</p>
						</section>
						{@render toc(true)}
					</aside>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	/* Addresses, IDs, lists and JSON in the monospace font */
	.policy-form :global(.form-input.mono) {
		font-family: var(--mono);
	}
	.org-field :global(.form-select) {
		max-width: 40ch;
	}
	.state-line {
		margin: 0;
		color: var(--text-muted);
	}
	.org-list {
		max-width: var(--measure);
	}

	.policy-form .section + .section {
		margin-top: var(--space-6);
	}
	.policy-form {
		max-width: var(--measure);
	}
	.checks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* "Set for this organization" / "Not set" next to the heading and in the contents */
	.policy-state {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.policy-state.is-set {
		color: var(--text);
	}
	.section-head h2:focus {
		outline: none;
	}
	.policy-form h2[id],
	.policy-page h2[id] {
		scroll-margin-top: calc(var(--topbar-h) + var(--space-4));
	}

	/* Wide screens: the groups sit side by side, each whole in one column,
	   read top to bottom then across */
	@media (min-width: 1600px) {
		.policy-form {
			max-width: none;
		}
		.policy-groups {
			columns: 440px 3;
			column-gap: var(--space-7);
		}
		.policy-groups > .section {
			break-inside: avoid;
			max-width: var(--measure);
			padding-bottom: var(--space-6);
		}
		.policy-form .policy-groups > .section + .section {
			margin-top: 0;
		}
	}

	/* Contents: one row of links above the form; in the side column from 1200 px */
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.toc a {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h-sm);
		color: var(--text-muted);
	}
	.toc a:hover,
	.toc a[aria-current='true'] {
		color: var(--text);
	}
	.policy-toc.is-side {
		display: none;
	}
	.policy-toc.is-side .toc {
		flex-direction: column;
		flex-wrap: nowrap;
		gap: var(--space-2);
	}
	.policy-toc.is-side li {
		display: flex;
		flex-direction: column;
	}
	.policy-toc.is-side a {
		font-weight: 600;
	}
	@media (min-width: 1200px) {
		.policy-toc.is-side {
			display: block;
		}
		.policy-toc.is-inline {
			display: none;
		}
	}
	@media (pointer: coarse) {
		.toc a {
			min-height: 44px;
		}
	}

	.org-summary h2 {
		overflow-wrap: anywhere;
	}
	.org-summary p {
		margin: 0;
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.policy-page :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.policy-page :global(td.col-time) {
		white-space: nowrap;
	}
</style>
