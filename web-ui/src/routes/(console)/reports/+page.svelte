<!--
  Reports (/reports, audit.view): pick a period, generate one of seven
  reports, read it as tables, download it (JSON, or the main table as CSV)
  and save a copy. Saved copies in the side column open again; super_admin,
  admin and global_admin save and delete them (the server's role check).
  Trends of the last 14 days under the report.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		deleteSavedReport,
		generateReport,
		getSavedReport,
		listSavedReports,
		reportCsv,
		saveReport,
		type SavedReport
	} from '#lib/api/reports.ts';
	import { formatDate } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		canManageReports,
		csvSection,
		periodText,
		REPORT_TYPES,
		reportBlocks,
		reportFilters,
		savedByParts,
		typeLabel
	} from '#lib/people/reports.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import ReportBlocks from './ReportBlocks.svelte';
	import Trends from '#lib/people/Trends.svelte';

	const allowed = can('audit.view');
	const canManage = canManageReports(session.user?.role);
	const uid = $props.id();

	let from = $state('');
	let to = $state('');
	let generating = $state<string | null>(null);

	/** What is shown */
	interface Shown {
		type: string;
		title: string;
		data: Record<string, unknown>;
		generatedAt: string;
		filters: Record<string, unknown>;
		savedId: string | null;
	}
	let current = $state.raw<Shown | null>(null);
	let status = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' }>({
		message: '',
		tone: 'neutral'
	});
	let preview = $state<HTMLElement | null>(null);

	let saved = $state.raw<SavedReport[] | null>(null);
	let savedError = $state(false);

	async function loadSaved() {
		savedError = false;
		try {
			saved = await listSavedReports();
		} catch {
			savedError = true;
		}
	}

	$effect(() => {
		if (!allowed) return;
		untrack(() => void loadSaved());
		return onRefresh(() => void loadSaved());
	});

	async function show(next: Shown) {
		current = next;
		status = { message: '', tone: 'neutral' };
		await tick();
		preview?.focus({ preventScroll: true });
		preview?.scrollIntoView({ block: 'start' });
	}

	async function generate(type: string) {
		if (generating) return;
		generating = type;
		const filters = reportFilters(from, to);
		try {
			const r = await generateReport(type, filters);
			await show({
				type,
				title: typeLabel(type, t),
				data: r.data,
				generatedAt: r.generated_at,
				filters,
				savedId: null
			});
		} catch (err) {
			toast.error(t('reports.generate_failed', { error: err instanceof Error ? err.message : '' }));
		} finally {
			generating = null;
		}
	}

	async function openSaved(r: SavedReport) {
		try {
			const full = await getSavedReport(r.id);
			const type = full.report_type || full.type;
			await show({
				type,
				title: full.title || typeLabel(type, t),
				data: full.payload,
				generatedAt: full.created_at,
				filters: full.filters,
				savedId: String(full.id)
			});
		} catch (err) {
			toast.error(t('reports.open_failed', { error: err instanceof Error ? err.message : '' }));
		}
	}

	function download(text: string, mime: string, name: string) {
		const url = URL.createObjectURL(new Blob([text], { type: mime }));
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	async function downloadAs(kind: 'json' | 'csv') {
		const r = current;
		if (!r) return;
		const day = new Date().toISOString().slice(0, 10);
		if (kind === 'json') {
			download(JSON.stringify(r.data, null, 2), 'application/json', `report_${r.type}_${day}.json`);
			return;
		}
		try {
			const csv = await reportCsv(r.type, r.filters as { from?: string; to?: string }, csvSection(r.data));
			download(csv, 'text/csv', `report_${r.type}_${day}.csv`);
		} catch (err) {
			toast.error(t('reports.download_failed', { error: err instanceof Error ? err.message : '' }));
		}
	}

	async function saveCurrent() {
		const r = current;
		if (!r || r.savedId) return;
		const title = await prompt({
			title: t('reports.save_title'),
			label: t('reports.report_name'),
			value: `${typeLabel(r.type, t)}, ${formatDate(r.generatedAt)}`,
			hint: t('reports.save_hint'),
			required: true,
			confirmLabel: t('reports.save')
		});
		const name = title?.trim();
		if (!name) return;
		status = { message: t('reports.saving'), tone: 'neutral' };
		try {
			const out = await saveReport(r.type, name, r.filters as { from?: string; to?: string });
			current = { ...r, savedId: String(out.id), title: name };
			status = { message: t('reports.saved_ok', { title: name }), tone: 'ok' };
			void loadSaved();
		} catch (err) {
			status = {
				message: t('reports.save_failed', { error: err instanceof Error ? err.message : '' }),
				tone: 'error'
			};
		}
	}

	async function removeSaved(r: SavedReport, name: string) {
		const ok = await confirm({
			title: t('reports.delete_title'),
			message: t('reports.delete_confirm_named', { name }),
			confirmLabel: t('reports.delete_saved'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteSavedReport(r.id);
			toast.success(t('reports.deleted', { name }));
			if (current?.savedId === String(r.id)) current = null;
			void loadSaved();
		} catch (err) {
			toast.error(t('reports.delete_failed', { error: err instanceof Error ? err.message : '' }));
		}
	}

	const blocks = $derived(
		current ? reportBlocks(current.type, current.data, t, link('/security-audit?tab=audit')) : []
	);
	const meta = $derived.by(() => {
		if (!current) return '';
		const date = formatDate(current.generatedAt);
		const period = periodText(current.filters, t);
		return current.savedId && current.title !== typeLabel(current.type, t)
			? t('reports.saved_meta', { type: typeLabel(current.type, t), date, period })
			: t('reports.generated_meta', { date, period });
	});
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide reports-page">
		<div class="page-head">
			<h1>{t('reports.title')}</h1>
			<p class="page-description">{t('reports.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				<section class="section" aria-labelledby="{uid}-new">
					<div class="section-head"><h2 id="{uid}-new">{t('reports.new_report')}</h2></div>
					<p class="section-note">{t('reports.new_report_note')}</p>
					<fieldset class="period" aria-describedby="{uid}-period-hint">
						<legend>{t('reports.period')}</legend>
						<label class="date">
							<span>{t('reports.date_from')}</span>
							<Input type="date" small bind:value={from} max={to || undefined} />
						</label>
						<label class="date">
							<span>{t('reports.date_to')}</span>
							<Input type="date" small bind:value={to} min={from || undefined} />
						</label>
						<span class="hint" id="{uid}-period-hint">{t('reports.period_hint')}</span>
					</fieldset>
					<div class="types">
						<RowList>
							{#each REPORT_TYPES as type (type)}
								{#snippet gen()}<Button
										size="sm"
										busy={generating === type}
										disabled={!!generating && generating !== type}
										aria-describedby="{uid}-type-{type}"
										onclick={() => void generate(type)}
										>{generating === type ? t('reports.generating') : t('reports.generate')}</Button
									>{/snippet}
								{#snippet sub()}<span id="{uid}-type-{type}" class="sr-only">{t(`reports.type_${type}`)}</span
									>{t(`reports.type_${type}_desc`)}{/snippet}
								<ListRow title={t(`reports.type_${type}`)} {sub} actions={gen} />
							{/each}
						</RowList>
					</div>
				</section>

				{#if current}
					<section class="section preview" aria-labelledby="{uid}-preview" tabindex="-1" bind:this={preview}>
						<div class="section-head">
							<h2 id="{uid}-preview">{current.title}</h2>
							{#if canManage && !current.savedId}
								<Button size="sm" onclick={() => void saveCurrent()}>{t('reports.save')}</Button>
							{/if}
							<MenuButton label={t('reports.download')} icon={ICONS.download} size="sm" align="end">
								<MenuItem icon={ICONS.download} onselect={() => void downloadAs('json')}
									>{t('reports.download_json')}</MenuItem
								>
								{#if !current.savedId}
									<MenuItem icon={ICONS.download} onselect={() => void downloadAs('csv')}
										>{t('reports.download_csv')}</MenuItem
									>
								{/if}
							</MenuButton>
						</div>
						<p class="section-note">{meta}</p>
						<FormStatus message={status.message} tone={status.tone} />
						<ReportBlocks {blocks} label={current.title} />
						<Disclosure title={t('reports.raw_json')} level={3}>
							<CodeBlock code={JSON.stringify(current.data, null, 2)} title={t('reports.raw_json')} />
						</Disclosure>
					</section>
				{/if}

				<Trends />
			</div>

			<aside class="page-side" aria-labelledby="{uid}-saved">
				<section class="section">
					<div class="section-head"><h2 id="{uid}-saved">{t('reports.saved')}</h2></div>
					<p class="section-note">{t('reports.saved_note')}</p>
					{#if savedError}
						<States
							kind="error"
							message={t('reports.saved_load_failed')}
							retryLabel={t('reports.try_again')}
							onretry={() => void loadSaved()}
						/>
					{:else if !saved}
						<States kind="loading" message={t('reports.loading')} />
					{:else if !saved.length}
						<RowList><ListRow empty title={t('reports.no_saved')} /></RowList>
					{:else}
						<RowList>
							{#each saved as r (r.id)}
								{@const name = r.title || r.name || typeLabel(r.report_type || r.type, t)}
								{#snippet sub()}<span class="saved-type"
										><Tag label={typeLabel(r.report_type || r.type, t)} /></span
									><span class="saved-by"
										>{#if r.created_by}{@const [before, after] = savedByParts(r.created_by, t)}{before}<Time
												value={r.created_at}
												relative={false}
											/>{after}{:else}<Time value={r.created_at} relative={false} />{/if}</span
									>{/snippet}
								{#snippet actions()}<Button
										size="sm"
										icon={ICONS.open}
										aria-label={t('reports.open_named', { name })}
										onclick={() => void openSaved(r)}>{t('reports.open')}</Button
									>{#if canManage}<MenuButton kebab label={t('reports.actions_for', { name })}>
											<MenuItem icon={ICONS.delete} danger onselect={() => void removeSaved(r, name)}
												>{t('reports.delete_saved')}</MenuItem
											>
										</MenuButton>{/if}{/snippet}
								<ListRow title={name} {sub} {actions} />
							{/each}
						</RowList>
					{/if}
				</section>
			</aside>
		</div>
	</div>
{/if}

<style>
	.period {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.period legend {
		float: inline-start;
		margin-inline-end: var(--space-2);
		padding: 0;
		font-weight: 600;
	}
	.date {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.date > span {
		color: var(--text-muted);
	}
	.date :global(.form-input) {
		width: auto;
	}
	.hint {
		flex-basis: 100%;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.preview:focus {
		outline: none;
	}
	.saved-type,
	.saved-by {
		display: block;
	}
	/* From 1800 px the report types sit in two columns, so each Generate stays near its name */
	@media (min-width: 1800px) {
		.types :global(.list) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: var(--space-7);
		}
	}
</style>
