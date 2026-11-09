<!--
  Settings › Time zones (server.config). One form (one endpoint): the
  billing time zone, then the clock synchronisation with its expert
  options folded. Beside it: the billing period in the chosen zone (also
  before saving) and the server clock. Old page: views/settings.ejs
  "Time zones", settings.js initTimeSettingsTab, loadTimeSettingsTab.
-->
<script lang="ts">
	import {
		checkTimeSync,
		detectTimezone,
		errorText,
		getClockSettings,
		getTimeSync,
		saveClockSettings,
		type ClockSettings,
		type TimeSync
	} from '#lib/api/settings-system.ts';
	import { ApiError } from '#lib/api/client.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onRestartCanceled, showRestartPrompt } from '#lib/settings/restart.svelte.ts';
	import TabCols from '#lib/settings-b/TabCols.svelte';
	import {
		TIME_ERRORS,
		chosenZone,
		serversGiven,
		skewValid,
		zoneChoices,
		zoneLabel,
		zoneNow
	} from '#lib/settings-b/time.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import IdFacts, { type IdFact } from '#lib/settings-b/IdFacts.svelte';
	import { trackDirty } from '#lib/settings/dirty.ts';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { minuteNow } from '#lib/ui/clock.svelte.ts';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { FormError, createForm } from '#lib/ui/form.svelte.ts';

	const allowed = can('server.config');

	/** Sample values in empty fields (names, the same in every language) */
	const SAMPLE = { zone: 'Europe/Warsaw', servers: 'pool.ntp.org,time.google.com' } as const;

	interface Values {
		zone: string;
		custom: string;
		ntp_servers: string;
		max_skew_ms: number | null;
		require_synced_clock: boolean;
		trust_os_ntp: boolean;
	}

	let common = $state.raw<string[]>([]);
	let zones = $state.raw<string[]>(['UTC']);
	let dockerMode = $state(false);
	let loaded = $state(false);
	let loadError = $state('');
	let customOpen = $state(false);
	let detectLine = $state('');
	let detecting = $state(false);

	let sync = $state.raw<TimeSync | null>(null);
	let checking = $state(false);
	let checkLine = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' }>({
		message: '',
		tone: 'neutral'
	});

	function toValues(s: ClockSettings | null | undefined): Values {
		const zone = s?.billing_timezone || 'UTC';
		const inList = zones.includes(zone);
		return {
			zone: inList ? zone : 'UTC',
			// A saved zone the list doesn't have goes in the custom field
			custom: inList ? '' : zone,
			ntp_servers: s?.ntp_servers ?? '',
			max_skew_ms: Number(s?.max_skew_ms) || 2000,
			require_synced_clock: s?.require_synced_clock !== false,
			trust_os_ntp: s?.trust_os_ntp !== false
		};
	}

	/** What the last save asked for: a restart (native installs) or nothing */
	let restartAfterSave = $state.raw<Parameters<typeof showRestartPrompt>[0]>(null);

	const form = createForm<Values>({
		id: 'time-clock-settings-form',
		initial: {
			zone: 'UTC',
			custom: '',
			ntp_servers: '',
			max_skew_ms: 2000,
			require_synced_clock: true,
			trust_os_ntp: true
		},
		validate: (v) => ({
			ntp_servers: serversGiven(v.ntp_servers) ? undefined : t('settings.time.error_servers'),
			max_skew_ms: skewValid(Number(v.max_skew_ms)) ? undefined : t('settings.time.error_skew')
		}),
		submit: async (v) => {
			let result;
			try {
				result = await saveClockSettings({
					ntp_servers: v.ntp_servers,
					max_skew_ms: Number(v.max_skew_ms),
					require_synced_clock: v.require_synced_clock,
					trust_os_ntp: v.trust_os_ntp,
					billing_timezone: chosenZone(v.custom, v.zone)
				});
			} catch (err) {
				// Server error codes in plain words, on their field
				const known = err instanceof ApiError ? TIME_ERRORS[err.message] : undefined;
				if (known) {
					const field =
						known.field === 'billing_timezone' ? (v.custom.trim() ? 'custom' : 'zone') : known.field;
					throw new FormError(t(known.key), field);
				}
				throw err;
			}
			if (result.dockerMode) dockerMode = true;
			restartAfterSave = result.restartRequired ?? null;
			void refreshSync();
			return result.settings ? withZones(result.settings) : undefined;
		}
	});

	/** The saved values, with the saved zone added to the list when it is new */
	function withZones(s: ClockSettings): Values {
		zones = zoneChoices(s.billing_timezone || 'UTC', common);
		const values = toValues(s);
		if (values.custom) customOpen = true;
		return values;
	}

	async function load() {
		try {
			const detected = await detectTimezone();
			common = detected.common;
		} catch {
			common = ['UTC', 'Europe/Warsaw'];
		}
		try {
			const data = await getClockSettings();
			dockerMode = !!data.dockerMode;
			form.reset(withZones(data.settings ?? { ntp_servers: '', billing_timezone: 'UTC' }));
			loadError = '';
			loaded = true;
		} catch (err) {
			// Without the saved values the form would overwrite them with defaults
			loadError = errorText(err, t('errors.server_error'));
		}
		void refreshSync();
	}

	async function refreshSync() {
		try {
			sync = await getTimeSync();
		} catch {
			/* the side keeps the last known state */
		}
	}

	async function useServerZone() {
		detecting = true;
		try {
			const data = await detectTimezone();
			const tz = data.timezone || 'UTC';
			common = data.common.length ? data.common : common;
			zones = zoneChoices(tz, common);
			form.values.zone = tz;
			form.values.custom = '';
			detectLine = t('settings.time.detected', { tz });
		} catch (err) {
			detectLine = errorText(err, t('errors.server_error'));
		} finally {
			detecting = false;
		}
	}

	async function checkNow() {
		checking = true;
		checkLine = { message: '', tone: 'neutral' };
		try {
			await checkTimeSync();
			checkLine = { message: t('commercialization.clock.checked'), tone: 'ok' };
			await refreshSync();
		} catch (err) {
			checkLine = { message: errorText(err, t('errors.server_error')), tone: 'error' };
		} finally {
			checking = false;
		}
	}

	async function onsubmit(e: SubmitEvent) {
		e.preventDefault();
		// Natively the clock settings take effect after a server restart; Docker reloads them
		if (!dockerMode) {
			const yes = await confirm({
				title: t('settings.time.save_title'),
				message: t('commercialization.clock.save_restart'),
				confirmLabel: t('settings.time.save')
			});
			if (!yes) return;
		}
		restartAfterSave = null;
		const saved = await form.submit();
		if (!saved) return;
		if (restartAfterSave) {
			showRestartPrompt(restartAfterSave);
		} else {
			form.status = {
				state: 'saved',
				message: dockerMode ? t('commercialization.clock.saved_hot_reload') : t('settings.time.saved')
			};
		}
	}

	$effect(() => {
		if (!allowed) return;
		void load();
		const offRefresh = onRefresh(() => void refreshSync());
		// Cancel in the restart prompt puts the old values back: show them
		const offCancel = onRestartCanceled(() => void load());
		return () => {
			offRefresh();
			offCancel();
		};
	});

	$effect(() => trackDirty(() => form.dirty));

	const zone = $derived(chosenZone(form.values.custom, form.values.zone));
	const now = $derived(zoneNow(zone, i18n.locale, new Date(minuteNow())));
	const zoneOptions = $derived.by(() => {
		const at = new Date(minuteNow());
		return zones.map((z) => ({ value: z, label: zoneLabel(z, at) }));
	});
	const zoneHint = $derived(
		now
			? t('settings.time.zone_now', { offset: now.offset, time: now.time })
			: t('settings.time.zone_unknown', { zone })
	);
	const periodFacts = $derived<Fact[]>([
		{
			label: t('settings.time.period_current'),
			value: now ? t('settings.time.period_range', { start: now.start, end: now.end }) : ''
		},
		{
			label: t('settings.time.period_next'),
			value: now ? t('settings.time.period_next_value', { date: now.next, zone }) : ''
		}
	]);
	const clockFacts = $derived<IdFact[]>([
		{
			id: 'time-clock-offset',
			label: t('commercialization.clock.status_offset'),
			value:
				sync?.offset_ms !== null && sync?.offset_ms !== undefined
					? formatNumber(sync.offset_ms, { style: 'unit', unit: 'millisecond', unitDisplay: 'short' })
					: ''
		},
		{ id: 'time-clock-ntp-server', label: t('commercialization.clock.status_server'), value: ntpSource },
		{ id: 'time-clock-os-sync', label: t('commercialization.clock.status_os'), value: osSynced },
		{ id: 'time-clock-last-error', label: t('commercialization.clock.status_error'), value: lastError }
	]);
</script>

{#snippet ntpSource()}
	<ValueCopy value={sync?.ntp_server} copy={false} />
{/snippet}
{#snippet osSynced()}
	{#if typeof sync?.os_clock_synced === 'boolean'}
		<BooleanStatus
			value={sync.os_clock_synced}
			on={t('commercialization.clock.os_yes')}
			off={t('commercialization.clock.os_no')}
		/>
	{:else}
		<Empty />
	{/if}
{/snippet}
{#snippet lastError()}
	{#if sync?.last_error}
		<Status tone="danger" label={sync.last_error} />
	{:else}
		<Empty />
	{/if}
{/snippet}

{#if !allowed}
	<States message={t('settings.page.admin_only')} />
{:else}
	<TabCols formSide sideLabel={t('settings.side.clock_title')}>
		{#snippet main()}
			{#if loadError}
				<States kind="error" message={loadError} onretry={() => void load()} />
			{:else if !loaded}
				<States kind="loading" />
			{:else}
				<form class="time-form" id={form.id} {onsubmit} novalidate>
					<section class="section form-column" aria-labelledby="time-zone-title">
						<h2 id="time-zone-title">{t('settings.time.timezone_title')}</h2>
						<p class="section-note">{t('settings.time.timezone_desc')}</p>
						<Field
							id="time-billing-timezone"
							label={t('settings.time.billing_timezone')}
							hint={zoneHint}
							error={form.errors.zone}
						>
							{#snippet children(f)}
								<div class="settings-inline-controls">
									<Select {...f} class="zone-select" options={zoneOptions} bind:value={form.values.zone} />
									<Button id="time-detect-timezone-btn" busy={detecting} onclick={useServerZone}
										>{t('settings.time.use_server_zone')}</Button
									>
								</div>
							{/snippet}
						</Field>
						{#if detectLine}<FormStatus message={detectLine} />{/if}
						<Disclosure
							id="time-custom-zone"
							title={t('settings.time.custom_zone_toggle')}
							level={3}
							bind:open={customOpen}
						>
							<div class="disclosure-body">
								<Field
									id="time-billing-timezone-custom"
									label={t('settings.time.custom_zone_label')}
									hint={t('settings.time.custom_timezone_hint')}
									error={form.errors.custom}
									width="medium"
								>
									{#snippet children(f)}
										<Input
											{...f}
											class="mono"
											placeholder={SAMPLE.zone}
											maxlength={64}
											spellcheck="false"
											bind:value={form.values.custom}
										/>
									{/snippet}
								</Field>
							</div>
						</Disclosure>
						<p class="field-effect">{t('settings.time.billing_month_hint')}</p>
					</section>

					<section class="section form-column" aria-labelledby="time-ntp-title">
						<h2 id="time-ntp-title">{t('settings.time.sync_title')}</h2>
						<p class="section-note">{t('settings.time.ntp_desc')}</p>
						<Field
							id="time-clock-ntp-servers"
							label={t('settings.time.servers_label')}
							hint={t('settings.time.servers_hint')}
							error={form.errors.ntp_servers}
						>
							{#snippet children(f)}
								<Textarea
									{...f}
									class="mono"
									rows={2}
									placeholder={SAMPLE.servers}
									spellcheck="false"
									bind:value={form.values.ntp_servers}
								/>
							{/snippet}
						</Field>
						<Checkbox
							id="time-clock-require-sync"
							label={t('commercialization.clock.require_sync')}
							hint={t('settings.time.require_sync_hint')}
							bind:checked={form.values.require_synced_clock}
						/>
						<Disclosure id="time-clock-advanced" title={t('settings.time.advanced_toggle')} level={3}>
							<div class="disclosure-body settings-subfields">
								<Field
									id="time-clock-max-skew"
									label={t('settings.time.max_skew_label')}
									hint={t('settings.time.max_skew_hint')}
									error={form.errors.max_skew_ms}
									width="short"
								>
									{#snippet children(f)}
										<Input
											{...f}
											type="number"
											min="100"
											max="600000"
											step="100"
											bind:value={form.values.max_skew_ms}
										/>
									{/snippet}
								</Field>
								<Checkbox
									id="time-clock-trust-os"
									label={t('settings.time.trust_os_label')}
									hint={t('settings.time.trust_os_hint')}
									bind:checked={form.values.trust_os_ntp}
								/>
							</div>
						</Disclosure>
						<p class="field-effect is-restart">{t('settings.time.ntp_effect')}</p>
					</section>
					<SaveBar {form} label={t('settings.time.save')} />
				</form>
			{/if}
		{/snippet}

		{#snippet side()}
			<div class="settings-side-grid">
				<section class="section" aria-labelledby="time-period-title">
					<h2 id="time-period-title">{t('settings.time.period_title')}</h2>
					<Facts items={periodFacts} />
					<p class="hint">{t('settings.time.period_hint')}</p>
					{#if can('billing.view')}
						<p class="hint">
							<a href={link('/commercialization?tab=packages')}>{t('settings.time.commercialization_link')}</a
							>
						</p>
					{/if}
				</section>
				<section class="section" aria-labelledby="time-side-title">
					<h2 id="time-side-title">{t('settings.side.clock_title')}</h2>
					{#if sync}
						<p role="status">
							{#if sync.synced}
								<Status tone="good" label={t('commercialization.clock.synced_detail')} />
							{:else}
								<Status tone="warning" label={t('commercialization.clock.unsynced')} />
							{/if}
						</p>
					{/if}
					<IdFacts items={clockFacts} />
					<div class="settings-inline-controls">
						<Button id="time-timesync-check-btn" icon="refresh" busy={checking} onclick={checkNow}
							>{t('commercialization.clock.check_now')}</Button
						>
						<FormStatus message={checkLine.message} tone={checkLine.tone} />
					</div>
				</section>
			</div>
		{/snippet}
	</TabCols>
{/if}

<style>
	.time-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		max-width: var(--measure);
	}
	.time-form :global(.zone-select) {
		flex: 1 1 260px;
		width: auto;
		max-width: 48ch;
	}
	.disclosure-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-inline-start: var(--space-5);
		padding-bottom: var(--space-2);
	}
	.disclosure-body :global(.form-group) {
		margin-bottom: 0;
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
