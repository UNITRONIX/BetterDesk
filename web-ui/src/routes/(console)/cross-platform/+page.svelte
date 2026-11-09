<!--
  Platform support (/cross-platform, device.view): four tabs, the open one
  kept in ?tab= (matrix, distribution, protocols, limitations).
  - Features: which feature works on which system (fixed data).
  - Your devices: systems, client versions and processor architectures of
    the registered devices (GET /api/panel/cross-platform/distribution).
  - Protocols: how a session is set up, and the codecs and features the
    online devices reported (GET /api/panel/cross-platform/protocols).
  - Limitations: known limits per system (fixed data).
  Each data tab loads when it opens (once per visit) and on Refresh.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import {
		getDistribution,
		getProtocols,
		type Distribution,
		type Protocols
	} from '#lib/api/crossPlatform.ts';
	import {
		countRows,
		LIMITATIONS,
		MATRIX,
		mergeFamilies,
		noArchitecture,
		PLATFORMS,
		READINESS_TONE,
		tabFrom,
		TABS,
		VERSION_ROWS,
		type CountRow,
		type CpTab,
		type Support
	} from '#lib/devices-area/crossPlatform.ts';
	import { has, t } from '#lib/i18n/i18n.svelte.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';

	const allowed = can('device.view');

	/* ── Tabs, kept in ?tab= ── */

	let tab = $state<CpTab>(untrack(() => tabFrom(page.url.searchParams.get('tab'))));

	function selectTab(id: string) {
		tab = tabFrom(id);
		const url = new URL(location.href);
		url.searchParams.set('tab', tab);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own URL with ?tab=
		replaceState(url, page.state);
	}

	const tabs = $derived(TABS.map((id) => ({ id, label: t(`cross_platform.tab_${id}`) })));

	/* ── Data, per tab ── */

	let distribution = $state.raw<Distribution | null>(null);
	let distributionError = $state<string | null>(null);
	let protocols = $state.raw<Protocols | null>(null);
	let protocolsError = $state<string | null>(null);

	const reason = (err: unknown) => (err instanceof Error && err.message ? err.message : '');

	async function loadDistribution() {
		distributionError = null;
		try {
			distribution = await getDistribution();
		} catch (err) {
			distribution = null;
			distributionError = reason(err);
		}
	}

	async function loadProtocols() {
		protocolsError = null;
		try {
			protocols = await getProtocols();
		} catch (err) {
			protocols = null;
			protocolsError = reason(err);
		}
	}

	function load(which: CpTab, again = false) {
		if (!allowed) return;
		if (which === 'distribution' && (again || (!distribution && distributionError === null)))
			void loadDistribution();
		if (which === 'protocols' && (again || (!protocols && protocolsError === null))) void loadProtocols();
	}

	$effect(() => {
		const current = tab;
		untrack(() => load(current));
	});
	$effect(() => onRefresh(() => load(tab, true)));

	/* ── Counts ── */

	/** A platform key from the server ("windows", "linux_arm") as its name; anything else as sent */
	function platformName(key: string): string {
		if (!/^[a-z_]+$/.test(key)) return key;
		const k = `cross_platform.platform_${key}`;
		return has(k) ? t(k) : key;
	}

	const platforms = $derived(
		distribution ? countRows(mergeFamilies(distribution.platforms), distribution.total) : []
	);
	const versions = $derived(distribution ? countRows(distribution.versions, distribution.total) : []);
	const archs = $derived(distribution ? countRows(distribution.archs, distribution.total) : []);
	const codecs = $derived(protocols ? countRows(protocols.codecs, protocols.totalOnline) : []);
	const features = $derived(protocols ? countRows(protocols.features, protocols.totalOnline) : []);

	const archName = (r: CountRow) => (r.name === 'unknown' || !r.name ? t('cross_platform.unknown') : r.name);

	/** The protocol buffers message the clients send (for developers; not translated) */
	const SCHEMA = `message ClientCapabilities {
    bool   can_capture_screen  = 1;
    bool   can_inject_input    = 2;
    bool   can_transfer_files  = 3;
    bool   can_capture_audio   = 4;
    bool   supports_clipboard  = 5;
    repeated string supported_codecs   = 6;
    string platform            = 7;
    string arch                = 8;
    string client_version      = 9;
    repeated string supported_features = 10;
}`;

	const SUPPORT: readonly Support[] = ['full', 'partial', 'none', 'planned'];
</script>

{#snippet countCell(r: CountRow)}{r.count}{/snippet}

{#snippet shareCell(r: CountRow)}<Meter value={r.share} />{/snippet}

{#snippet countTable(rows: CountRow[], label: string, name: (r: CountRow) => string, caption: string)}
	<Table
		{rows}
		columns={[
			{ id: 'name', label, cell: rowName, primary: true, sortValue: (r: CountRow) => name(r) },
			{
				id: 'count',
				label: t('cross_platform.col_devices'),
				cell: countCell,
				align: 'num',
				sortValue: (r: CountRow) => r.count
			},
			{
				id: 'share',
				label: t('cross_platform.col_share'),
				cell: shareCell,
				class: 'col-share',
				sortValue: (r: CountRow) => r.share
			}
		]}
		key={(r) => r.name}
		label={caption}
	/>
	{#snippet rowName(r: CountRow)}{name(r)}{/snippet}
{/snippet}

<div class="page page-wide cp-page">
	<div class="page-head">
		<h1>{t('nav.cross_platform')}</h1>
		<p class="page-description">{t('cross_platform.page_description')}</p>
	</div>

	{#if !allowed}
		<Notice tone="warning" message={t('errors.no_permission')} />
	{:else}
		<Tabs {tabs} value={tab} label={t('nav.cross_platform')} onchange={selectTab}>
			{#snippet children(open)}
				{#if open === 'matrix'}
					<!-- Which feature works on which system -->
					<section class="section panel" aria-label={t('cross_platform.tab_matrix')}>
						<p class="section-note note">{t('cross_platform.matrix_hint')}</p>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
						<div class="matrix" tabindex="0" role="region" aria-label={t('cross_platform.matrix_caption')}>
							<table class="matrix-table">
								<caption class="sr-only">{t('cross_platform.matrix_caption')}</caption>
								<thead>
									<tr>
										<th scope="col">{t('cross_platform.col_feature')}</th>
										{#each PLATFORMS as p (p)}<th scope="col">{t(`cross_platform.platform_${p}`)}</th>{/each}
									</tr>
								</thead>
								<tbody>
									{#each MATRIX as row (row.feature)}
										<tr>
											<th scope="row">{t(`cross_platform.${row.feature}`)}</th>
											<!-- Support in words; the class only adds colour on top of the word -->
											{#each row.values as value, i (i)}<td class="is-{value}"
													>{t(`cross_platform.value_${value}`)}</td
												>{/each}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
						<dl class="legend">
							{#each SUPPORT as s (s)}
								<div>
									<dt>{t(`cross_platform.value_${s}`)}</dt>
									<dd>{t(`cross_platform.legend_${s}_desc`)}</dd>
								</div>
							{/each}
						</dl>
					</section>
				{:else if open === 'distribution'}
					<!-- What the registered devices run -->
					<div class="panel">
						<div aria-live="polite">
							{#if distributionError !== null}
								<States
									kind="error"
									message={t('cross_platform.distribution_failed', { error: distributionError })}
									retryLabel={t('cross_platform.try_again')}
									onretry={() => void loadDistribution()}
								/>
							{:else if !distribution}
								<States kind="loading" message={t('cross_platform.loading')} />
							{:else if distribution.total}
								<CountLine
									text={t('cross_platform.distribution_summary')}
									values={{
										count: distribution.total,
										platforms: platforms.length,
										versions: versions.length
									}}
								/>
							{:else}
								<p class="count-line">{t('cross_platform.no_devices')}</p>
							{/if}
						</div>
						{#if distribution}
							<div class="cols cp-cols">
								<section class="section" aria-labelledby="platform-dist-title">
									<h2 id="platform-dist-title">{t('cross_platform.platform_breakdown')}</h2>
									{#if platforms.length}
										{@render countTable(
											platforms,
											t('cross_platform.col_system'),
											(r) => platformName(r.name),
											t('cross_platform.platform_breakdown')
										)}
									{:else}
										<States message={t('cross_platform.no_devices')} />
									{/if}
								</section>
								<section class="section" aria-labelledby="version-dist-title">
									<h2 id="version-dist-title">{t('cross_platform.version_breakdown')}</h2>
									<p class="section-note">{t('cross_platform.version_note')}</p>
									{#if versions.length}
										{@render countTable(
											versions.slice(0, VERSION_ROWS),
											t('cross_platform.col_version'),
											(r) => r.name,
											t('cross_platform.version_breakdown')
										)}
										{#if versions.length > VERSION_ROWS}
											<CountLine
												text={t('cross_platform.more_versions')}
												values={{ count: versions.length - VERSION_ROWS }}
											/>
										{/if}
									{:else}
										<States message={t('cross_platform.no_devices')} />
									{/if}
								</section>
								<section class="section" aria-labelledby="arch-dist-title">
									<h2 id="arch-dist-title">{t('cross_platform.arch_breakdown')}</h2>
									{#if noArchitecture(archs)}
										<!-- One sentence instead of a table with one "Not reported" row -->
										<States message={t('cross_platform.arch_none')} />
									{:else if archs.length}
										{@render countTable(
											archs,
											t('cross_platform.col_arch'),
											archName,
											t('cross_platform.arch_breakdown')
										)}
									{:else}
										<States message={t('cross_platform.no_devices')} />
									{/if}
								</section>
							</div>
						{/if}
					</div>
				{:else if open === 'protocols'}
					<!-- How clients tell the server what they can do -->
					<div class="panel">
						<section class="section" aria-labelledby="proto-title">
							<h2 id="proto-title">{t('cross_platform.capability_negotiation')}</h2>
							<p class="section-note">{t('cross_platform.protocols_hint')}</p>
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div class="diagram" tabindex="0" role="region" aria-labelledby="proto-title">
								<svg viewBox="0 0 660 120" role="img" aria-label={t('cross_platform.diagram_label')}>
									<defs>
										<marker id="cp-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
											<path d="M0,0 L8,3 L0,6" class="dg-arrow" />
										</marker>
									</defs>
									{#each [{ x: 10, w: 150, title: 'diagram_client', sub: 'diagram_client_sub', strong: false }, { x: 250, w: 160, title: 'diagram_server', sub: 'diagram_server_sub', strong: true }, { x: 500, w: 150, title: 'diagram_peer', sub: 'diagram_peer_sub', strong: false }] as b (b.title)}
										<rect
											x={b.x}
											y="40"
											width={b.w}
											height="60"
											rx="3"
											class={['dg-box', b.strong && 'is-strong']}
										/>
										<text x={b.x + b.w / 2} y="66" text-anchor="middle" class="dg-title"
											>{t(`cross_platform.${b.title}`)}</text
										>
										<text x={b.x + b.w / 2} y="86" text-anchor="middle" class="dg-sub"
											>{t(`cross_platform.${b.sub}`)}</text
										>
									{/each}
									{#each [{ x1: 160, x2: 250, msg: 'diagram_msg_caps' }, { x1: 410, x2: 500, msg: 'diagram_msg_session' }] as a (a.msg)}
										<line
											x1={a.x1}
											y1="70"
											x2={a.x2 - 2}
											y2="70"
											class="dg-line"
											marker-end="url(#cp-arrow)"
										/>
										<text x={(a.x1 + a.x2) / 2} y="30" text-anchor="middle" class="dg-msg"
											>{t(`cross_platform.${a.msg}`)}</text
										>
									{/each}
								</svg>
							</div>
						</section>
						{#if protocolsError !== null}
							<States
								kind="error"
								message={t('cross_platform.protocols_failed', { error: protocolsError })}
								retryLabel={t('cross_platform.try_again')}
								onretry={() => void loadProtocols()}
							/>
						{:else if !protocols}
							<States kind="loading" message={t('cross_platform.loading')} />
						{:else}
							<div class="cols cp-cols">
								<section class="section" aria-labelledby="codec-title">
									<h2 id="codec-title">{t('cross_platform.codec_support')}</h2>
									{#if codecs.length}
										<CountLine
											text={t('cross_platform.online_count')}
											values={{ count: protocols.totalOnline }}
										/>
										{@render countTable(
											codecs,
											t('cross_platform.col_codec'),
											(r) => r.name.toUpperCase(),
											t('cross_platform.codec_support')
										)}
									{:else}
										<States message={t('cross_platform.no_codec_data')} />
									{/if}
								</section>
								<section class="section" aria-labelledby="feature-title">
									<h2 id="feature-title">{t('cross_platform.feature_support')}</h2>
									{#if features.length}
										<CountLine
											text={t('cross_platform.online_count')}
											values={{ count: protocols.totalOnline }}
										/>
										{@render countTable(
											features,
											t('cross_platform.col_feature'),
											(r) => r.name,
											t('cross_platform.feature_support')
										)}
									{:else}
										<States message={t('cross_platform.no_feature_data')} />
									{/if}
								</section>
							</div>
						{/if}
						<!-- For people who write clients or integrations: folded -->
						<Disclosure title={t('cross_platform.protobuf_schema')}>
							<p class="section-note">{t('cross_platform.schema_note')}</p>
							<CodeBlock code={SCHEMA} />
						</Disclosure>
					</div>
				{:else}
					<!-- Known limits per system -->
					<section class="section panel" aria-label={t('cross_platform.tab_limitations')}>
						<p class="section-note note">{t('cross_platform.limitations_hint')}</p>
						<div class="limits">
							{#each LIMITATIONS as lim (lim.platform)}
								<section class="section limit" aria-labelledby="cp-limit-{lim.platform}">
									<div class="section-head">
										<h2 id="cp-limit-{lim.platform}">{t(`cross_platform.platform_${lim.platform}`)}</h2>
										<Status
											tone={READINESS_TONE[lim.status]}
											label={t(`cross_platform.status_${lim.status}`)}
										/>
									</div>
									<ul class="limit-list">
										{#each lim.items as item (item)}<li>{t(`cross_platform.${item}`)}</li>{/each}
									</ul>
								</section>
							{/each}
						</div>
					</section>
				{/if}
			{/snippet}
		</Tabs>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}
	section.panel {
		gap: var(--space-3);
	}
	.note {
		margin-top: 0;
	}

	/* Feature matrix: words in every cell, the feature column stays in view */
	.matrix {
		overflow-x: auto;
		margin: 0 calc(-1 * var(--row-pad-x));
		border-inline-end: 1px solid var(--rule);
	}
	.matrix-table {
		width: 100%;
		min-width: 760px;
		border-collapse: collapse;
	}
	.matrix-table th,
	.matrix-table td {
		padding: var(--space-1) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		text-align: start;
	}
	.matrix-table thead th {
		height: 40px;
		border-top: 1px solid var(--rule);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
	}
	.matrix-table td {
		height: var(--row-h);
		white-space: nowrap;
	}
	.matrix-table :is(thead th:first-child, tbody th) {
		position: sticky;
		inset-inline-start: 0;
		z-index: 1;
		border-inline-end: 1px solid var(--rule);
		background: var(--bg);
	}
	.matrix-table tbody th {
		min-width: 150px;
		height: var(--row-h);
		color: var(--text);
		font-weight: 400;
	}
	.matrix-table tbody tr:hover > :is(td, th) {
		background: var(--bg-subtle);
	}
	.matrix-table .is-partial {
		color: var(--warning);
		font-weight: 600;
	}
	.matrix-table :is(.is-none, .is-planned) {
		color: var(--text-muted);
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-5);
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.legend dt {
		display: inline;
		color: var(--text);
		font-weight: 600;
	}
	.legend dt::after {
		content: ': ';
	}
	.legend dd {
		display: inline;
		margin: 0;
	}

	/* Counts per system, version, codec: side by side on wide screens */
	.cp-cols {
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
	}
	.cp-cols :global(td.col-share) {
		min-width: 120px;
	}
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}

	/* How a session is set up */
	.diagram {
		max-width: 680px;
		overflow-x: auto;
	}
	.diagram svg {
		display: block;
		width: 100%;
		min-width: 520px;
		height: auto;
	}
	.dg-box {
		fill: none;
		stroke: var(--border);
		stroke-width: 1;
	}
	.dg-box.is-strong {
		stroke: var(--accent);
		stroke-width: 1.5;
	}
	.dg-title {
		fill: var(--text);
		font-family: var(--font);
		font-size: 13px;
		font-weight: 600;
	}
	.dg-sub {
		fill: var(--text-muted);
		font-family: var(--font);
		font-size: 12px;
	}
	.dg-msg {
		fill: var(--text-muted);
		font-size: 11px;
	}
	.dg-line {
		stroke: var(--accent);
		stroke-width: 1.5;
	}
	.dg-arrow {
		fill: var(--accent);
	}

	/* Limits per system */
	.limits {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
		gap: var(--space-6) var(--space-7);
		align-items: start;
	}
	.limit h2 {
		margin-inline-end: 0;
	}
	.limit .section-head {
		gap: var(--space-2) var(--space-4);
	}
	.limit-list {
		max-width: var(--measure);
		margin: 0;
		padding-inline-start: 1.25em;
	}
	.limit-list > li {
		padding: 2px 0;
	}
	.limit-list > li::marker {
		color: var(--text-muted);
	}
</style>
