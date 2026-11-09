<!--
  One device's app usage for the dates chosen on the page: time per app and
  the latest app sessions. Two tables, so a wide sheet. The sessions (up to
  100) scroll in their own box, which can be focused to scroll with the
  keyboard (the sheet body has nothing else to focus).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		appSeconds,
		deviceSessions,
		topApps,
		type AppSession,
		type Range,
		type TopApp
	} from '#lib/api/activity.ts';
	import { formatDuration, formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import type { Column } from '#lib/ui/table.ts';

	interface Props {
		deviceId: string;
		name: string;
		range: Range;
		categoryLabel: (c: string) => string;
		onclose: () => void;
	}

	let { deviceId, name, range, categoryLabel, onclose }: Props = $props();

	const uid = $props.id();

	let apps = $state.raw<TopApp[] | null>(null);
	type Row = AppSession & { key: number };
	let sessions = $state.raw<Row[] | null>(null);
	let failed = $state(false);

	$effect(() => {
		untrack(async () => {
			try {
				const [a, s] = await Promise.all([topApps(deviceId, range), deviceSessions(deviceId, range)]);
				apps = a;
				sessions = s.map((x, i) => ({ ...x, key: i }));
			} catch {
				failed = true;
			}
		});
	});

	const duration = (s: number) => formatDuration(s, { largest: 'hour' });

	const appColumns = $derived<Column<TopApp>[]>([
		{ id: 'app', label: t('activity.app_name'), cell: appName },
		{ id: 'category', label: t('activity.category'), cell: appCategory },
		{ id: 'time', label: t('activity.total_time'), cell: appTime, align: 'num' },
		{ id: 'sessions', label: t('activity.sessions'), cell: appSessions, align: 'num' }
	]);
	const sessionColumns = $derived<Column<Row>[]>([
		{ id: 'started', label: t('activity.started_at'), cell: started, class: 'col-nowrap' },
		{ id: 'app', label: t('activity.app_name'), cell: sessionApp },
		{ id: 'window', label: t('activity.window_title'), cell: windowTitle, class: 'col-window' },
		{ id: 'duration', label: t('activity.duration'), cell: sessionDuration, align: 'num' }
	]);
</script>

{#snippet appName(a: TopApp)}{#if a.app_name || a.name}{a.app_name || a.name}{:else}<Empty />{/if}{/snippet}
{#snippet appCategory(a: TopApp)}{#if a.category}<Tag label={categoryLabel(a.category)} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet appTime(a: TopApp)}{#if appSeconds(a) > 0}{duration(appSeconds(a))}{:else}<Empty />{/if}{/snippet}
{#snippet appSessions(a: TopApp)}{formatNumber(a.session_count)}{/snippet}
{#snippet started(s: Row)}<Time value={s.started_at || s.session_start} relative={false} />{/snippet}
{#snippet sessionApp(s: Row)}{#if s.app_name}{s.app_name}{:else}<Empty />{/if}{#if s.category}<span
			class="cell-sub"><Tag label={categoryLabel(s.category)} /></span
		>{/if}{/snippet}
{#snippet windowTitle(s: Row)}{#if s.window_title}{s.window_title}{:else}<Empty />{/if}{/snippet}
{#snippet sessionDuration(s: Row)}{@const secs =
		Number(s.duration_secs ?? s.duration_seconds) || 0}{#if secs > 0}{duration(secs)}{:else}<Empty
		/>{/if}{/snippet}

<Sheet wide title={t('activity.detail_title', { name })} subtitle={t('activity.detail_desc')} {onclose}>
	<div class="detail">
		{#if failed}
			<States kind="error" message={t('activity.detail_failed')} />
		{:else}
			<section class="section" aria-labelledby="{uid}-apps">
				<h3 id="{uid}-apps">{t('activity.top_apps')}</h3>
				{#if !apps}
					<States kind="loading" />
				{:else if !apps.length}
					<States message={t('activity.no_apps')} />
				{:else}
					<Table
						rows={apps}
						columns={appColumns}
						key={(a) => `${a.app_name || a.name}|${a.category}`}
						label={t('activity.top_apps')}
					/>
				{/if}
			</section>
			<section class="section" aria-labelledby="{uid}-sessions">
				<h3 id="{uid}-sessions">{t('activity.recent_sessions')}</h3>
				{#if !sessions}
					<States kind="loading" />
				{:else if !sessions.length}
					<States message={t('activity.no_sessions')} />
				{:else}
					<p class="note">{t('activity.recent_sessions_note', { count: sessions.length })}</p>
					<div class="sessions">
						<Table
							rows={sessions}
							columns={sessionColumns}
							key={(s) => String(s.key)}
							label={t('activity.recent_sessions')}
							height="min(28rem, 55vh)"
						/>
					</div>
				{/if}
			</section>
		{/if}
	</div>
	{#snippet footer()}
		<Button onclick={onclose}>{t('common.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.note {
		margin: 0;
		color: var(--text-muted);
	}
	.detail :global(.cell-sub) {
		display: block;
	}
	.sessions :global(td.col-nowrap) {
		white-space: nowrap;
	}
	.sessions :global(td.col-window) {
		overflow-wrap: anywhere;
		color: var(--text-muted);
	}
</style>
