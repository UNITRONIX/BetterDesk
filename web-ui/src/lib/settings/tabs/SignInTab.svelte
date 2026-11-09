<!--
  Settings › Sign-in. For everyone: their own password and two-factor
  sign-in. With server.config also how everyone signs in: device
  enrollment, client sessions, LDAP and single sign-on (OIDC). Each is its
  own form with its own save (different endpoints; LDAP and SSO have a
  test button and ask before a save that can lock people out).

  Element ids are the old page's, for links and the settings search.
-->
<script lang="ts">
	import {
		changePassword,
		disableTotp,
		enableTotp,
		getClientSessions,
		getEnrollment,
		getLdap,
		getOidc,
		getTotpEnabled,
		saveClientSessions,
		saveEnrollment,
		saveLdap,
		saveOidc,
		setupTotp,
		testLdap,
		testOidc
	} from '#lib/api/settings.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import Select from '#lib/ui/Select.svelte';
	import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Steps from '#lib/ui/Steps.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { trackDirty } from '../dirty.ts';
	import {
		ldapFromServer,
		ldapPayload,
		oidcFromServer,
		oidcPayload,
		passwordRules,
		validOidcRedirect,
		suggestedRedirect,
		type LdapValues,
		type OidcValues
	} from '../signin.ts';
	import SettingsGrid from '../SettingsGrid.svelte';
	import SettingsLayout from '../SettingsLayout.svelte';

	const canConfig = can('server.config');

	/** Examples in empty fields: addresses, directory names and claims, the same in every language */
	const EX = {
		ldapHost: 'ldap.example.com',
		ldapPort: '389',
		ldapTimeout: '10',
		bindDn: 'cn=readonly,dc=example,dc=com',
		baseDn: 'dc=example,dc=com',
		userFilter: '(sAMAccountName={{username}})',
		directBindDn: 'uid={{username}},ou=users,dc=example,dc=com',
		attrId: 'sAMAccountName',
		attrEmail: 'mail',
		attrName: 'displayName',
		groupBaseDn: 'ou=groups,dc=example,dc=com',
		groupFilter: '(member={{dn}})',
		groupAttr: 'cn',
		ldapRoleMap:
			'CN=BetterDesk Admins,OU=Groups,DC=example,DC=com=admin|CN=Operators,OU=Groups,DC=example,DC=com=operator',
		oidcName: 'Azure AD / Okta / Google',
		issuer: 'https://login.microsoftonline.com/{tenant}/v2.0',
		cidrs: '10.20.0.0/16, 192.168.50.10',
		redirect: 'https://your-server:5443/api/auth/oidc/callback',
		panel: 'http://your-server:5000',
		scopes: 'openid profile email',
		authUrl: 'https://idp.example.com/authorize',
		tokenUrl: 'https://idp.example.com/token',
		userinfoUrl: 'https://idp.example.com/userinfo',
		claimUser: 'preferred_username',
		claimEmail: 'email',
		claimName: 'name',
		claimGroups: 'groups',
		oidcRoleMap: 'betterdesk-admins=admin\nbetterdesk-operators=operator'
	} as const;
	const errText = (err: unknown, fallback = t('errors.server_error')) =>
		err instanceof Error && err.message ? err.message : fallback;
	type Line = { message: string; tone: 'neutral' | 'ok' | 'error' };
	const NO_LINE: Line = { message: '', tone: 'neutral' };

	/* ── Your password ── */

	const password = createForm({
		initial: { current: '', next: '', confirm: '' },
		validate: (v) => {
			const fill = t('settings.fill_all_fields');
			if (!v.current || !v.next || !v.confirm) {
				return {
					current: v.current ? undefined : fill,
					next: v.next ? undefined : fill,
					confirm: v.confirm ? undefined : fill
				};
			}
			if (!passwordRules(v.next).every((r) => r.met))
				return { next: t('settings.password_requirements_not_met') };
			if (v.next !== v.confirm) return { confirm: t('settings.passwords_not_match') };
			return null;
		},
		submit: async (v) => {
			await changePassword(v.current, v.next, v.confirm);
			return { current: '', next: '', confirm: '' };
		},
		savedMessage: t('settings.password_changed')
	});
	const rules = $derived(passwordRules(password.values.next));
	const RULE_LABEL: Record<string, string> = {
		length: 'settings.req_length',
		uppercase: 'settings.req_uppercase',
		lowercase: 'settings.req_lowercase',
		number: 'settings.req_number'
	};

	/* ── Two-factor sign-in ── */

	type TotpView = 'loading' | 'error' | 'off' | 'on' | 'setup' | 'codes' | 'disable';
	let totpView = $state<TotpView>('loading');
	let totpOn = $state<boolean | null>(null);
	let totpError = $state('');
	let totpNote = $state<Line>(NO_LINE);
	let setup = $state.raw<{ qrCode: string; secret: string } | null>(null);
	let code = $state('');
	let codeStatus = $state<Line>(NO_LINE);
	let codes = $state.raw<string[]>([]);
	let disablePassword = $state('');
	let disableStatus = $state<Line>(NO_LINE);
	let totpBusy = $state(false);
	let codeEl = $state<HTMLInputElement | null>(null);
	let disableEl = $state<HTMLInputElement | null>(null);
	let setupBtn = $state<HTMLElement | null>(null);

	async function loadTotp() {
		totpView = 'loading';
		try {
			totpOn = await getTotpEnabled();
			totpView = totpOn ? 'on' : 'off';
		} catch (err) {
			totpError = errText(err);
			totpView = 'error';
		}
	}

	// The QR code comes as a data URL from the server; anything else is not shown
	const qrSrc = $derived(
		setup && /^data:image\/(png|svg\+xml|jpeg|gif);base64,/i.test(setup.qrCode) ? setup.qrCode : ''
	);

	async function startSetup() {
		totpNote = NO_LINE;
		totpBusy = true;
		try {
			const s = await setupTotp();
			setup = { qrCode: s.qrCode ?? '', secret: s.secret ?? '' };
			code = '';
			codeStatus = NO_LINE;
			totpView = 'setup';
			await Promise.resolve();
			queueMicrotask(() => codeEl?.focus());
		} catch (err) {
			totpNote = { message: errText(err), tone: 'error' };
		} finally {
			totpBusy = false;
		}
	}

	async function verifyCode(e: SubmitEvent) {
		e.preventDefault();
		if (totpBusy) return;
		const c = code.trim();
		if (c.length !== 6) {
			codeStatus = { message: t('auth.totp_enter_code'), tone: 'error' };
			codeEl?.focus();
			return;
		}
		totpBusy = true;
		try {
			codes = await enableTotp(c);
			totpOn = true;
			totpView = 'codes';
		} catch (err) {
			codeStatus = { message: errText(err, t('auth.totp_invalid_code')), tone: 'error' };
		} finally {
			totpBusy = false;
		}
	}

	function startDisable() {
		disablePassword = '';
		disableStatus = NO_LINE;
		totpNote = NO_LINE;
		totpView = 'disable';
		queueMicrotask(() => disableEl?.focus());
	}

	async function confirmDisable(e: SubmitEvent) {
		e.preventDefault();
		if (totpBusy) return;
		if (!disablePassword) {
			disableStatus = { message: t('auth.fill_all_fields'), tone: 'error' };
			disableEl?.focus();
			return;
		}
		totpBusy = true;
		try {
			await disableTotp(disablePassword);
			disablePassword = '';
			await loadTotp();
			totpNote = { message: t('settings.totp_disabled_success'), tone: 'ok' };
		} catch (err) {
			disableStatus = { message: errText(err), tone: 'error' };
		} finally {
			totpBusy = false;
		}
	}

	function cancelTotp() {
		setup = null;
		void loadTotp().then(() => queueMicrotask(() => setupBtn?.focus()));
	}

	/* ── Device enrollment ── */

	const enrollment = createForm({
		initial: { mode: 'open', rich_approve: true, tag_picker: true },
		submit: async (v) => {
			const saved = await saveEnrollment(v);
			enrolledMode = saved.mode || v.mode;
			return {
				mode: enrolledMode,
				rich_approve: saved.rich_approve !== false,
				tag_picker: saved.tag_picker !== false
			};
		}
	});
	let enrolledMode = $state('open');
	let pendingCount = $state(0);

	async function loadEnrollment() {
		try {
			const d = await getEnrollment();
			enrolledMode = d.mode || 'open';
			pendingCount = Number(d.pending_count) || 0;
			enrollment.reset({
				mode: enrolledMode,
				rich_approve: d.rich_approve !== false,
				tag_picker: d.tag_picker !== false
			});
		} catch (err) {
			enrollment.status = { state: 'error', message: errText(err) };
		}
	}

	async function submitEnrollment(e: SubmitEvent) {
		e.preventDefault();
		if (enrollment.busy) return;
		const mode = enrollment.values.mode;
		if (mode !== enrolledMode) {
			const ok = await confirm({
				title: t('settings.confirm.enrollment_mode_title'),
				message: t('settings.confirm.enrollment_mode', { mode: t(`tokens.mode_${mode}`) }),
				confirmLabel: t('settings.signin.enrollment_save')
			});
			if (!ok) return;
		}
		await enrollment.submit();
	}

	/* ── Client sessions ── */

	const sessions = createForm({
		initial: { expiry_days: 7 as number | null, sliding: true, max_days: 30 as number | null },
		submit: async (v) => {
			const out = {
				expiry_days: Math.round(Number(v.expiry_days)) || 7,
				sliding: v.sliding,
				max_days: Math.round(Number(v.max_days)) || 30
			};
			await saveClientSessions({
				expiry_days: out.expiry_days,
				sliding: out.sliding,
				max_days: out.max_days
			});
			const d = await getClientSessions();
			return {
				expiry_days: Number(d.expiry_days ?? out.expiry_days),
				sliding: d.sliding !== false,
				max_days: Number(d.max_days ?? out.max_days)
			};
		}
	});

	async function loadSessions() {
		try {
			const d = await getClientSessions();
			sessions.reset({
				expiry_days: Number(d.expiry_days ?? 7),
				sliding: d.sliding !== false,
				max_days: Number(d.max_days ?? 30)
			});
		} catch (err) {
			sessions.status = { state: 'error', message: errText(err) };
		}
	}

	/* ── LDAP ── */

	let ldapWasEnabled = $state(false);
	let ldapOn = $state<boolean | null>(null);
	let ldapTest = $state<Line>(NO_LINE);
	let ldapTesting = $state(false);

	const ldap = createForm<LdapValues>({
		initial: ldapFromServer({}),
		submit: async (v) => {
			const body = ldapPayload(v);
			await saveLdap(body);
			ldapWasEnabled = body.enabled;
			ldapOn = body.enabled;
			return v;
		},
		savedMessage: t('settings.ldap_saved')
	});

	async function loadLdap() {
		try {
			const d = await getLdap();
			const v = ldapFromServer(d);
			ldap.reset(v);
			ldapWasEnabled = v.enabled;
			ldapOn = v.enabled;
		} catch (err) {
			ldap.status = { state: 'error', message: errText(err) };
		}
	}

	async function onLdapEnabled() {
		if (!ldap.values.enabled || ldapWasEnabled) return;
		const ok = await confirm({
			title: t('settings.confirm.ldap_enable_title'),
			message: t('settings.confirm.ldap_enable'),
			confirmLabel: t('settings.ldap_enabled')
		});
		if (!ok) ldap.values.enabled = false;
	}

	// TLS on: the usual LDAPS port; off: the plain one
	function onLdapTls() {
		const port = Number(ldap.values.port);
		if (ldap.values.use_tls && (port === 389 || !port)) ldap.values.port = 636;
		else if (!ldap.values.use_tls && port === 636) ldap.values.port = 389;
	}

	async function submitLdap(e: SubmitEvent) {
		e.preventDefault();
		if (ldap.busy) return;
		if (ldap.values.enabled) {
			const ok = await confirm({
				title: t('settings.confirm.ldap_save_title'),
				message: t('settings.confirm.ldap_save'),
				confirmLabel: t('settings.ldap_save')
			});
			if (!ok) return;
		}
		await ldap.submit();
	}

	async function runLdapTest() {
		if (ldapTesting) return;
		ldapTesting = true;
		ldapTest = NO_LINE;
		try {
			const r = await testLdap(ldapPayload($state.snapshot(ldap.values) as LdapValues));
			ldapTest =
				r.success !== false && !r.error
					? { message: t('settings.ldap_test_success'), tone: 'ok' }
					: { message: r.error || t('settings.ldap_test_failed'), tone: 'error' };
		} catch (err) {
			ldapTest = { message: errText(err, t('settings.ldap_test_failed')), tone: 'error' };
		} finally {
			ldapTesting = false;
		}
	}

	/* ── Single sign-on (OIDC) ── */

	let oidcWasEnabled = $state(false);
	let oidcOn = $state<boolean | null>(null);
	let oidcTest = $state<Line>(NO_LINE);
	let oidcTesting = $state(false);
	let issuerEl = $state<HTMLInputElement | null>(null);

	const oidc = createForm<OidcValues>({
		initial: oidcFromServer({}, location.origin),
		validate: (v) =>
			v.enabled && !validOidcRedirect(v.redirect_url)
				? { redirect_url: t('settings.oidc_redirect_url_invalid') }
				: null,
		submit: async (v) => {
			const body = oidcPayload(v, location.origin);
			await saveOidc(body);
			oidcWasEnabled = body.enabled;
			oidcOn = body.enabled;
			return v;
		},
		savedMessage: t('settings.oidc_saved')
	});

	// The redirect address must end in the callback path; said under the field as soon as it is wrong
	const redirectWarning = $derived(
		oidc.values.enabled && oidc.values.redirect_url.trim() && !validOidcRedirect(oidc.values.redirect_url)
			? `${t('settings.oidc_redirect_url_invalid')} ${t('settings.oidc_redirect_url_example', { url: suggestedRedirect(location.origin) })}`
			: ''
	);

	async function loadOidc() {
		try {
			const v = oidcFromServer(await getOidc(), location.origin);
			oidc.reset(v);
			oidcWasEnabled = v.enabled;
			oidcOn = v.enabled;
		} catch (err) {
			oidc.status = { state: 'error', message: errText(err) };
		}
	}

	async function onOidcEnabled() {
		if (oidc.values.enabled && !oidcWasEnabled) {
			const ok = await confirm({
				title: t('settings.confirm.oidc_enable_title'),
				message: t('settings.confirm.oidc_enable'),
				confirmLabel: t('settings.oidc_enabled')
			});
			if (!ok) {
				oidc.values.enabled = false;
				return;
			}
		}
		// Turning it on fills the callback and console addresses when they are empty
		if (oidc.values.enabled) {
			if (!oidc.values.redirect_url.trim()) oidc.values.redirect_url = suggestedRedirect(location.origin);
			if (!oidc.values.panel_url.trim()) oidc.values.panel_url = location.origin;
		}
	}

	async function submitOidc(e: SubmitEvent) {
		e.preventDefault();
		if (oidc.busy) return;
		if (oidc.values.enabled) {
			if (!validOidcRedirect(oidc.values.redirect_url)) {
				// The form's check refuses it and says why at the field
				await oidc.submit();
				document.getElementById('oidc-redirect-url')?.focus();
				return;
			}
			const ok = await confirm({
				title: t('settings.confirm.oidc_save_title'),
				message: t('settings.confirm.oidc_save'),
				confirmLabel: t('settings.oidc_save')
			});
			if (!ok) return;
		}
		await oidc.submit();
	}

	async function runOidcTest() {
		if (oidcTesting) return;
		oidcTest = NO_LINE;
		const issuer = oidc.values.issuer_url.trim();
		if (!issuer) {
			oidcTest = { message: t('settings.oidc_issuer_required'), tone: 'error' };
			issuerEl?.focus();
			return;
		}
		oidcTesting = true;
		try {
			const r = await testOidc(issuer, oidc.values.allowed_private_cidrs.trim());
			if (r.success !== false && !r.error) {
				const found = [r.authorization_endpoint, r.token_endpoint, r.userinfo_endpoint].filter(Boolean);
				oidcTest = {
					message: [t('settings.oidc_test_success'), found.join(', ')].filter(Boolean).join(' '),
					tone: 'ok'
				};
			} else {
				oidcTest = { message: r.error || t('settings.oidc_test_failed'), tone: 'error' };
			}
		} catch (err) {
			oidcTest = { message: errText(err, t('settings.oidc_test_failed')), tone: 'error' };
		} finally {
			oidcTesting = false;
		}
	}

	/* ── Start ── */

	$effect(() =>
		trackDirty(() => password.dirty || enrollment.dirty || sessions.dirty || ldap.dirty || oidc.dirty)
	);

	$effect(() => {
		void loadTotp();
		if (!canConfig) return;
		void loadEnrollment();
		void loadSessions();
		void loadLdap();
		void loadOidc();
	});

	const toc = $derived(
		canConfig
			? [
					{ id: 'account-password', label: t('settings.change_password') },
					{ id: 'auth-panel-totp', label: t('settings.totp_title') },
					{ id: 'enrollment-settings-section', label: t('settings.enrollment_title') },
					{ id: 'client-sessions-settings-section', label: t('settings.client_sessions_title') },
					{ id: 'auth-panel-ldap', label: t('settings.ldap_title') },
					{ id: 'auth-panel-oidc', label: t('settings.oidc_title') }
				]
			: undefined
	);

	const ROLES = $derived([
		{ value: 'viewer', label: t('settings.ldap_role_viewer') },
		{ value: 'operator', label: t('settings.ldap_role_operator') },
		{ value: 'admin', label: t('settings.ldap_role_admin') }
	]);
</script>

{#snippet onOff(value: boolean | null)}
	{#if value === null}<Empty />{:else}<BooleanStatus
			{value}
			on={t('settings.side.on')}
			off={t('settings.side.off')}
		/>{/if}
{/snippet}
{#snippet side2fa()}{@render onOff(totpOn)}{/snippet}
{#snippet sideLdap()}{@render onOff(ldapOn)}{/snippet}
{#snippet sideOidc()}{@render onOff(oidcOn)}{/snippet}

{#snippet side()}
	<section class="section" aria-labelledby="auth-side-title" data-search-skip>
		<h2 id="auth-side-title">{t('settings.side.state_title')}</h2>
		<Facts
			items={[
				{ label: t('settings.side.your_2fa'), value: side2fa },
				...(canConfig
					? [
							{ label: t('settings.ldap_title'), value: sideLdap },
							{ label: t('settings.oidc_title'), value: sideOidc }
						]
					: [])
			]}
		/>
	</section>
{/snippet}

<SettingsLayout {toc} {side} sideLabelledby="auth-side-title" sticky>
	<section class="section" aria-labelledby="your-account-title">
		<h2 id="your-account-title">{t('settings.signin.your_account')}</h2>
		<p class="section-note">
			{t('settings.signin.your_account_note', { user: session.user?.username ?? '' })}
		</p>

		<SettingsGrid>
			{#snippet start()}
				<form id={password.id} class="form-column settings-subgroup" onsubmit={password.onsubmit} novalidate>
					<h3 id="account-password">{t('settings.change_password')}</h3>
					<Field id="current-password" label={t('settings.current_password')} error={password.errors.current}>
						{#snippet children(f)}
							<Input
								{...f}
								type="password"
								autocomplete="current-password"
								bind:value={password.values.current}
							/>
						{/snippet}
					</Field>
					<Field id="new-password" label={t('settings.new_password')} error={password.errors.next}>
						{#snippet children(f)}
							<Input
								{...f}
								describedby={[f.describedby, 'password-requirements'].filter(Boolean).join(' ')}
								type="password"
								autocomplete="new-password"
								minlength={8}
								bind:value={password.values.next}
							/>
							<div class="password-requirements" id="password-requirements">
								<p class="form-hint">{t('settings.password_requirements')}:</p>
								<ul>
									{#each rules as rule (rule.id)}
										<li id="req-{rule.id}" class={{ valid: rule.met }}>{t(RULE_LABEL[rule.id] ?? '')}</li>
									{/each}
								</ul>
							</div>
						{/snippet}
					</Field>
					<Field id="confirm-password" label={t('settings.confirm_password')} error={password.errors.confirm}>
						{#snippet children(f)}
							<Input
								{...f}
								type="password"
								autocomplete="new-password"
								bind:value={password.values.confirm}
							/>
						{/snippet}
					</Field>
					<p class="field-effect">{t('settings.signin.password_effect')}</p>
					<SaveBar form={password} label={t('settings.save_password')} />
				</form>
			{/snippet}
			{#snippet end()}
				<div class="form-column settings-subgroup" id="auth-panel-totp">
					<h3>{t('settings.totp_title')}</h3>
					<p class="form-hint">{t('settings.signin.totp_note')}</p>
					<div class="totp" aria-live="polite">
						{#if totpNote.message}<FormStatus message={totpNote.message} tone={totpNote.tone} />{/if}
						{#if totpView === 'loading'}
							<States kind="loading" />
						{:else if totpView === 'error'}
							<States kind="error" message={totpError} onretry={() => void loadTotp()} />
						{:else if totpView === 'on'}
							<p class="line"><Status tone="good" label={t('settings.signin.totp_on')} /></p>
							<p class="form-hint">{t('settings.totp_enabled_desc')}</p>
							<p class="line">
								<Button variant="danger-quiet" onclick={startDisable}
									>{t('settings.signin.totp_turn_off')}</Button
								>
							</p>
						{:else if totpView === 'off'}
							<p class="line"><Status tone="neutral" label={t('settings.signin.totp_off')} /></p>
							<p class="form-hint">{t('settings.totp_disabled_desc')}</p>
							<p class="line">
								<Button
									id="totp-setup-btn"
									bind:element={setupBtn}
									busy={totpBusy}
									onclick={() => void startSetup()}>{t('settings.signin.totp_set_up')}</Button
								>
							</p>
							<p class="field-effect">{t('settings.signin.totp_effect')}</p>
						{:else if totpView === 'setup' && setup}
							<Steps items={[t('settings.totp_step1'), t('settings.totp_step2'), t('settings.totp_step3')]} />
							{#if qrSrc}<img
									src={qrSrc}
									alt={t('settings.signin.totp_qr_alt')}
									class="totp-qr-image"
									width="200"
									height="200"
								/>{/if}
							<div class="form-group">
								<span class="form-label">{t('settings.totp_manual_key')}</span>
								<ValueField value={setup.secret} label={t('settings.totp_manual_key')} />
							</div>
							<form class="totp-form" onsubmit={verifyCode} novalidate>
								<Field id="totp-setup-code" label={t('settings.totp_enter_code')} width="short">
									{#snippet children(f)}
										<Input
											{...f}
											bind:element={codeEl}
											bind:value={code}
											inputmode="numeric"
											pattern="[0-9]{6}"
											maxlength={6}
											autocomplete="one-time-code"
											oninput={() => (code = code.replace(/[^0-9]/g, ''))}
										/>
									{/snippet}
								</Field>
								<div class="inline-controls">
									<Button type="submit" variant="primary" busy={totpBusy}
										>{t('settings.signin.totp_verify')}</Button
									>
									<Button onclick={cancelTotp}>{t('actions.cancel')}</Button>
									<FormStatus message={codeStatus.message} tone={codeStatus.tone} />
								</div>
							</form>
						{:else if totpView === 'codes'}
							<p class="line"><Status tone="good" label={t('settings.totp_enabled_success')} /></p>
							<Notice tone="warning" message={t('settings.totp_recovery_warning')} />
							<div class="totp-recovery-codes">
								<CodeBlock code={codes.join('\n')} title={t('settings.signin.recovery_codes')} />
							</div>
							<p class="line">
								<Button variant="primary" onclick={() => void loadTotp()}
									>{t('settings.signin.recovery_saved')}</Button
								>
							</p>
						{:else if totpView === 'disable'}
							<form class="totp-form" onsubmit={confirmDisable} novalidate>
								<Notice tone="warning" message={t('settings.totp_disable_warning')} />
								<Field id="totp-disable-password" label={t('settings.current_password')}>
									{#snippet children(f)}
										<Input
											{...f}
											type="password"
											autocomplete="current-password"
											bind:element={disableEl}
											bind:value={disablePassword}
										/>
									{/snippet}
								</Field>
								<div class="inline-controls">
									<Button type="submit" variant="danger-quiet" busy={totpBusy}
										>{t('settings.signin.totp_turn_off')}</Button
									>
									<Button onclick={() => void loadTotp()}>{t('actions.cancel')}</Button>
									<FormStatus message={disableStatus.message} tone={disableStatus.tone} />
								</div>
							</form>
						{/if}
					</div>
				</div>
			{/snippet}
		</SettingsGrid>
	</section>

	{#if canConfig}
		<section class="section" aria-labelledby="for-everyone-title">
			<h2 id="for-everyone-title">{t('settings.signin.for_everyone')}</h2>
			<p class="section-note">{t('settings.signin.for_everyone_note')}</p>

			<SettingsGrid>
				{#snippet start()}
					<form
						id="enrollment-settings-section"
						class="form-column settings-subgroup"
						onsubmit={submitEnrollment}
						novalidate
					>
						<h3>{t('settings.enrollment_title')}</h3>
						<p class="form-hint">{t('settings.enrollment_desc')}</p>
						<ChoiceList
							name="settings_enrollment_mode"
							label={t('tokens.enrollment_mode')}
							bind:value={enrollment.values.mode}
							choices={[
								{ value: 'open', title: t('tokens.mode_open'), description: t('tokens.mode_open_desc') },
								{
									value: 'managed',
									title: t('tokens.mode_managed'),
									description: t('tokens.mode_managed_desc')
								},
								{ value: 'locked', title: t('tokens.mode_locked'), description: t('tokens.mode_locked_desc') }
							]}
						/>
						<Checkbox
							id="enrollment-rich-approve"
							label={t('settings.enrollment_rich_approve')}
							hint={t('settings.enrollment_rich_approve_hint')}
							bind:checked={enrollment.values.rich_approve}
						/>
						<Checkbox
							id="enrollment-tag-picker"
							label={t('settings.enrollment_tag_picker')}
							hint={t('settings.enrollment_tag_picker_hint')}
							bind:checked={enrollment.values.tag_picker}
						/>
						<p class="form-hint">
							{#if pendingCount > 0}<span id="enrollment-pending-hint"
									>{t('settings.enrollment_pending_count', { count: pendingCount })}</span
								>{/if}
							<a href={link('/registrations')}>{t('settings.enrollment_open_requests')}</a>
						</p>
						<p class="field-effect">{t('settings.signin.enrollment_effect')}</p>
						<SaveBar
							dirty={enrollment.dirty}
							busy={enrollment.busy}
							status={enrollment.status}
							label={t('settings.signin.enrollment_save')}
						/>
					</form>

					<form
						id="client-sessions-form"
						class="form-column settings-subgroup"
						onsubmit={sessions.onsubmit}
						novalidate
					>
						<h3 id="client-sessions-settings-section">{t('settings.client_sessions_title')}</h3>
						<p class="form-hint">{t('settings.client_sessions_desc')}</p>
						<Field
							id="client-sessions-expiry-days"
							label={t('settings.client_sessions_expiry_days')}
							hint={t('settings.client_sessions_expiry_hint')}
							width="short"
						>
							{#snippet children(f)}
								<Input {...f} type="number" min="1" max="365" bind:value={sessions.values.expiry_days} />
							{/snippet}
						</Field>
						<Checkbox
							id="client-sessions-sliding"
							label={t('settings.client_sessions_sliding')}
							hint={t('settings.client_sessions_sliding_hint')}
							bind:checked={sessions.values.sliding}
							{...showWhenControl('client-sessions-max-group', sessions.values.sliding)}
						/>
						<ShowWhen id="client-sessions-max-group" when={sessions.values.sliding}>
							<Field
								id="client-sessions-max-days"
								label={t('settings.client_sessions_max_days')}
								hint={t('settings.client_sessions_max_days_hint')}
								width="short"
							>
								{#snippet children(f)}
									<Input {...f} type="number" min="1" max="365" bind:value={sessions.values.max_days} />
								{/snippet}
							</Field>
						</ShowWhen>
						<p class="field-effect">{t('settings.signin.client_sessions_effect')}</p>
						<SaveBar
							dirty={sessions.dirty}
							busy={sessions.busy}
							status={sessions.status}
							label={t('settings.client_sessions_save')}
						/>
					</form>
				{/snippet}
				{#snippet end()}
					<form id="ldap-form" class="form-column settings-subgroup" onsubmit={submitLdap} novalidate>
						<h3 id="auth-panel-ldap">{t('settings.ldap_title')}</h3>
						<p class="form-hint">{t('settings.ldap_desc')}</p>
						<Checkbox
							id="ldap-enabled"
							label={t('settings.ldap_enabled')}
							hint={t('settings.signin.ldap_enabled_hint')}
							bind:checked={ldap.values.enabled}
							onchange={() => void onLdapEnabled()}
							{...showWhenControl('ldap-config-fields', ldap.values.enabled)}
						/>
						<ShowWhen id="ldap-config-fields" class="settings-subfields" when={ldap.values.enabled}>
							<h4>{t('settings.ldap_connection')}</h4>
							<Field id="ldap-host" label={t('settings.ldap_host')}>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										placeholder={EX.ldapHost}
										bind:value={ldap.values.host}
									/>{/snippet}
							</Field>
							<Field id="ldap-port" label={t('settings.ldap_port')} width="short">
								{#snippet children(f)}<Input
										{...f}
										type="number"
										min="1"
										max="65535"
										placeholder={EX.ldapPort}
										bind:value={ldap.values.port}
									/>{/snippet}
							</Field>
							<Checkbox
								id="ldap-use-tls"
								label={t('settings.ldap_use_tls')}
								bind:checked={ldap.values.use_tls}
								onchange={onLdapTls}
							/>
							<Checkbox
								id="ldap-start-tls"
								label={t('settings.ldap_start_tls')}
								bind:checked={ldap.values.start_tls}
							/>
							<Checkbox
								id="ldap-skip-tls-verify"
								label={t('settings.ldap_skip_verify')}
								bind:checked={ldap.values.skip_tls_verify}
							/>
							<Field
								id="ldap-conn-timeout"
								label={t('settings.ldap_timeout')}
								hint={t('settings.ldap_timeout_hint')}
								width="short"
							>
								{#snippet children(f)}<Input
										{...f}
										type="number"
										min="1"
										max="120"
										placeholder={EX.ldapTimeout}
										bind:value={ldap.values.conn_timeout_sec}
									/>{/snippet}
							</Field>

							<h4>{t('settings.ldap_bind_mode')}</h4>
							<Checkbox
								id="ldap-direct-bind"
								label={t('settings.ldap_direct_bind')}
								hint={t('settings.ldap_direct_bind_hint')}
								bind:checked={ldap.values.direct_bind}
								aria-controls="ldap-bind-search-fields ldap-direct-bind-fields"
							/>
							<ShowWhen id="ldap-bind-search-fields" class="when-off" when={!ldap.values.direct_bind}>
								<Field
									id="ldap-bind-dn"
									label={t('settings.ldap_bind_dn')}
									hint={t('settings.ldap_bind_dn_hint')}
								>
									{#snippet children(f)}<Input
											{...f}
											class="mono"
											placeholder={EX.bindDn}
											bind:value={ldap.values.bind_dn}
										/>{/snippet}
								</Field>
								<Field id="ldap-bind-password" label={t('settings.ldap_bind_password')}>
									{#snippet children(f)}<Input
											{...f}
											type="password"
											autocomplete="new-password"
											bind:value={ldap.values.bind_password}
										/>{/snippet}
								</Field>
								<Field
									id="ldap-base-dn"
									label={t('settings.ldap_base_dn')}
									hint={t('settings.ldap_base_dn_hint')}
								>
									{#snippet children(f)}<Input
											{...f}
											class="mono"
											placeholder={EX.baseDn}
											bind:value={ldap.values.base_dn}
										/>{/snippet}
								</Field>
								<Field
									id="ldap-user-filter"
									label={t('settings.ldap_user_filter')}
									hint={t('settings.ldap_user_filter_hint')}
								>
									{#snippet children(f)}<Input
											{...f}
											class="mono"
											placeholder={EX.userFilter}
											bind:value={ldap.values.user_filter}
										/>{/snippet}
								</Field>
							</ShowWhen>
							<ShowWhen id="ldap-direct-bind-fields" when={ldap.values.direct_bind}>
								<Field
									id="ldap-direct-bind-dn"
									label={t('settings.ldap_direct_bind_dn')}
									hint={t('settings.ldap_direct_bind_dn_hint')}
								>
									{#snippet children(f)}<Input
											{...f}
											class="mono"
											placeholder={EX.directBindDn}
											bind:value={ldap.values.direct_bind_dn}
										/>{/snippet}
								</Field>
							</ShowWhen>

							<div id="ldap-attrs">
								<Disclosure title={t('settings.ldap_user_attrs')} level={4}>
									<div class="disclosure-body">
										<p class="form-hint">{t('settings.signin.attrs_note')}</p>
										<Field id="ldap-user-attr-id" label={t('settings.ldap_attr_id')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.attrId}
													bind:value={ldap.values.user_attr_id}
												/>{/snippet}
										</Field>
										<Field id="ldap-user-attr-email" label={t('settings.ldap_attr_email')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.attrEmail}
													bind:value={ldap.values.user_attr_email}
												/>{/snippet}
										</Field>
										<Field id="ldap-user-attr-name" label={t('settings.ldap_attr_name')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.attrName}
													bind:value={ldap.values.user_attr_name}
												/>{/snippet}
										</Field>
									</div>
								</Disclosure>
							</div>

							<h4>{t('settings.ldap_group_mapping')}</h4>
							<Field
								id="ldap-group-base-dn"
								label={t('settings.ldap_group_base_dn')}
								hint={t('settings.ldap_group_base_dn_hint')}
							>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										placeholder={EX.groupBaseDn}
										bind:value={ldap.values.group_base_dn}
									/>{/snippet}
							</Field>
							<Field id="ldap-group-filter" label={t('settings.ldap_group_filter')}>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										placeholder={EX.groupFilter}
										bind:value={ldap.values.group_filter}
									/>{/snippet}
							</Field>
							<Field id="ldap-group-attr-name" label={t('settings.ldap_group_attr_name')} width="medium">
								{#snippet children(f)}<Input
										{...f}
										placeholder={EX.groupAttr}
										bind:value={ldap.values.group_attr_name}
									/>{/snippet}
							</Field>
							<Field
								id="ldap-default-role"
								label={t('settings.ldap_default_role')}
								hint={t('settings.ldap_default_role_hint')}
								width="medium"
							>
								{#snippet children(f)}<Select
										{...f}
										options={ROLES}
										bind:value={ldap.values.default_role}
									/>{/snippet}
							</Field>
							<Field
								id="ldap-group-role-map"
								label={t('settings.ldap_group_role_map')}
								hint={t('settings.ldap_group_role_map_hint')}
							>
								{#snippet children(f)}
									<Textarea
										{...f}
										class="mono"
										rows={4}
										placeholder={EX.ldapRoleMap}
										bind:value={ldap.values.group_role_map}
									/>
								{/snippet}
							</Field>
						</ShowWhen>
						<FormStatus message={ldapTest.message} tone={ldapTest.tone} class="test-result" />
						<p class="field-effect">{t('settings.signin.ldap_effect')}</p>
						<SaveBar dirty={ldap.dirty} busy={ldap.busy} status={ldap.status} label={t('settings.ldap_save')}>
							<Button id="ldap-test-btn" busy={ldapTesting} onclick={() => void runLdapTest()}
								>{ldapTesting ? t('settings.ldap_testing') : t('settings.ldap_test_connection')}</Button
							>
						</SaveBar>
					</form>

					<form id="oidc-form" class="form-column settings-subgroup" onsubmit={submitOidc} novalidate>
						<h3 id="auth-panel-oidc">{t('settings.oidc_title')}</h3>
						<p class="form-hint">{t('settings.oidc_desc')}</p>
						<Checkbox
							id="oidc-enabled"
							label={t('settings.oidc_enabled')}
							hint={t('settings.oidc_enabled_hint')}
							bind:checked={oidc.values.enabled}
							onchange={() => void onOidcEnabled()}
							{...showWhenControl('oidc-config-fields', oidc.values.enabled)}
						/>
						<ShowWhen id="oidc-config-fields" class="settings-subfields" when={oidc.values.enabled}>
							<h4>{t('settings.oidc_provider')}</h4>
							<Field
								id="oidc-display-name"
								label={t('settings.oidc_display_name')}
								hint={t('settings.oidc_display_name_hint')}
								width="medium"
							>
								{#snippet children(f)}<Input
										{...f}
										placeholder={EX.oidcName}
										bind:value={oidc.values.display_name}
									/>{/snippet}
							</Field>
							<Field
								id="oidc-issuer-url"
								label={t('settings.oidc_issuer_url')}
								hint={t('settings.oidc_issuer_url_hint')}
							>
								{#snippet children(f)}<Input
										{...f}
										type="url"
										class="mono"
										bind:element={issuerEl}
										placeholder={EX.issuer}
										bind:value={oidc.values.issuer_url}
									/>{/snippet}
							</Field>
							<Field
								id="oidc-allowed-private-cidrs"
								label={t('settings.oidc_allowed_private_cidrs')}
								hint={t('settings.oidc_allowed_private_cidrs_hint')}
							>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										placeholder={EX.cidrs}
										bind:value={oidc.values.allowed_private_cidrs}
									/>{/snippet}
							</Field>
							<Field id="oidc-client-id" label={t('settings.oidc_client_id')}>
								{#snippet children(f)}<Input
										{...f}
										class="mono"
										autocomplete="off"
										bind:value={oidc.values.client_id}
									/>{/snippet}
							</Field>
							<Field id="oidc-client-secret" label={t('settings.oidc_client_secret')}>
								{#snippet children(f)}<Input
										{...f}
										type="password"
										autocomplete="new-password"
										bind:value={oidc.values.client_secret}
									/>{/snippet}
							</Field>
							<Field
								id="oidc-redirect-url"
								label={t('settings.oidc_redirect_url')}
								hint={t('settings.oidc_redirect_url_hint')}
								error={oidc.errors.redirect_url}
							>
								{#snippet children(f)}
									<Input
										{...f}
										type="url"
										class="mono"
										placeholder={EX.redirect}
										bind:value={oidc.values.redirect_url}
									/>
									{#if redirectWarning && !oidc.errors.redirect_url}<Notice
											tone="warning"
											role="status"
											id="oidc-redirect-url-warning"
											message={redirectWarning}
										/>{/if}
								{/snippet}
							</Field>
							<Field
								id="oidc-panel-url"
								label={t('settings.oidc_panel_url')}
								hint={t('settings.oidc_panel_url_hint')}
							>
								{#snippet children(f)}<Input
										{...f}
										type="url"
										class="mono"
										placeholder={EX.panel}
										bind:value={oidc.values.panel_url}
									/>{/snippet}
							</Field>
							<Field id="oidc-scopes" label={t('settings.oidc_scopes')}>
								{#snippet children(f)}<Input
										{...f}
										placeholder={EX.scopes}
										bind:value={oidc.values.scopes}
									/>{/snippet}
							</Field>
							<Checkbox
								id="oidc-use-pkce"
								label={t('settings.oidc_use_pkce')}
								bind:checked={oidc.values.use_pkce}
							/>
							<Checkbox
								id="oidc-auto-discovery"
								label={t('settings.oidc_auto_discovery')}
								bind:checked={oidc.values.auto_discovery}
								aria-controls="oidc-manual-endpoints"
							/>
							<Checkbox
								id="oidc-allow-signup"
								label={t('settings.oidc_allow_signup')}
								bind:checked={oidc.values.allow_signup}
							/>
							<Checkbox
								id="oidc-prefer-sso"
								label={t('settings.oidc_prefer_sso')}
								hint={t('settings.oidc_prefer_sso_hint')}
								bind:checked={oidc.values.prefer_sso}
							/>

							<ShowWhen id="oidc-manual-endpoints" class="when-off" when={!oidc.values.auto_discovery}>
								<h4>{t('settings.oidc_manual_endpoints')}</h4>
								<Field id="oidc-authorization-url" label={t('settings.oidc_authorization_url')}>
									{#snippet children(f)}<Input
											{...f}
											type="url"
											class="mono"
											placeholder={EX.authUrl}
											bind:value={oidc.values.authorization_url}
										/>{/snippet}
								</Field>
								<Field id="oidc-token-url" label={t('settings.oidc_token_url')}>
									{#snippet children(f)}<Input
											{...f}
											type="url"
											class="mono"
											placeholder={EX.tokenUrl}
											bind:value={oidc.values.token_url}
										/>{/snippet}
								</Field>
								<Field id="oidc-userinfo-url" label={t('settings.oidc_userinfo_url')}>
									{#snippet children(f)}<Input
											{...f}
											type="url"
											class="mono"
											placeholder={EX.userinfoUrl}
											bind:value={oidc.values.userinfo_url}
										/>{/snippet}
								</Field>
							</ShowWhen>

							<div id="oidc-claims">
								<Disclosure title={t('settings.oidc_claim_mapping')} level={4}>
									<div class="disclosure-body">
										<p class="form-hint">{t('settings.signin.attrs_note')}</p>
										<Field id="oidc-claim-username" label={t('settings.oidc_claim_username')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.claimUser}
													bind:value={oidc.values.claim_username}
												/>{/snippet}
										</Field>
										<Field id="oidc-claim-email" label={t('settings.oidc_claim_email')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.claimEmail}
													bind:value={oidc.values.claim_email}
												/>{/snippet}
										</Field>
										<Field id="oidc-claim-name" label={t('settings.oidc_claim_name')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.claimName}
													bind:value={oidc.values.claim_name}
												/>{/snippet}
										</Field>
										<Field id="oidc-claim-groups" label={t('settings.oidc_claim_groups')} width="medium">
											{#snippet children(f)}<Input
													{...f}
													placeholder={EX.claimGroups}
													bind:value={oidc.values.claim_groups}
												/>{/snippet}
										</Field>
									</div>
								</Disclosure>
							</div>

							<h4>{t('settings.oidc_role_mapping')}</h4>
							<Field id="oidc-default-role" label={t('settings.oidc_default_role')} width="medium">
								{#snippet children(f)}<Select
										{...f}
										options={ROLES}
										bind:value={oidc.values.default_role}
									/>{/snippet}
							</Field>
							<Field
								id="oidc-group-role-map"
								label={t('settings.oidc_group_role_map')}
								hint={t('settings.oidc_group_role_map_hint')}
							>
								{#snippet children(f)}
									<Textarea
										{...f}
										class="mono"
										rows={3}
										placeholder={EX.oidcRoleMap}
										bind:value={oidc.values.group_role_map}
									/>
								{/snippet}
							</Field>
						</ShowWhen>
						<FormStatus message={oidcTest.message} tone={oidcTest.tone} class="test-result" />
						<p class="field-effect">{t('settings.signin.oidc_effect')}</p>
						<SaveBar dirty={oidc.dirty} busy={oidc.busy} status={oidc.status} label={t('settings.oidc_save')}>
							<Button id="oidc-test-btn" busy={oidcTesting} onclick={() => void runOidcTest()}
								>{oidcTesting ? t('settings.oidc_testing') : t('settings.oidc_test_discovery')}</Button
							>
						</SaveBar>
					</form>
				{/snippet}
			</SettingsGrid>
		</section>
	{/if}
</SettingsLayout>

<style>
	.form-column {
		max-width: var(--measure);
	}
	.settings-subgroup {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.settings-subgroup > :global(.form-group),
	.settings-subgroup :global(.settings-subfields > .form-group) {
		margin-bottom: 0;
	}
	.settings-subgroup :global(.settings-subfields) {
		gap: var(--space-3);
	}
	.settings-subgroup :global(.show-when .show-when) {
		margin-bottom: 0;
	}
	h3 {
		margin: 0;
		font-size: var(--text-md);
	}
	h4 {
		margin: var(--space-3) 0 0;
		font-size: var(--text-base, 1rem);
	}
	.form-hint,
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.settings-subgroup :global(.test-result:empty) {
		display: none;
	}
	.disclosure-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) 0 var(--space-2);
	}
	.disclosure-body > :global(.form-group) {
		margin-bottom: 0;
	}
	/* Password rules: ticked off as they are met */
	.password-requirements ul {
		margin: var(--space-1) 0 0;
		padding: 0;
		list-style: none;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.password-requirements li::before {
		content: '–';
		display: inline-block;
		width: 1.25em;
	}
	.password-requirements li.valid {
		color: var(--success);
	}
	.password-requirements li.valid::before {
		content: '✓';
	}
	.totp {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.totp-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.totp-form > :global(.form-group) {
		margin: 0;
	}
	.line {
		margin: 0;
	}
	.totp-qr-image {
		display: block;
		width: 200px;
		height: 200px;
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: #ffffff;
	}
	.totp-recovery-codes {
		max-width: 32ch;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.form-label {
		font-weight: 600;
	}
	.inline-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
</style>
