<!--
  Add or edit an RDP/VNC target (a computer without the BetterDesk client
  that people reach in the browser through this server). The password field
  shows only when the password is saved here; the fingerprint only with TLS.
  Switching the technology moves the port along while it is still the other
  one's default. A test result belongs to the values it was made with, so
  changing a field clears the status line.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { CredentialMode, RemoteProtocol, RemoteTargetInput, TlsMode } from '#lib/api/remoteTargets.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import type { DeviceLike } from '../model.ts';

	let {
		device,
		save,
		test,
		canTest,
		settle
	}: {
		device: DeviceLike | null;
		save: (input: RemoteTargetInput, password: string) => Promise<void>;
		test: (input: RemoteTargetInput) => Promise<string>;
		canTest: boolean;
		settle: (done: true | null) => void;
	} = $props();

	const uid = $props.id();
	const PORTS: Record<RemoteProtocol, number> = { rdp: 3389, vnc: 5900 };

	function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
		return allowed.includes(value as T) ? (value as T) : fallback;
	}

	const start = untrack(() => {
		const d = device;
		const protocol = pick<RemoteProtocol>(d?.remote_protocol, ['rdp', 'vnc'], 'rdp');
		return {
			name: String(d?.name || d?.display_name || ''),
			protocol,
			host: String(d?.host ?? ''),
			port: d?.port ? String(d.port) : String(PORTS[protocol]),
			platform: String(d?.platform ?? ''),
			username: String(d?.username ?? ''),
			credential_mode: pick<CredentialMode>(d?.credential_mode, ['saved', 'prompt', 'none'], 'prompt'),
			password: '',
			tls_mode: pick<TlsMode>(d?.tls_mode, ['required', 'preferred', 'disabled'], 'required'),
			cert_fingerprint: String(d?.cert_fingerprint ?? ''),
			enabled: d?.enabled !== false
		};
	});
	const hasSavedPassword = untrack(() => device?.credential_mode === 'saved');

	let statusOverride = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' } | null>(null);
	let testing = $state(false);

	function input(v: typeof start): RemoteTargetInput {
		return {
			name: v.name.trim(),
			protocol: v.protocol,
			platform: v.platform.trim(),
			host: v.host.trim(),
			port: Number(v.port),
			username: v.username.trim(),
			credential_mode: v.credential_mode,
			tls_mode: v.tls_mode,
			cert_fingerprint: v.cert_fingerprint.trim()
		};
	}

	const portOk = (p: string) => /^\d+$/.test(p.trim()) && Number(p) >= 1 && Number(p) <= 65535;

	const form = createForm({
		initial: start,
		validate: (v) => ({
			name: v.name.trim() ? undefined : t('common.name_required'),
			host: v.host.trim()
				? undefined
				: t('common.field_required', { field: tf('devices.remote_host', 'Host or IP') }),
			port: portOk(v.port) ? undefined : t('mesh.port_invalid'),
			password:
				v.credential_mode === 'saved' && !v.password && !hasSavedPassword
					? tf('devices.remote_password_required', 'Enter the password to save.')
					: undefined
		}),
		submit: async (v) => {
			statusOverride = null;
			try {
				await save({ ...input(v), enabled: v.enabled }, v.password);
			} catch (err) {
				throw new FormError(err instanceof Error ? err.message : t('errors.server_error'));
			}
			settle(true);
		}
	});

	// Changing a field drops the last test result or error
	let last = JSON.stringify(start);
	$effect(() => {
		const now = JSON.stringify(form.values);
		if (now !== last) {
			last = now;
			statusOverride = null;
		}
	});

	let lastProtocol: RemoteProtocol = start.protocol;
	function onProtocol() {
		const p = form.values.port.trim();
		if (!p || Number(p) === PORTS[lastProtocol]) form.values.port = String(PORTS[form.values.protocol]);
		lastProtocol = form.values.protocol;
	}

	async function runTest() {
		if (testing) return;
		const v = form.values;
		if (!v.host.trim()) {
			form.setError('host', t('common.field_required', { field: tf('devices.remote_host', 'Host or IP') }));
			document.getElementById(`${uid}-host`)?.focus();
			return;
		}
		if (!portOk(v.port)) {
			form.setError('port', t('mesh.port_invalid'));
			document.getElementById(`${uid}-port`)?.focus();
			return;
		}
		testing = true;
		statusOverride = { message: tf('devices.remote_testing', 'Testing the connection…'), tone: 'neutral' };
		try {
			statusOverride = { message: await test(input(v)), tone: 'ok' };
		} catch (err) {
			statusOverride = { message: err instanceof Error ? err.message : String(err), tone: 'error' };
		} finally {
			testing = false;
		}
	}

	const status = $derived(statusOverride?.message ?? form.status.message);
	const tone = $derived(statusOverride?.tone ?? (form.status.state === 'error' ? 'error' : 'neutral'));
</script>

<Sheet
	title={device
		? tf('devices.remote_edit_title', 'Edit RDP/VNC target')
		: tf('devices.remote_add_title', 'Add RDP/VNC target')}
	subtitle={tf(
		'devices.remote_sheet_desc',
		'A computer without the BetterDesk client. People connect to it in the browser, through this server.'
	)}
	{status}
	statusTone={tone}
	onclose={() => settle(null)}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field
			label={tf('devices.remote_name', 'Display name')}
			hint={tf('devices.remote_name_hint', 'How it appears in the device list.')}
			error={form.errors.name}
		>
			{#snippet children(f)}
				<Input {...f} required maxlength={160} bind:value={form.values.name} />
			{/snippet}
		</Field>
		<FormSection title={tf('devices.remote_section_connection', 'Connection')}>
			<Field
				label={tf('devices.remote_protocol', 'Technology')}
				hint={tf(
					'devices.remote_protocol_hint',
					'RDP for Windows computers, VNC for most Linux and macOS screens.'
				)}
			>
				{#snippet children(f)}
					<Select
						{...f}
						width="medium"
						options={[
							{ value: 'rdp', label: 'RDP' },
							{ value: 'vnc', label: 'VNC' }
						]}
						bind:value={form.values.protocol}
						onchange={onProtocol}
					/>
				{/snippet}
			</Field>
			<Field
				id="{uid}-host"
				label={tf('devices.remote_host', 'Host or IP')}
				hint={tf('devices.remote_host_hint', 'The address this server uses to reach the computer.')}
				error={form.errors.host}
			>
				{#snippet children(f)}
					<Input
						{...f}
						width="host"
						required
						maxlength={253}
						autocomplete="off"
						spellcheck="false"
						bind:value={form.values.host}
					/>
				{/snippet}
			</Field>
			<Field
				id="{uid}-port"
				label={tf('devices.remote_port', 'Port')}
				hint={tf('devices.remote_port_hint', 'RDP usually uses 3389, VNC 5900.')}
				error={form.errors.port}
			>
				{#snippet children(f)}
					<Input
						{...f}
						width="short"
						type="number"
						inputmode="numeric"
						min={1}
						max={65535}
						required
						bind:value={form.values.port}
					/>
				{/snippet}
			</Field>
			<Field
				label={tf('devices.remote_platform', 'Operating system')}
				hint={tf(
					'devices.remote_platform_hint',
					'Shown in the device list, for example Windows 11 or Ubuntu.'
				)}
			>
				{#snippet children(f)}
					<Input {...f} width="medium" maxlength={80} bind:value={form.values.platform} />
				{/snippet}
			</Field>
		</FormSection>
		<FormSection title={tf('devices.remote_section_signin', 'Sign-in')}>
			<Field label={tf('devices.remote_username', 'Username')}>
				{#snippet children(f)}
					<Input
						{...f}
						width="medium"
						autocomplete="off"
						spellcheck="false"
						bind:value={form.values.username}
					/>
				{/snippet}
			</Field>
			<Field label={tf('devices.remote_credentials', 'Password')}>
				{#snippet children(f)}
					<Select
						{...f}
						width="host"
						aria-controls="{uid}-password"
						options={[
							{ value: 'prompt', label: tf('devices.remote_prompt_password', 'Ask at every connection') },
							{ value: 'saved', label: tf('devices.remote_save_password', 'Save on this server') },
							{ value: 'none', label: tf('devices.remote_no_password', 'No password') }
						]}
						bind:value={form.values.credential_mode}
					/>
				{/snippet}
			</Field>
			<ShowWhen id="{uid}-password" when={form.values.credential_mode === 'saved'}>
				<Field
					label={tf('devices.remote_password', 'Saved password')}
					hint={tf(
						'devices.remote_password_hint',
						'Stored encrypted on this server and filled in at each connection.'
					) +
						(hasSavedPassword
							? ' ' + tf('devices.remote_password_keep_hint', 'Leave empty to keep the saved password.')
							: '')}
					error={form.errors.password}
				>
					{#snippet children(f)}
						<Input
							{...f}
							width="medium"
							type="password"
							autocomplete="new-password"
							bind:value={form.values.password}
						/>
					{/snippet}
				</Field>
			</ShowWhen>
		</FormSection>
		<FormSection title={tf('devices.remote_section_security', 'Security')}>
			<Field label={tf('devices.remote_tls', 'TLS encryption')}>
				{#snippet children(f)}
					<Select
						{...f}
						width="host"
						aria-controls="{uid}-fingerprint"
						options={[
							{ value: 'required', label: tf('devices.remote_tls_required', 'Required') },
							{
								value: 'preferred',
								label: tf('devices.remote_tls_preferred', 'When the computer supports it')
							},
							{ value: 'disabled', label: tf('devices.remote_tls_disabled', 'Off') }
						]}
						bind:value={form.values.tls_mode}
					/>
				{/snippet}
			</Field>
			<ShowWhen id="{uid}-fingerprint" when={form.values.tls_mode !== 'disabled'}>
				<Field
					label={tf('devices.remote_fingerprint', 'Trusted certificate fingerprint')}
					hint={tf(
						'devices.remote_fingerprint_hint',
						'SHA-256. Leave empty to confirm the certificate at the first connection.'
					)}
				>
					{#snippet children(f)}
						<Input
							{...f}
							class="mono"
							maxlength={128}
							autocomplete="off"
							spellcheck="false"
							bind:value={form.values.cert_fingerprint}
						/>
					{/snippet}
				</Field>
			</ShowWhen>
		</FormSection>
		<div class="enabled">
			<Checkbox
				label={tf('devices.remote_enabled', 'Enabled')}
				hint={tf(
					'devices.remote_enabled_hint',
					'When off, the target stays in the list but nobody can connect to it.'
				)}
				bind:checked={form.values.enabled}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		{#if canTest}
			<Button busy={testing} onclick={runTest}>{tf('devices.remote_test', 'Test connection')}</Button>
		{/if}
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('actions.save')}</Button>
	{/snippet}
</Sheet>

<style>
	.enabled {
		margin-top: var(--space-5);
		padding-top: var(--space-5);
		border-top: 1px solid var(--rule);
	}
</style>
