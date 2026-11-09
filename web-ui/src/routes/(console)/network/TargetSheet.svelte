<!--
  Add or edit a network target (server.config): name, then what to check
  (host, kind of check, the port for port and web checks), then how often
  and whether it is checked at all. An editing sheet: Cancel on the start
  side, Add or Save last; Enter in a field saves. A refused value is marked
  on its field; a refusal from the server goes in the status line.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createTarget, updateTarget, type CheckType, type Target } from '#lib/api/network.ts';
	import {
		cleanHost,
		defaultPort,
		formBody,
		formErrors,
		formFor,
		intervalLabel,
		intervalOptions
	} from '#lib/devices-area/network.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import { FormError, createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { target, onclose, onsaved }: { target: Target | null; onclose: () => void; onsaved: () => void } =
		$props();

	const uid = $props.id();
	const portId = `${uid}-port-fields`;

	const form = createForm({
		initial: untrack(() => formFor(target)),
		validate: (v) => {
			const e = formErrors(v);
			return {
				name: e.name ? t(e.name) : undefined,
				host: e.host ? t(e.host) : undefined,
				port: e.port ? t(e.port) : undefined
			};
		},
		submit: async (v) => {
			const body = formBody(v);
			try {
				if (target) await updateTarget(target.id, body);
				else await createTarget(body);
			} catch (err) {
				const reason = err instanceof Error && err.message ? err.message : t('network.request_failed');
				throw new FormError(t('network.save_failed', { reason }));
			}
			toast.success(
				target
					? t('network.saved_target', { name: body.name })
					: t('network.added_target', { name: body.name })
			);
			onsaved();
		}
	});

	const typeOptions = $derived<{ value: CheckType; label: string }[]>([
		{ value: 'ping', label: t('network.type_ping_long') },
		{ value: 'tcp', label: t('network.type_tcp_long') },
		{ value: 'http', label: t('network.type_http_long') },
		{ value: 'https', label: t('network.type_https_long') }
	]);
	const intervals = $derived(
		intervalOptions(untrack(() => form.values.interval)).map((s) => {
			const l = intervalLabel(s);
			return { value: s, label: t(l.key, l.params) };
		})
	);
	const portHint = $derived(
		form.values.check_type === 'tcp'
			? t('network.port_hint_tcp')
			: t('network.port_hint_web', { port: defaultPort(form.values.check_type) ?? '' })
	);
</script>

<Sheet
	title={target ? t('network.edit_target_title', { name: target.name }) : t('network.add_target')}
	subtitle={t('network.target_sheet_desc')}
	status={form.status.state === 'saving' ? t('network.saving') : form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('network.name')} hint={t('network.name_hint')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} width="host" maxlength={120} required bind:value={form.values.name} />
			{/snippet}
		</Field>
		<FormSection title={t('network.section_check')}>
			<Field label={t('network.host')} hint={t('network.host_hint')} error={form.errors.host}>
				{#snippet children(f)}
					<Input
						{...f}
						width="host"
						class="mono"
						autocapitalize="off"
						autocomplete="off"
						spellcheck={false}
						required
						bind:value={form.values.host}
						onblur={() => (form.values.host = cleanHost(form.values.host) || form.values.host.trim())}
					/>
				{/snippet}
			</Field>
			<Field label={t('network.check_type')}>
				{#snippet children(f)}
					<Select
						{...f}
						width="host"
						options={typeOptions}
						aria-controls={portId}
						bind:value={form.values.check_type}
					/>
				{/snippet}
			</Field>
			<ShowWhen id={portId} when={form.values.check_type !== 'ping'}>
				<Field label={t('network.port')} hint={portHint} error={form.errors.port}>
					{#snippet children(f)}
						<Input
							{...f}
							width="short"
							type="number"
							inputmode="numeric"
							min={1}
							max={65535}
							bind:value={form.values.port}
						/>
					{/snippet}
				</Field>
			</ShowWhen>
		</FormSection>
		<FormSection title={t('network.section_schedule')}>
			<Field label={t('network.interval_label')} hint={t('network.interval_hint')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={intervals} bind:value={form.values.interval} />
				{/snippet}
			</Field>
			<Checkbox
				label={t('network.enabled_label')}
				hint={t('network.enabled_hint')}
				bind:checked={form.values.enabled}
			/>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{target ? t('network.save_target') : t('network.add_target')}</Button
		>
	{/snippet}
</Sheet>
