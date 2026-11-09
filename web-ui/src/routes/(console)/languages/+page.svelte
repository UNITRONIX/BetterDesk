<!--
  Translations (/languages, server.config): how complete each language
  file is, and every text of one language next to English (#<code> opens
  that language; Back and the browser's back return to the list). Read
  only: texts are changed in lang/<code>.json on the server. Old page:
  views/languages.ejs, public/js/languages.js.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { page } from '$app/state';
	import { getMissing, getTexts, listLanguages, type LanguageRow, type Missing } from '#lib/api/languages.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import {
		SHOW_LIMIT,
		buildRows,
		clampCoverage,
		codeFromHash,
		filterRows,
		languageName,
		languageStatus,
		missingAreas,
		showsReviewNote,
		type TextFilter,
		type TextRow
	} from '#lib/settings-b/languages.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import LangFlag from '#lib/ui/LangFlag.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';

	const allowed = can('server.config');

	// ── All languages ──
	let languages = $state.raw<LanguageRow[]>([]);
	let refKeyCount = $state(0);
	let listState = $state<'loading' | 'ready' | 'error'>('loading');

	async function loadLanguages() {
		listState = 'loading';
		try {
			const data = await listLanguages();
			languages = data.languages;
			refKeyCount = data.refKeyCount ?? 0;
			listState = 'ready';
		} catch {
			listState = 'error';
		}
	}

	const nameOf = (l: Pick<LanguageRow, 'code' | 'name'>) => languageName(l.code, l.name ?? '', i18n.lang);
	const reviewCount = $derived(languages.filter((l) => l.needs_review).length);

	// ── One language ──
	// The language in the address. Links the router follows (Show texts, All
	// languages) change page.url; a #code set here, Back and Forward fire
	// hashchange or popstate, which the router may not see.
	let hash = $derived(page.url.hash);
	$effect(() => {
		const sync = () => (hash = location.hash);
		sync();
		window.addEventListener('hashchange', sync);
		window.addEventListener('popstate', sync);
		return () => {
			window.removeEventListener('hashchange', sync);
			window.removeEventListener('popstate', sync);
		};
	});
	const code = $derived(codeFromHash(hash));
	interface Detail {
		code: string;
		rows: TextRow[];
		missingKnown: boolean;
	}
	let detail = $state.raw<Detail | null>(null);
	let detailState = $state<'loading' | 'ready' | 'error'>('loading');
	let query = $state('');
	let filter = $state<TextFilter>('all');
	let request = 0;
	let titleEl = $state<HTMLElement | null>(null);
	let lastOpened: string | null = null;

	const lang = $derived<LanguageRow>(
		languages.find((l) => l.code === code) ?? {
			code: code ?? '',
			name: code ?? '',
			native: '',
			rtl: false,
			needs_review: false,
			is_reference: false,
			total_keys: 0,
			missing_keys: 0,
			extra_keys: 0,
			empty_keys: 0,
			coverage: null,
			error: null
		}
	);

	async function openDetail(c: string) {
		const req = ++request;
		detailState = 'loading';
		try {
			const [en, own, missing] = await Promise.all([
				getTexts('en'),
				c === 'en' ? Promise.resolve(null) : getTexts(c),
				c === 'en' ? Promise.resolve<Missing>({ missing: [] }) : getMissing(c).catch(() => null)
			]);
			if (req !== request) return;
			detail = { code: c, rows: buildRows(en, own, missing), missingKnown: !!missing };
			detailState = 'ready';
		} catch {
			if (req !== request) return;
			detail = null;
			detailState = 'error';
		}
	}

	// The address decides what is shown; a different language starts with all its texts
	$effect(() => {
		if (!allowed) return;
		const c = code;
		if (!c) {
			if (lastOpened) {
				const back = lastOpened;
				lastOpened = null;
				void tick().then(() =>
					document.querySelector<HTMLElement>(`[data-key="${CSS.escape(back)}"] .row-open`)?.focus()
				);
			}
			return;
		}
		if (c !== lastOpened) {
			query = '';
			filter = 'all';
			lastOpened = c;
			void openDetail(c);
			void tick().then(() => titleEl?.focus());
		}
	});

	$effect(() => {
		if (!allowed) return;
		void loadLanguages();
		return onRefresh(() => {
			void loadLanguages();
			if (code) void openDetail(code);
		});
	});

	function show(c: string) {
		location.hash = encodeURIComponent(c);
	}

	function showArea(area: string) {
		query = `${area}.`;
		filter = 'missing';
	}

	const matching = $derived(detail ? filterRows(detail.rows, filter, query) : []);
	const shown = $derived(matching.slice(0, SHOW_LIMIT));
	const areas = $derived(detail ? missingAreas(detail.rows) : []);
	const isEn = $derived(code === 'en');
	const total = $derived(refKeyCount || lang.total_keys || 0);

	const summary = $derived<Fact[]>([
		{ label: t('languages.col_status'), value: statusCell },
		...(!lang.is_reference && lang.coverage !== null
			? [
					{ label: t('languages.col_coverage'), value: coverageFact },
					{ label: t('languages.col_missing'), value: missingFact },
					...(lang.empty_keys
						? [{ label: t('languages.summary_empty'), value: formatNumber(lang.empty_keys) }]
						: [])
				]
			: []),
		{ label: t('languages.summary_direction'), value: lang.rtl ? t('languages.rtl') : t('languages.ltr') },
		{ label: t('languages.summary_file'), value: fileFact }
	]);

	const listColumns: Column<LanguageRow>[] = [
		{ id: 'language', label: t('languages.col_language'), cell: languageCell, primary: true },
		{ id: 'native', label: t('languages.col_native'), cell: nativeCell, class: 'col-native' },
		{ id: 'coverage', label: t('languages.col_coverage'), cell: coverageCell, class: 'col-coverage' },
		{ id: 'status', label: t('languages.col_status'), cell: statusRowCell },
		{
			id: 'missing',
			label: t('languages.col_missing'),
			cell: missingCell,
			align: 'num',
			class: 'col-missing'
		},
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	];

	const textColumns = $derived<Column<TextRow>[]>([
		{ id: 'key', label: t('languages.col_key'), cell: keyCell, class: 'col-key' },
		{ id: 'en', label: t('languages.col_english'), cell: enCell },
		...(isEn ? [] : [{ id: 'own', label: nameOf(lang), cell: ownCell }])
	]);
</script>

{#snippet languageCell(l: LanguageRow)}
	<span class="lang-cell">
		<span class="flag"><LangFlag code={l.code} /></span>
		<span><span class="lang-name">{nameOf(l)}</span><span class="cell-sub">{l.code}</span></span>
	</span>
{/snippet}
{#snippet nativeCell(l: LanguageRow)}
	<span lang={l.code} dir={l.rtl ? 'rtl' : 'ltr'}>{l.native}</span>
	{#if l.rtl}<span class="cell-sub">{t('languages.rtl')}</span>{/if}
{/snippet}
{#snippet coverageCell(l: LanguageRow)}
	{@const cov = clampCoverage(l.coverage)}
	<Meter value={cov} high={cov < 100 ? 0 : 101} full={101} text={`${cov} %`} />
{/snippet}
{#snippet statusRowCell(l: LanguageRow)}
	{@const st = languageStatus(l)}
	<Status tone={st.tone} label={t(st.key)} />
	{#if showsReviewNote(l)}<span class="cell-sub">{t('languages.status_review')}</span>{/if}
{/snippet}
{#snippet missingCell(l: LanguageRow)}
	{#if l.is_reference}<Empty />{:else}{formatNumber(l.missing_keys)}{/if}
	{#if (l.extra_keys ?? 0) > 0}<span class="cell-sub"
			>{t('languages.extra_count', { n: formatNumber(l.extra_keys) })}</span
		>{/if}
{/snippet}
{#snippet actionsCell(l: LanguageRow)}
	<Button size="sm" href={`#${encodeURIComponent(l.code)}`}
		><!-- Button drops aria-label on links: the full name is in the text, the short one is what shows -->
		<span aria-hidden="true">{t('languages.show_texts')}</span><span class="sr-only"
			>{t('languages.show_texts_for', { language: nameOf(l) })}</span
		></Button
	>
{/snippet}

{#snippet keyCell(r: TextRow)}<code>{r.key}</code>{/snippet}
{#snippet enCell(r: TextRow)}<span lang="en" dir="ltr">{r.en}</span>{/snippet}
{#snippet ownCell(r: TextRow)}
	{#if r.missing}
		<Status tone="warning" label={t('languages.missing_text')} />
	{:else}
		<span lang={code} dir={lang.rtl ? 'rtl' : 'ltr'}>{r.value}</span>
	{/if}
{/snippet}

{#snippet statusCell()}
	{@const st = languageStatus(lang)}
	<Status tone={st.tone} label={t(st.key)} />
{/snippet}
{#snippet coverageFact()}
	{@const cov = clampCoverage(lang.coverage)}
	<span class="side-value">
		<Meter value={cov} high={cov < 100 ? 0 : 101} full={101} text={`${cov} %`} />
		<span class="cell-sub"
			>{t('languages.summary_translated', {
				done: formatNumber(Math.max(0, total - (lang.missing_keys ?? 0))),
				total: formatNumber(total)
			})}</span
		>
	</span>
{/snippet}
{#snippet missingFact()}
	<span class="side-value">
		<span>{formatNumber(lang.missing_keys)}</span>
		{#if (lang.extra_keys ?? 0) > 0}<span class="cell-sub"
				>{t('languages.extra_count', { n: formatNumber(lang.extra_keys) })}</span
			>{/if}
	</span>
{/snippet}
{#snippet fileFact()}<ValueCopy value={`lang/${lang.code}.json`} copy={false} />{/snippet}

<div class="page page-wide languages-page">
	<div class="page-head">
		<h1>{t('nav.languages')}</h1>
		<p class="page-description">{t('languages.page_description')}</p>
	</div>

	{#if !allowed}
		<section class="section" aria-labelledby="forbidden-title">
			<h2 id="forbidden-title">{t('errors.forbidden_title')}</h2>
			<p class="section-note">{t('errors.forbidden_message')}</p>
		</section>
	{:else if !code}
		<section class="section" id="lang-grid" aria-label={t('nav.languages')}>
			{#if listState === 'ready' && languages.length}
				<CountLine
					text={t('languages.count_line')}
					values={{ total: languages.length, review: reviewCount, keys: refKeyCount }}
				/>
			{/if}
			<Table
				rows={languages}
				columns={listColumns}
				key={(l) => l.code}
				label={t('nav.languages')}
				loading={listState === 'loading'}
				loadingText={t('languages.loading')}
				error={listState === 'error' ? t('languages.load_error') : null}
				onretry={() => void loadLanguages()}
				emptyText={t('languages.no_languages')}
				onrowclick={(l) => show(l.code)}
				class="languages-table"
			/>
		</section>
	{:else}
		<section class="section lang-detail" aria-labelledby="lang-detail-title">
			<p><a class="back" href={page.url.pathname + page.url.search}>{t('languages.back')}</a></p>
			<h2 id="lang-detail-title" tabindex="-1" bind:this={titleEl}>{nameOf(lang)} ({code})</h2>
			<p class="section-note">
				{t('languages.detail_note', { language: nameOf(lang), file: `lang/${code}.json` })}
			</p>

			<div class="page-cols">
				<div class="page-main">
					<Toolbar>
						{#snippet search()}
							<SearchField
								label={t('languages.search_texts')}
								placeholder={t('languages.search_texts')}
								bind:value={query}
							/>
						{/snippet}
						<SegmentedFilter
							label={t('languages.col_status')}
							options={[
								{ value: 'all' as const, label: t('languages.filter_all') },
								{ value: 'missing' as const, label: t('languages.filter_missing') }
							]}
							bind:value={filter}
						/>
					</Toolbar>
					{#if detailState === 'loading'}
						<States kind="loading" message={t('languages.detail_loading')} />
					{:else if detailState === 'error'}
						<States
							kind="error"
							message={t('languages.detail_error')}
							retryLabel={t('languages.try_again')}
							onretry={() => code && void openDetail(code)}
						/>
					{:else if detail}
						<p class="count-line" role="status">
							<CountLine
								text={!query.trim() && filter === 'all'
									? t('languages.detail_total')
									: t('languages.detail_matches')}
								values={{ n: matching.length }}
							/>
							{#if matching.length > SHOW_LIMIT}{t('languages.detail_limit', {
									n: formatNumber(SHOW_LIMIT)
								})}{/if}
							{#if !detail.missingKnown}{t('languages.missing_unknown')}{/if}
						</p>
						{#if !matching.length}
							<States
								message={filter === 'missing' && !query.trim()
									? t('languages.none_missing')
									: t('languages.no_match')}
							/>
						{:else}
							<Table
								rows={shown}
								columns={textColumns}
								key={(r) => r.key}
								label={t('languages.col_key')}
								class={isEn ? 'texts-table is-single' : 'texts-table'}
							/>
						{/if}
					{/if}
				</div>

				<aside class="page-side is-sticky" aria-labelledby="lang-summary-title">
					<section class="section" aria-labelledby="lang-summary-title">
						<h3 id="lang-summary-title">{t('languages.summary_title')}</h3>
						<Facts items={summary} />
					</section>
					{#if !lang.is_reference && !isEn}
						<section class="section" aria-labelledby="lang-areas-title">
							<h3 id="lang-areas-title">{t('languages.areas_title')}</h3>
							<p class="section-note">{t('languages.areas_note')}</p>
							{#if detailState === 'loading'}
								<States kind="loading" message={t('languages.detail_loading')} />
							{:else if detail && !detail.missingKnown}
								<States message={t('languages.missing_unknown')} />
							{:else if detail && !areas.length}
								<States message={t('languages.none_missing')} />
							{:else if detail}
								<RowList>
									{#each areas as a (a.area)}
										<ListRow title={a.area} sub={t('languages.area_count', { n: formatNumber(a.count) })}>
											{#snippet end()}
												<Button
													size="sm"
													aria-label={t('languages.area_show', { area: a.area })}
													onclick={() => showArea(a.area)}>{t('languages.show_texts')}</Button
												>
											{/snippet}
										</ListRow>
									{/each}
								</RowList>
							{/if}
						</section>
					{/if}
				</aside>
			</div>
		</section>
	{/if}
</div>

<style>
	.lang-cell {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.flag {
		display: inline-flex;
		flex: none;
		width: 20px;
	}
	.lang-name {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.side-value {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h-sm);
	}
	.lang-detail > h2:focus {
		outline: none;
	}
	.count-line {
		color: var(--text-muted);
	}
	.languages-page :global(.languages-table .col-coverage) {
		width: 220px;
		min-width: 160px;
	}
	.languages-page :global(.texts-table td) {
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	.languages-page :global(.texts-table .col-key) {
		width: 28%;
		min-width: 180px;
	}
	.languages-page :global(.texts-table .col-key code) {
		color: var(--text-muted);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	/* Side column of one language: label above value */
	.languages-page :global(.page-side .facts) {
		grid-template-columns: minmax(0, 1fr);
	}
	.languages-page :global(.page-side .facts > dt) {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
		font-size: var(--text-sm);
	}
	.languages-page :global(.page-side .facts > dd) {
		min-height: 0;
		padding-top: var(--space-1);
	}
	@media (pointer: coarse) {
		.back {
			min-height: 44px;
		}
		/* The language name opens the row: a 44 px target on touch (the whole row opens too) */
		.languages-page :global(.languages-table .row-open) {
			min-height: 44px;
		}
	}
	/* Phones: language, how much is translated, status; the row opens the texts */
	@media (max-width: 640px) {
		.languages-page :global(.languages-table :is(.col-native, .col-missing, .actions, .meter-bar)) {
			display: none;
		}
		.languages-page :global(.languages-table .col-coverage) {
			width: auto;
			min-width: 0;
		}
		/* The key on its own line above the two texts */
		.languages-page :global(.texts-table tr) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			border-bottom: 1px solid var(--rule);
		}
		.languages-page :global(.texts-table :is(th, td)) {
			height: auto;
			border-bottom: 0;
		}
		.languages-page :global(.texts-table .col-key) {
			grid-column: 1 / -1;
			width: auto;
			min-width: 0;
			padding-bottom: 0;
		}
		.languages-page :global(.texts-table thead .col-key) {
			display: none;
		}
		.languages-page :global(.texts-table.is-single tr) {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
