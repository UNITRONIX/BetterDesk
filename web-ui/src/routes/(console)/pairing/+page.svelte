<!--
  Pairing codes (/pairing): a short one-time code and the server address,
  for setting up a BetterDesk client without the long config string.
  Create a code (shown once, large enough to read out, with the time it
  still works), and revoke active codes in the list below.

  Needs enrollment.approve (the route and every call). The suggested
  server address comes from /api/panel/pairing/host.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { createCode, getSuggestedHost, listCodes, revokeCode, type PairingCode } from '#lib/api/pairing.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { codeExpired, endsAt, remaining } from '#lib/clients/pairing.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	const allowed = can('enrollment.approve');
	/** Clock time only: a code lives for minutes, so the date adds nothing */
	const CLOCK: Intl.DateTimeFormatOptions = { year: undefined, month: undefined, day: undefined };

	/* ── Active codes ── */

	let codes = $state.raw<PairingCode[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let refreshing = $state(false);

	async function load(): Promise<void> {
		if (!allowed) return;
		refreshing = true;
		try {
			codes = await listCodes();
			loadError = null;
		} catch (err) {
			loadError = `${t('pairing.load_failed')} ${err instanceof Error ? err.message : ''}`.trim();
		} finally {
			loaded = true;
			refreshing = false;
		}
	}

	/* ── New code ── */

	let label = $state('');
	let host = $state('');
	let creating = $state(false);
	let status = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' }>({
		message: '',
		tone: 'neutral'
	});
	let code = $state<{ value: string; host: string; endsAt: number } | null>(null);
	let now = $state(Date.now());
	let result = $state<HTMLElement | null>(null);

	async function loadHost() {
		if (!allowed) return;
		try {
			const suggested = await getSuggestedHost();
			if (!host) host = suggested;
		} catch {
			/* the field stays empty; the person types the address */
		}
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		if (creating) return;
		creating = true;
		status = { message: t('pairing.creating'), tone: 'neutral' };
		try {
			const out = await createCode(label.trim());
			code = { value: out.code, host: host.trim() || out.host, endsAt: endsAt(out.expires_in) };
			now = Date.now();
			status = { message: t('pairing.created'), tone: 'ok' };
			// On narrow screens the code sits under the form: bring it into view
			await tick();
			const box = result?.getBoundingClientRect();
			if (box && (box.top < 0 || box.bottom > window.innerHeight))
				result?.scrollIntoView({ block: 'center' });
			await load();
		} catch (err) {
			status = {
				message: `${t('pairing.create_failed')}: ${err instanceof Error ? err.message : ''}`,
				tone: 'error'
			};
		} finally {
			creating = false;
		}
	}

	// The time left, every 5 seconds while a code is shown and still works
	$effect(() => {
		if (!code) return;
		const timer = setInterval(() => {
			now = Date.now();
			if (code && now >= code.endsAt) clearInterval(timer);
		}, 5000);
		return () => clearInterval(timer);
	});

	const left = $derived(code ? remaining(Math.round((code.endsAt - now) / 1000)) : null);
	const leftText = $derived(
		!left
			? ''
			: left.kind === 'expired'
				? t('pairing.expired_hint')
				: left.kind === 'under_minute'
					? t('pairing.valid_under_minute')
					: t('pairing.valid_minutes', { count: left.count })
	);

	/* ── Revoke ── */

	let revoking = $state<string | null>(null);

	async function revoke(c: PairingCode) {
		revoking = c.id;
		try {
			await revokeCode(c.id);
			toast.success(t('pairing.revoked'));
			await load();
		} catch (err) {
			toast.error(`${t('pairing.revoke_failed')}: ${err instanceof Error ? err.message : ''}`);
		} finally {
			revoking = null;
		}
	}

	$effect(() =>
		untrack(() => {
			void loadHost();
			void load();
		})
	);
	$effect(() => onRefresh(() => void load()));

	const columns = $derived<Column<PairingCode>[]>([
		{ id: 'label', label: t('pairing.col_label'), cell: labelCell, class: 'col-label' },
		{ id: 'status', label: t('tokens.status'), cell: statusCell },
		{ id: 'created', label: t('pairing.col_created'), cell: createdCell },
		{ id: 'expires', label: t('pairing.col_expires'), cell: expiresCell },
		{ id: 'by', label: t('pairing.col_created_by'), cell: byCell },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet labelCell(c: PairingCode)}{#if c.label}{c.label}{:else}<Empty
			word={t('pairing.no_label')}
		/>{/if}{/snippet}
{#snippet statusCell(c: PairingCode)}{#if codeExpired(c.expires_at, now)}<Status
			tone="neutral"
			label={t('tokens.status_expired')}
		/>{:else}<Status tone="waiting" label={t('tokens.status_pending')} />{/if}{/snippet}
{#snippet createdCell(c: PairingCode)}<Time value={c.created_at} />{/snippet}
{#snippet expiresCell(c: PairingCode)}<Time value={c.expires_at} relative={false} format={CLOCK} />{/snippet}
{#snippet byCell(c: PairingCode)}<User user={c.created_by} />{/snippet}
{#snippet actionsCell(c: PairingCode)}<Button
		size="sm"
		variant="danger-quiet"
		icon={ICONS.revoke}
		class="act-revoke"
		busy={revoking === c.id}
		aria-label="{t('pairing.revoke')}: {c.label || c.created_at}"
		onclick={() => void revoke(c)}>{t('pairing.revoke')}</Button
	>{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page pairing-page">
		<div class="page-head">
			<h1>{t('nav.pairing')}</h1>
			<p class="page-description">{t('pairing.subtitle')}</p>
		</div>

		<!-- The form and the new code side by side, so the code appears next to
		     the button that made it (below it on narrow screens) -->
		<section class="section" aria-labelledby="pairing-create-title">
			<div class="section-head"><h2 id="pairing-create-title">{t('pairing.generate_title')}</h2></div>
			<p class="section-note">{t('pairing.generate_hint')}</p>
			<div class="cols pairing-create">
				<form class="pairing-form" onsubmit={create} novalidate>
					<Field label={t('pairing.label_field')} hint={t('pairing.label_hint')} width="medium">
						{#snippet children(f)}
							<Input
								{...f}
								maxlength={64}
								autocomplete="off"
								placeholder={t('pairing.label_placeholder')}
								bind:value={label}
							/>
						{/snippet}
					</Field>
					<Field label={t('pairing.host_field')} hint={t('pairing.host_hint')} width="host">
						{#snippet children(f)}
							<Input {...f} autocomplete="off" spellcheck="false" dir="ltr" bind:value={host} />
						{/snippet}
					</Field>
					<div class="form-actions">
						<Button type="submit" variant="primary" icon={ICONS.add} busy={creating} class="pairing-generate"
							>{t('pairing.generate_button')}</Button
						>
						<FormStatus message={status.message} tone={status.tone} />
					</div>
				</form>

				<div
					class="pairing-result-area"
					role="region"
					aria-labelledby="pairing-result-title"
					bind:this={result}
				>
					<h3 id="pairing-result-title">{t('pairing.title')}</h3>
					{#if code}
						<p class="code-hint">{t('pairing.code_hint')}</p>
						<span class={['pairing-code', left?.kind === 'expired' && 'is-expired']} aria-live="polite">
							<ValueField value={code.value} label={t('pairing.title')} />
						</span>
						<dl class="facts pairing-meta">
							<dt>{t('pairing.host_field')}</dt>
							<dd class="mono">{code.host}</dd>
							<dt>{t('pairing.expires_in')}</dt>
							<dd>{leftText}</dd>
						</dl>
					{:else}
						<p class="state-text">{t('pairing.code_empty')}</p>
					{/if}
				</div>
			</div>
		</section>

		<section class="section" aria-labelledby="pairing-active-title">
			<div class="section-head">
				<h2 id="pairing-active-title">{t('pairing.active_title')}</h2>
				<Button
					size="sm"
					icon={ICONS.refresh}
					busy={refreshing && loaded}
					class="pairing-refresh"
					onclick={() => void load()}>{t('actions.refresh')}</Button
				>
			</div>
			<p class="section-note">{t('pairing.active_hint')}</p>
			<Table
				rows={codes}
				{columns}
				key={(c) => c.id}
				label={t('pairing.active_title')}
				loading={!loaded}
				loadingText={t('pairing.loading')}
				error={loadError}
				onretry={() => void load()}
				emptyText={t('pairing.empty')}
			/>
		</section>
	</div>
{/if}

<style>
	.pairing-form {
		min-width: 0;
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.pairing-result-area {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.pairing-result-area > h3,
	.code-hint,
	.state-text {
		margin: 0;
	}
	.state-text {
		color: var(--text-muted);
	}
	/* The code is read out loud or typed from the screen: make it big */
	.pairing-code {
		align-self: flex-start;
		max-width: 100%;
	}
	.pairing-code :global(.value) {
		padding: var(--space-3) var(--space-4);
		font-size: 2.5rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		line-height: 1.1;
	}
	.pairing-code.is-expired :global(.value) {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	/* Label above value, so the facts line up under the code */
	.pairing-meta {
		grid-template-columns: minmax(0, 1fr);
	}
	.pairing-meta > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
	}
	.pairing-meta > dd {
		padding-top: var(--space-1);
	}
</style>
