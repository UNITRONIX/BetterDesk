<!--
  Settings › Email (server.config). One form for the mail server; beside
  it whether mail works now (with the connection test, which checks the
  saved server) and what sends email. Old page: views/settings.ejs
  "Email", settings.js initEmailSection, renderEmailSide.
-->
<script lang="ts">
	import { errorText, getSmtp, saveSmtp, testSmtp, type SmtpConfig } from '#lib/api/settings-system.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import TabCols from '#lib/settings-b/TabCols.svelte';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Switch from '#lib/ui/Switch.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { trackDirty } from '#lib/settings/dirty.ts';

	const allowed = can('server.config');

	/** Sample values in empty fields (addresses, the same in every language) */
	const SAMPLE = { host: 'smtp.example.com', from: 'alerts@example.com', alert: 'ops@example.com' } as const;

	interface Values {
		host: string;
		port: number | null;
		secure: boolean;
		auth: boolean;
		user: string;
		pass: string;
		from: string;
		alert_email: string;
	}

	/** The form for a saved configuration; the password is never sent back, so it starts empty */
	function toValues(c: SmtpConfig | null): Values {
		const configured = !!c?.configured;
		return {
			host: configured ? (c?.host ?? '') : '',
			port: configured ? Number(c?.port) || 587 : 587,
			secure: configured && !!c?.secure,
			// The switch is the form's own: on when a user name is saved
			auth: configured && !!c?.user,
			user: configured ? (c?.user ?? '') : '',
			pass: '',
			from: configured ? (c?.from ?? '') : '',
			alert_email: configured ? (c?.alert_email ?? '') : ''
		};
	}

	let config = $state.raw<SmtpConfig | null>(null);
	let loadError = $state('');
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);

	const form = createForm<Values>({
		id: 'email-smtp-form',
		initial: toValues(null),
		submit: async (v) => {
			// Without a sign-in an empty user name goes out, which the server reads as "no sign-in"
			await saveSmtp({
				host: v.host.trim(),
				port: Number(v.port) || 587,
				secure: v.secure,
				user: v.auth ? v.user.trim() : '',
				pass: v.auth ? v.pass : '',
				from: v.from.trim(),
				alert_email: v.alert_email.trim()
			});
			config = await getSmtp();
			testResult = null;
			return toValues(config);
		},
		savedMessage: t('settings.email.smtp_saved')
	});

	async function load() {
		try {
			config = await getSmtp();
			loadError = '';
			form.reset(toValues(config));
		} catch (err) {
			config = null;
			loadError = errorText(err, t('errors.server_error'));
		}
	}

	async function onsubmit(e: SubmitEvent) {
		e.preventDefault();
		// Asks before anything is saved, as the old page did (a blank host is refused by the server)
		if (!config?.configured || form.values.host.trim()) {
			const yes = await confirm({
				title: t('settings.confirm.smtp_save_title'),
				message: t('settings.confirm.smtp_save'),
				confirmLabel: t('settings.email.smtp_save')
			});
			if (!yes) return;
		}
		await form.submit();
	}

	/** TLS goes with port 465 and STARTTLS with 587: switching one moves the other along */
	function secureChanged(on: boolean) {
		if (on && Number(form.values.port) === 587) form.values.port = 465;
		else if (!on && Number(form.values.port) === 465) form.values.port = 587;
	}

	async function test() {
		testing = true;
		testResult = null;
		try {
			const r = await testSmtp();
			testResult = r.success
				? { ok: true, message: t('settings.email.smtp_test_success') }
				: { ok: false, message: r.error || t('settings.email.smtp_test_failed') };
		} catch (err) {
			testResult = { ok: false, message: errorText(err, t('settings.email.smtp_test_failed')) };
		} finally {
			testing = false;
		}
	}

	$effect(() => {
		if (!allowed) return;
		void load();
		return onRefresh(() => void load());
	});

	$effect(() => trackDirty(() => form.dirty));

	const configured = $derived(!!config?.configured);
	const facts = $derived([
		{
			label: t('settings.email.host_label'),
			value: config?.host ? `${config.host}:${config.port || 587}` : ''
		},
		{ label: t('settings.email.smtp_from'), value: config?.from ?? '' },
		{ label: t('settings.email.alert_email'), value: config?.alert_email ?? '' }
	]);
</script>

{#if !allowed}
	<States message={t('settings.page.admin_only')} />
{:else}
	<TabCols formSide sideLabel={t('settings.side.state_title')}>
		{#snippet main()}
			<section class="section" aria-labelledby="email-title">
				<h2 id="email-title">{t('settings.email.server_title')}</h2>
				<p class="section-note">{t('settings.email.server_note')}</p>
				<form class="form-column" id={form.id} {onsubmit} novalidate>
					<Field id="email-smtp-host" label={t('settings.email.host_label')} width="host">
						{#snippet children(f)}
							<Input
								{...f}
								class="mono"
								placeholder={SAMPLE.host}
								autocomplete="off"
								spellcheck="false"
								bind:value={form.values.host}
							/>
						{/snippet}
					</Field>
					<Field
						id="email-smtp-port"
						label={t('settings.email.smtp_port')}
						hint={t('settings.email.port_hint')}
						width="short"
					>
						{#snippet children(f)}
							<Input {...f} type="number" min="1" max="65535" bind:value={form.values.port} />
						{/snippet}
					</Field>
					<Checkbox
						id="email-smtp-secure"
						label={t('settings.email.secure_label')}
						hint={t('settings.email.secure_hint')}
						bind:checked={form.values.secure}
						onchange={(e) => secureChanged(e.currentTarget.checked)}
					/>
					<Switch
						id="email-smtp-auth"
						label={t('settings.email.auth_label')}
						hint={t('settings.email.auth_hint')}
						bind:checked={form.values.auth}
						{...showWhenControl('email-smtp-auth-fields', form.values.auth)}
					/>
					<ShowWhen id="email-smtp-auth-fields" when={form.values.auth} class="settings-subfields">
						<Field id="email-smtp-user" label={t('settings.email.smtp_user')} width="host">
							{#snippet children(f)}
								<Input {...f} autocomplete="off" spellcheck="false" bind:value={form.values.user} />
							{/snippet}
						</Field>
						<Field
							id="email-smtp-pass"
							label={t('settings.email.smtp_pass')}
							hint={t('settings.email.pass_hint')}
							width="host"
						>
							{#snippet children(f)}
								<Input {...f} type="password" autocomplete="new-password" bind:value={form.values.pass} />
							{/snippet}
						</Field>
					</ShowWhen>
					<Field
						id="email-smtp-from"
						label={t('settings.email.smtp_from')}
						hint={t('settings.email.from_hint')}
						width="host"
					>
						{#snippet children(f)}
							<Input {...f} type="email" placeholder={SAMPLE.from} bind:value={form.values.from} />
						{/snippet}
					</Field>
					<Field
						id="email-smtp-alert"
						label={t('settings.email.alert_email')}
						hint={t('settings.email.alert_email_hint')}
						width="host"
					>
						{#snippet children(f)}
							<Input {...f} type="email" placeholder={SAMPLE.alert} bind:value={form.values.alert_email} />
						{/snippet}
					</Field>
					<p class="field-effect">{t('settings.email.save_effect')}</p>
					<SaveBar {form} label={t('settings.email.smtp_save')} />
				</form>
			</section>
		{/snippet}

		{#snippet side()}
			<div class="settings-side-grid">
				<section class="section" aria-labelledby="email-side-title">
					<h2 id="email-side-title">{t('settings.side.state_title')}</h2>
					{#if loadError}
						<States kind="error" message={loadError} onretry={() => void load()} />
					{:else if !config}
						<States kind="loading" />
					{:else if !configured}
						<p><Status tone="neutral" label={t('settings.side.email_off')} /></p>
					{:else}
						<p><Status tone="good" label={t('settings.side.email_on')} /></p>
						<Facts items={facts} />
						<div class="settings-inline-controls">
							<Button id="email-smtp-test-btn" busy={testing} onclick={test}
								>{t('settings.email.smtp_test')}</Button
							>
							<span role="status">
								{#if testResult}
									<Status tone={testResult.ok ? 'good' : 'danger'} label={testResult.message} />
								{/if}
							</span>
						</div>
						<p class="hint">{t('settings.email.test_hint')}</p>
					{/if}
				</section>
				<section class="section" aria-labelledby="email-uses-title">
					<h2 id="email-uses-title">{t('settings.email.uses_title')}</h2>
					<RowList>
						<ListRow
							title={t('nav.automation')}
							sub={t('settings.email.uses_alerts')}
							href={link('/automation')}
						/>
						{#if can('billing.view')}
							<ListRow
								title={t('nav.help_requests')}
								sub={t('settings.email.uses_help')}
								href={link('/commercialization?settings=1#billing-settings-panel')}
							/>
						{/if}
					</RowList>
				</section>
			</div>
		{/snippet}
	</TabCols>
{/if}

<style>
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
