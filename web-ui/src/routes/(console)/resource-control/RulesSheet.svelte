<!--
  One device's USB and drive rules, in a wide sheet: the device's facts,
  then each kind of rule under its own heading (USB drives, optical
  drives, monitors, disks, usage limits), so every kind is one scroll
  away. One Save sends every kind that changed, each to its own
  endpoint, and names the ones that failed; closing with unsaved changes
  asks first.

  The server can't store these rules yet (BUGS.md P5): loading answers 404,
  which shows the defaults, and saving fails with a sentence that says why.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import { getDeviceRules, saveDeviceRules, type RcDevice } from '#lib/api/resourceControl.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		changedCategories,
		isOnline,
		RC_CATEGORIES,
		rcBody,
		rcValuesFrom,
		type RcCategory,
		type RcValues
	} from '#lib/rules/resourceControl.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';

	let { device, onclose }: { device: RcDevice; onclose: () => void } = $props();

	const uid = $props.id();
	const name = $derived(device.hostname || device.id);

	let values = $state<RcValues>(rcValuesFrom(null));
	let loaded = $state.raw<RcValues>(rcValuesFrom(null));
	let phase = $state<'loading' | 'none' | 'ready' | 'error'>('loading');
	let loadError = $state('');

	$effect(() => {
		const id = device.id;
		const ctrl = new AbortController();
		untrack(() => {
			phase = 'loading';
			getDeviceRules(id, ctrl.signal).then(
				(rules) => {
					const v = rcValuesFrom(rules);
					values = v;
					loaded = $state.snapshot(v) as RcValues;
					phase = rules ? 'ready' : 'none';
				},
				(err: unknown) => {
					if (err instanceof DOMException && err.name === 'AbortError') return;
					loadError = err instanceof Error ? err.message : '';
					phase = 'error';
				}
			);
		});
		return () => ctrl.abort();
	});

	const changed = $derived(changedCategories(values, loaded));
	let saving = $state(false);
	let status = $state('');
	let statusTone = $state<'neutral' | 'ok' | 'error'>('neutral');

	async function save(e?: SubmitEvent) {
		e?.preventDefault();
		if (saving) return;
		const cats = changed;
		if (!cats.length) {
			status = t('policies.no_changes');
			statusTone = 'neutral';
			return;
		}
		saving = true;
		status = t('ui_form.saving');
		statusTone = 'neutral';
		const snapshot = $state.snapshot(values) as RcValues;
		const next = $state.snapshot(loaded) as RcValues;
		const failed: { cat: RcCategory; msg: string }[] = [];
		for (const c of cats) {
			try {
				await saveDeviceRules(device.id, c, rcBody(c, snapshot));
				(next as Record<RcCategory, unknown>)[c] = snapshot[c];
			} catch (err) {
				// The server answers 404 while it has no place to store these rules
				const msg =
					err instanceof ApiError && err.status === 404
						? t('resource_control.save_unavailable')
						: t('resource_control.save_failed', { error: err instanceof Error ? err.message : '' });
				failed.push({ cat: c, msg });
			}
		}
		loaded = next;
		saving = false;
		if (!failed.length) {
			status = t('ui_form.saved');
			statusTone = 'ok';
		} else {
			const names = failed.map((f) => t(`resource_control.cat_${f.cat}`)).join(', ');
			const reasons = [...new Set(failed.map((f) => f.msg))].join(' ');
			status = `${reasons} ${t('policies.save_failed_groups', { groups: names })}`;
			statusTone = 'error';
		}
	}

	async function beforeclose(): Promise<boolean> {
		if (!changed.length) return true;
		return confirm({
			title: t('resource_control.discard_title'),
			message: t('resource_control.discard_message'),
			confirmLabel: t('resource_control.discard_confirm'),
			danger: true
		});
	}

	const facts = $derived([
		{ label: t('resource_control.fact_id'), value: idFact },
		{ label: t('resource_control.col_platform'), value: platformFact },
		{ label: t('resource_control.col_status'), value: statusFact }
	]);
	const usbPolicyOptions = $derived([
		{ value: 'allowed', label: t('resource_control.policy_allowed') },
		{ value: 'blocked', label: t('resource_control.policy_blocked') },
		{ value: 'whitelist', label: t('resource_control.policy_listed') }
	]);
	const opticalOptions = $derived([
		{ value: 'allowed', label: t('resource_control.policy_allowed') },
		{ value: 'blocked', label: t('resource_control.policy_blocked') }
	]);
	// Resolutions are written the same in every language
	const resolutionOptions = $derived([
		{ value: 'any', label: t('resource_control.policy_any') },
		{ value: '1920x1080', label: '1920 × 1080 (Full HD)' },
		{ value: '2560x1440', label: '2560 × 1440 (QHD)' },
		{ value: '3840x2160', label: '3840 × 2160 (4K UHD)' }
	]);
</script>

{#snippet idFact()}<ValueCopy value={device.id} label={t('resource_control.fact_id')} />{/snippet}
{#snippet platformFact()}<Platform platform={device.platform} />{/snippet}
{#snippet statusFact()}<Status
		tone={isOnline(device) ? 'good' : 'neutral'}
		label={t(isOnline(device) ? 'status.online' : 'status.offline')}
	/>{/snippet}

{#snippet range(id: string, label: string, hint: string, get: () => number, set: (n: number) => void)}
	<div class="form-group">
		<label class="form-label" for={id}>{label}</label>
		<div class="range">
			<input
				{id}
				type="range"
				min="0"
				max="100"
				value={get()}
				oninput={(e) => set(Number(e.currentTarget.value))}
				aria-describedby="{id}-hint"
			/>
			<output for={id}>{get()}%</output>
		</div>
		<p class="form-hint" id="{id}-hint">{hint}</p>
	</div>
{/snippet}

<Sheet
	title={t('resource_control.editor_title', { name })}
	subtitle={tf(
		'resource_control.save_all_hint',
		'Save stores every kind of rule you changed. Each kind is saved on its own.'
	)}
	wide
	status={status || (changed.length ? t('ui_form.unsaved') : '')}
	statusTone={status ? statusTone : 'neutral'}
	{beforeclose}
	{onclose}
>
	<div class="rc-editor">
		<Facts items={facts} />
		{#if phase === 'loading'}
			<States kind="loading" message={t('resource_control.editor_loading')} />
		{:else if phase === 'error'}
			<States kind="error" message={t('resource_control.editor_load_failed', { error: loadError })} />
		{:else}
			{#if phase === 'none'}<p class="note">{t('resource_control.editor_none')}</p>{/if}
			<form id="{uid}-form" onsubmit={save} novalidate>
				<!-- Every kind of rule in one form, each under its own heading -->
				{#each RC_CATEGORIES as id (id)}
					<FormSection title={t(`resource_control.cat_${id}`)}>
						{#if id === 'usb'}
							<p class="note">{t('resource_control.usb_note')}</p>
							<Field
								label={t('resource_control.usb_storage_label')}
								hint={t('resource_control.usb_storage_hint')}
								width="medium"
							>
								{#snippet children(f)}<Select
										{...f}
										aria-controls="{uid}-usb-list"
										options={usbPolicyOptions}
										bind:value={values.usb.storage_policy}
									/>{/snippet}
							</Field>
							<ShowWhen id="{uid}-usb-list" when={values.usb.storage_policy === 'whitelist'}>
								<Field
									label={t('resource_control.usb_list_label')}
									hint={t('resource_control.usb_list_hint')}
								>
									{#snippet children(f)}<Textarea
											{...f}
											class="mono"
											rows={4}
											dir="ltr"
											bind:value={values.usb.whitelist}
										/>{/snippet}
								</Field>
							</ShowWhen>
							<Checkbox
								label={t('resource_control.usb_log_label')}
								hint={t('resource_control.usb_log_hint')}
								bind:checked={values.usb.audit_log}
							/>
						{:else if id === 'optical'}
							<p class="note">{t('resource_control.optical_note')}</p>
							<Field
								label={t('resource_control.cat_optical')}
								hint={t('resource_control.optical_hint_new')}
								width="medium"
							>
								{#snippet children(f)}<Select
										{...f}
										options={opticalOptions}
										bind:value={values.optical.policy}
									/>{/snippet}
							</Field>
							<Checkbox
								label={t('resource_control.optical_log_label')}
								hint={t('resource_control.optical_log_hint')}
								bind:checked={values.optical.audit_log}
							/>
						{:else if id === 'monitors'}
							<p class="note">{t('resource_control.monitors_note')}</p>
							<Field
								label={t('resource_control.monitors_count_label')}
								hint={t('resource_control.zero_no_limit')}
								width="short"
							>
								{#snippet children(f)}<Input
										{...f}
										type="number"
										min={0}
										max={16}
										bind:value={values.monitors.max_count}
									/>{/snippet}
							</Field>
							<Field
								label={t('resource_control.monitors_resolution_label')}
								hint={t('resource_control.monitors_resolution_hint')}
								width="medium"
							>
								{#snippet children(f)}<Select
										{...f}
										options={resolutionOptions}
										bind:value={values.monitors.resolution}
									/>{/snippet}
							</Field>
							{@render range(
								`${uid}-brightness`,
								t('resource_control.monitors_brightness_label'),
								t('resource_control.monitors_brightness_hint'),
								() => values.monitors.brightness,
								(n) => (values.monitors.brightness = n)
							)}
							<Field
								label={t('resource_control.monitors_power_label')}
								hint={t('resource_control.monitors_power_hint_new')}
								width="medium"
							>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										bind:value={values.monitors.power_schedule}
									/>{/snippet}
							</Field>
						{:else if id === 'disks'}
							<p class="note">{t('resource_control.disks_note')}</p>
							<Checkbox
								label={t('resource_control.disks_readonly_label')}
								hint={t('resource_control.disks_readonly_hint')}
								bind:checked={values.disks.readonly}
							/>
							<Checkbox
								label={t('resource_control.disks_encryption_label')}
								hint={t('resource_control.disks_encryption_hint')}
								bind:checked={values.disks.encryption_required}
							/>
							<Checkbox
								label={t('resource_control.disks_smart_label')}
								hint={t('resource_control.disks_smart_hint')}
								bind:checked={values.disks.smart_monitoring}
							/>
							<Field
								label={t('resource_control.disks_hidden_label')}
								hint={t('resource_control.disks_hidden_hint_new')}
								width="medium"
							>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										bind:value={values.disks.hidden_partitions}
									/>{/snippet}
							</Field>
						{:else}
							<p class="note">{t('resource_control.quotas_note')}</p>
							{@render range(
								`${uid}-cpu`,
								t('resource_control.quotas_cpu_label'),
								t('resource_control.quotas_cpu_hint'),
								() => values.quotas.cpu_limit,
								(n) => (values.quotas.cpu_limit = n)
							)}
							{@render range(
								`${uid}-ram`,
								t('resource_control.quotas_ram_label'),
								t('resource_control.quotas_ram_hint'),
								() => values.quotas.ram_limit,
								(n) => (values.quotas.ram_limit = n)
							)}
							<Field
								label={t('resource_control.quotas_bandwidth_label')}
								hint={t('resource_control.zero_no_limit')}
								width="short"
							>
								{#snippet children(f)}<Input
										{...f}
										type="number"
										min={0}
										bind:value={values.quotas.bandwidth_limit}
									/>{/snippet}
							</Field>
							<Field
								label={t('resource_control.quotas_disk_label')}
								hint={t('resource_control.zero_no_limit')}
								width="short"
							>
								{#snippet children(f)}<Input
										{...f}
										type="number"
										min={0}
										bind:value={values.quotas.disk_quota}
									/>{/snippet}
							</Field>
							<Field
								label={t('resource_control.quotas_programs_label')}
								hint={t('resource_control.quotas_programs_hint')}
							>
								{#snippet children(f)}<Textarea
										{...f}
										class="mono"
										rows={4}
										dir="ltr"
										bind:value={values.quotas.process_whitelist}
									/>{/snippet}
							</Field>
						{/if}
					</FormSection>
				{/each}
				<p class="field-effect">{t('resource_control.effect_next_fetch')}</p>
			</form>
		{/if}
	</div>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button
			variant="primary"
			type="submit"
			form="{uid}-form"
			busy={saving}
			disabled={phase === 'loading' || phase === 'error'}
			>{tf('resource_control.save_rules', 'Save rules')}</Button
		>
	{/snippet}
</Sheet>

<style>
	/* Addresses, IDs, lists and JSON in the monospace font */
	form :global(.form-input.mono) {
		font-family: var(--mono);
	}
	.rc-editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.note {
		max-width: var(--measure);
		margin: 0;
		color: var(--text-muted);
	}
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* Slider with its value as text beside it */
	.range {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		max-width: 360px;
	}
	.range input {
		flex: 1;
		min-width: 0;
		min-height: var(--control-h);
		accent-color: var(--accent);
	}
	.range output {
		min-width: 5ch;
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.form-label {
		display: block;
		margin-bottom: var(--space-1);
		font-weight: 600;
	}
	.form-hint {
		margin: var(--space-1) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
