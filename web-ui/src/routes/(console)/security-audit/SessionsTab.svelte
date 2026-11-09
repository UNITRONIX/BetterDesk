<!--
  Your sessions tab: the signed-in person's own sign-ins to this console
  (any role may see their own): state, address, start, last activity, end
  and why it ended, and the browser ("Chrome 156 on Windows" with the full
  string under it). The idle and maximum session length above the table.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listMySessions, type PanelSession } from '#lib/api/audit.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { describeUa, sessionState } from '#lib/people/audit.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';

	const uid = $props.id();

	let sessions = $state.raw<PanelSession[]>([]);
	let policy = $state('');
	let loaded = $state(false);
	let loadError = $state<string | null>(null);

	async function load() {
		loaded = false;
		loadError = null;
		try {
			const out = await listMySessions();
			sessions = out.sessions;
			policy =
				out.idleTimeoutMs || out.maxAgeMs
					? t('security_audit.sessions_policy')
							.replace('{{idle}}', formatNumber(Math.round(out.idleTimeoutMs / 60000)))
							.replace('{{max}}', formatNumber(Math.round(out.maxAgeMs / 3600000)))
					: '';
		} catch {
			loadError = t('security_audit.sessions_load_failed');
		} finally {
			loaded = true;
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	function uaName(ua: string): string {
		const { browser, os } = describeUa(ua);
		if (browser && os) return tf('security_audit.ua_on', `${browser}, ${os}`, { browser, os });
		return browser || os;
	}

	function reason(r: string): string {
		const key = `security_audit.reason_${r}`;
		return t(key) === key ? r : t(key);
	}

	const columns = $derived<Column<PanelSession>[]>([
		{ id: 'state', label: t('security_audit.col_status'), cell: stateCell, class: 'col-nowrap' },
		{ id: 'ip', label: t('security_audit.col_ip'), cell: ipCell },
		{ id: 'started', label: t('security_audit.col_started'), cell: startedCell, class: 'col-nowrap' },
		{ id: 'last', label: t('security_audit.col_last_activity'), cell: lastCell, class: 'col-nowrap' },
		{ id: 'ended', label: t('security_audit.col_ended'), cell: endedCell, class: 'col-nowrap' },
		{ id: 'reason', label: t('security_audit.col_reason'), cell: reasonCell },
		{ id: 'ua', label: t('security_audit.col_user_agent'), cell: uaCell, class: 'col-ua' }
	]);
</script>

{#snippet stateCell(s: PanelSession)}{@const st = sessionState(s)}<Status
		tone={st === 'ended' ? 'neutral' : 'good'}
		label={t(`security_audit.session_${st}`)}
	/>{/snippet}
{#snippet ipCell(s: PanelSession)}<ValueCopy value={s.ipAddress} />{/snippet}
{#snippet startedCell(s: PanelSession)}<Time
		value={s.createdAt}
		relative={false}
		format={{ second: '2-digit' }}
	/>{/snippet}
{#snippet lastCell(s: PanelSession)}<Time value={s.lastActivityAt} />{/snippet}
{#snippet endedCell(s: PanelSession)}<Time
		value={s.endedAt}
		relative={false}
		format={{ second: '2-digit' }}
	/>{/snippet}
{#snippet reasonCell(s: PanelSession)}{#if s.endReason}{reason(s.endReason)}{:else}<Empty />{/if}{/snippet}
{#snippet uaCell(s: PanelSession)}{#if !s.userAgent}<Empty />{:else}{@const name = uaName(
			s.userAgent
		)}{#if name}<span class="ua-name">{name}</span>{/if}<span class="ua-full" title={s.userAgent}
			>{s.userAgent}</span
		>{/if}{/snippet}

<section class="section" aria-labelledby="{uid}-title">
	<h2 id="{uid}-title" class="sr-only">{t('security_audit.tab_your_sessions')}</h2>
	<p class="section-note">{t('security_audit.sessions_hint')}</p>
	<Toolbar>
		{#if policy}<p class="policy">{policy}</p>{/if}
		{#snippet end()}<Button icon={ICONS.refresh} onclick={() => void load()}
				>{t('security_audit.refresh')}</Button
			>{/snippet}
	</Toolbar>
	<div class="sessions">
		<Table
			rows={sessions}
			{columns}
			key={(s) => s.id}
			label={t('security_audit.tab_your_sessions')}
			loading={!loaded}
			error={loadError}
			onretry={() => void load()}
			emptyText={t('security_audit.no_sessions')}
		/>
	</div>
</section>

<style>
	.policy {
		margin: 0;
		color: var(--text-muted);
	}
	.sessions :global(td.col-nowrap) {
		white-space: nowrap;
	}
	.sessions :global(td.col-ua) {
		max-width: 22rem;
	}
	.ua-name {
		display: block;
	}
	.ua-full {
		display: block;
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
