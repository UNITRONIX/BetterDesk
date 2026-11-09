<!--
  Device tokens (/tokens): tokens that let a new device join without
  waiting for approval, and the enrollment mode that decides which new
  devices may join. Create one token or several (each shown once), edit
  and revoke from the row menu. The mode is saved as soon as it is picked;
  in Open and Locked mode a notice above the list says what tokens do then.

  Needs enrollment.manage (the route and every call). The link to
  Enrollment requests (Managed mode only) needs enrollment.approve.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getEnrollmentMode, setEnrollmentMode, type EnrollmentMode } from '#lib/api/enrollment.ts';
	import { listTokens, revokeToken, type DeviceToken, type NewToken } from '#lib/api/tokens.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		countTokens,
		filterTokens,
		tokenMenu,
		tokenStatus,
		type TokenFilter
	} from '#lib/clients/tokens.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import States from '#lib/ui/States.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Steps from '#lib/ui/Steps.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import BulkDialog from './BulkDialog.svelte';
	import CreatedDialog from './CreatedDialog.svelte';
	import TokenDialog from './TokenDialog.svelte';

	const allowed = can('enrollment.manage');
	/** Dates without the clock time; the full date and time are in the tooltip */
	const DATE_ONLY: Intl.DateTimeFormatOptions = { hour: undefined, minute: undefined };

	/* ── Tokens ── */

	let tokens = $state.raw<DeviceToken[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);

	async function load(): Promise<void> {
		if (!allowed) return;
		try {
			tokens = await listTokens();
			loadError = null;
		} catch (err) {
			tokens = [];
			loadError = `${t('tokens.load_failed')} ${err instanceof Error ? err.message : ''}`.trim();
		} finally {
			loaded = true;
		}
	}

	/* ── Mode ── */

	let mode = $state<EnrollmentMode | undefined>(undefined);
	/** The mode the server has; the choice goes back to it when a change fails */
	let savedMode = $state<EnrollmentMode | undefined>(undefined);
	let modeBusy = $state(false);
	let modeStatus = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' }>({
		message: '',
		tone: 'neutral'
	});

	/** The first mode request has answered, either way */
	let modeSettled = $state(false);

	async function loadMode(): Promise<void> {
		if (!allowed) return;
		try {
			mode = savedMode = (await getEnrollmentMode()) ?? 'open';
			modeStatus = { message: '', tone: 'neutral' };
		} catch (err) {
			modeStatus = {
				message: `${t('tokens.mode_load_failed')} ${err instanceof Error ? err.message : ''}`.trim(),
				tone: 'error'
			};
		} finally {
			modeSettled = true;
		}
	}

	async function changeMode(next: EnrollmentMode) {
		modeBusy = true;
		modeStatus = { message: t('tokens.mode_saving'), tone: 'neutral' };
		try {
			await setEnrollmentMode(next);
			savedMode = next;
			modeStatus = { message: t('tokens.mode_saved', { mode: t(`tokens.mode_${next}`) }), tone: 'ok' };
		} catch (err) {
			mode = savedMode;
			modeStatus = {
				message: `${t('tokens.mode_save_failed')} ${err instanceof Error ? err.message : ''}`.trim(),
				tone: 'error'
			};
		} finally {
			modeBusy = false;
		}
	}

	$effect(() =>
		untrack(() => {
			void loadMode();
			void load();
		})
	);
	$effect(() => onRefresh(() => void Promise.all([load(), loadMode()])));

	const modeChoices = $derived(
		(['open', 'managed', 'locked'] as const).map((m) => ({
			value: m,
			title: t(`tokens.mode_${m}`),
			description: t(`tokens.mode_${m}_desc`)
		}))
	);
	// In Managed mode new devices without a token wait under Enrollment requests
	const showRequests = $derived(savedMode === 'managed' && can('enrollment.approve'));
	const modeNotice = $derived(
		savedMode === 'open'
			? t('tokens.mode_notice_open')
			: savedMode === 'locked'
				? t('tokens.mode_notice_locked')
				: ''
	);

	/* ── List ── */

	let filter = $state<TokenFilter>('all');
	let query = $state('');
	const shown = $derived(filterTokens(tokens, filter, query));
	const counts = $derived(countTokens(tokens));
	const countText = $derived.by(() => {
		const parts = [
			t('tokens.count_pending', { count: formatNumber(counts.pending) }),
			t('tokens.count_used', { count: formatNumber(counts.active) })
		];
		if (counts.expired) parts.push(t('tokens.count_expired', { count: formatNumber(counts.expired) }));
		if (counts.revoked) parts.push(t('tokens.count_revoked', { count: formatNumber(counts.revoked) }));
		return parts.join(', ');
	});

	const filterOptions = $derived([
		{ value: 'all' as const, label: t('common.all') },
		{ value: 'pending' as const, label: t('tokens.status_pending') },
		{ value: 'active' as const, label: t('tokens.status_used') },
		{ value: 'revoked' as const, label: t('tokens.status_revoked') }
	]);

	/* ── Dialogs ── */

	let editing = $state<{ token: DeviceToken | null } | null>(null);
	let bulk = $state(false);
	let created = $state.raw<NewToken[] | null>(null);

	/** Edited, or created without a value to show: a toast; created: the new token, once */
	function saved(token: NewToken | null) {
		editing = null;
		if (token) created = [token];
		else toast.success(t('tokens.saved'));
		void load();
	}

	async function revoke(tok: DeviceToken) {
		const ok = await confirm({
			title: t('tokens.revoke_title'),
			message: t('tokens.revoke_confirm'),
			confirmLabel: t('tokens.revoke'),
			confirmIcon: ICONS.revoke,
			danger: true
		});
		if (!ok) return;
		try {
			await revokeToken(tok.id);
			toast.success(t('tokens.revoked_success', { name: tok.name }));
			void load();
		} catch (err) {
			toast.error(`${t('tokens.revoke_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		}
	}

	let menuFor = $state<string | null>(null);

	const columns = $derived<Column<DeviceToken>[]>([
		{ id: 'name', label: t('tokens.name'), cell: nameCell, class: 'col-name' },
		{ id: 'status', label: t('tokens.status'), cell: statusCell, class: 'col-status' },
		{ id: 'uses', label: t('tokens.uses'), cell: usesCell, align: 'num', class: 'col-uses' },
		{ id: 'peer', label: t('tokens.bound_peer'), cell: peerCell, class: 'col-peer' },
		{ id: 'expires', label: t('tokens.expires'), cell: expiresCell, class: 'col-expires' },
		{ id: 'created', label: t('tokens.created'), cell: createdCell, class: 'col-created' },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet nameCell(tok: DeviceToken)}<span class="token-name">{tok.name || '–'}</span
	>{#if tok.token_prefix || tok.note}<span class="cell-sub token-sub"
			>{#if tok.token_prefix}<span class="mono">{tok.token_prefix}…</span>{/if}{#if tok.note}<span
					>{tok.note}</span
				>{/if}</span
		>{/if}{/snippet}

{#snippet statusCell(tok: DeviceToken)}{@const st = tokenStatus(tok)}<Status
		tone={st.tone}
		label={t(`tokens.${st.label}`)}
	/>{/snippet}

{#snippet usesCell(tok: DeviceToken)}{tok.max_uses === 0
		? t('tokens.uses_unlimited', { count: formatNumber(tok.use_count) })
		: t('tokens.uses_of', { count: formatNumber(tok.use_count), max: formatNumber(tok.max_uses) })}{/snippet}

{#snippet peerCell(tok: DeviceToken)}<ValueCopy value={tok.peer_id} label={tok.peer_id} />{/snippet}

{#snippet expiresCell(tok: DeviceToken)}<Time
		value={tok.expires_at}
		relative={false}
		format={DATE_ONLY}
		empty={t('tokens.never')}
	/>{/snippet}

{#snippet createdCell(tok: DeviceToken)}<Time
		value={tok.created_at}
		relative={false}
		format={DATE_ONLY}
	/>{#if tok.created_by}<span class="cell-sub"><User user={tok.created_by} /></span>{/if}{/snippet}

{#snippet actionsCell(tok: DeviceToken)}{#if tokenMenu(tok)}<MenuButton
			kebab
			label={t('tokens.actions_for', { name: tok.name })}
			bind:open={
				() => menuFor === tok.id, (v) => (menuFor = v ? tok.id : menuFor === tok.id ? null : menuFor)
			}
		>
			<MenuItem class="act-edit" icon={ICONS.edit} onselect={() => (editing = { token: tok })}
				>{t('common.edit')}</MenuItem
			>
			<MenuDivider />
			<MenuItem class="act-revoke" icon={ICONS.revoke} danger onselect={() => void revoke(tok)}
				>{t('tokens.revoke')}</MenuItem
			>
		</MenuButton>{/if}{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide tokens-page">
		<div class="page-head">
			<h1>{t('nav.tokens')}</h1>
			<p class="page-description">{t('tokens.page_description')}</p>
			<div class="page-actions">
				<Button icon={ICONS.add} class="act-bulk" onclick={() => (bulk = true)}
					>{t('tokens.bulk_generate')}</Button
				>
				<Button
					variant="primary"
					icon={ICONS.add}
					class="act-create"
					onclick={() => (editing = { token: null })}>{t('tokens.create')}</Button
				>
			</div>
		</div>

		<!-- The mode decides the notice above the list: the columns are drawn once
		     the list and the mode are in, so nothing moves down as they arrive -->
		{#if !loaded || !modeSettled}
			<States kind="loading" message={t('tokens.loading')} />
		{:else}
			<div class="page-cols">
				<div class="page-main">
					<section class="section" aria-labelledby="tokens-list-title">
						<div class="section-head"><h2 id="tokens-list-title">{t('tokens.list_title')}</h2></div>
						{#if modeNotice}<Notice class="tokens-mode-notice" message={modeNotice} />{/if}
						<Toolbar>
							{#snippet search()}<SearchField
									label={t('tokens.search_placeholder')}
									bind:value={query}
								/>{/snippet}
							<SegmentedFilter label={t('tokens.status')} options={filterOptions} bind:value={filter} />
						</Toolbar>
						{#if loaded && !loadError && tokens.length}
							<p class="count-line" aria-live="polite">
								<strong>{formatNumber(tokens.length)}</strong>
								{t('tokens.count_total')}: {countText}
							</p>
						{/if}
						<div class="tokens-table">
							<Table
								rows={shown}
								{columns}
								key={(tok) => tok.id}
								label={t('tokens.list_title')}
								loading={!loaded}
								loadingText={t('tokens.loading')}
								error={loadError}
								onretry={() => void load()}
								emptyText={tokens.length ? t('tokens.no_match') : t('tokens.no_tokens')}
							/>
						</div>
					</section>
				</div>

				<aside class="page-side" aria-label={t('tokens.enrollment_mode')}>
					<section class="section" aria-labelledby="enrollment-mode-title">
						<div class="section-head"><h2 id="enrollment-mode-title">{t('tokens.enrollment_mode')}</h2></div>
						<p class="section-note">{t('tokens.enrollment_mode_note')}</p>
						<ChoiceList
							choices={modeChoices}
							labelledby="enrollment-mode-title"
							name="enrollment_mode"
							disabled={modeBusy}
							bind:value={mode}
							onchange={(v, on) => {
								if (on) void changeMode(v);
							}}
						/>
						<FormStatus message={modeStatus.message} tone={modeStatus.tone} />
						{#if showRequests}
							<p class="mode-next">
								<a href={link('/registrations')}>{t('nav.registrations')}</a>: {t('keys.next_requests_sub')}
							</p>
						{/if}
					</section>

					<section class="section" aria-labelledby="tokens-how-title">
						<div class="section-head"><h2 id="tokens-how-title">{t('tokens.how_title')}</h2></div>
						<Steps items={[t('tokens.how_step1'), t('tokens.how_step2'), t('tokens.how_step3')]} />
					</section>
				</aside>
			</div>
		{/if}
	</div>
{/if}

{#if editing}
	<TokenDialog token={editing.token} onclose={() => (editing = null)} onsaved={saved} />
{/if}

{#if bulk}
	<BulkDialog
		onclose={() => (bulk = false)}
		onsaved={(list) => {
			bulk = false;
			if (list.length) created = list;
			void load();
		}}
	/>
{/if}

{#if created}
	<CreatedDialog tokens={created} onclose={() => (created = null)} />
{/if}

<style>
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}
	.count-line strong {
		color: var(--text);
	}
	/* The token's start and its note, side by side */
	.token-sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
	}
	.token-name {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.tokens-page :global(.tokens-mode-notice),
	.mode-next {
		max-width: var(--measure);
	}
	.mode-next {
		margin: 0;
	}
	/* Names get room before dates and IDs, and a date never breaks inside */
	.tokens-table :global(td.col-name) {
		min-width: 18ch;
	}
	.tokens-table :global(.time),
	.tokens-table :global(.value-copy) {
		white-space: nowrap;
	}
</style>
