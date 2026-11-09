<!--
  The sign-in page (views/login.ejs, desktop-login.ejs, public/js/login.js,
  desktop-login.js). One form for password and directory (LDAP) accounts:
  the server decides which; a second step for the two-factor code or a
  recovery code; single sign-on (OIDC) below when it is on, and started
  right away when the admin prefers it (not with ?autoLaunch=0). After
  sign-in the browser goes to ?return= when it is a console path (R3).

  ?desktop=1 (or the old desktop mode's cookie) is the compact sign-in:
  no promo panel, no single sign-on, no "Remember me". It no longer lists
  the server's accounts (S4); the browser's saved sign-ins fill the
  username.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { setCsrfToken } from '#lib/api/client.ts';
	import { saveLanguage } from '#lib/api/console.ts';
	import {
		getLoginPage,
		getOidcStatus,
		oidcStartUrl,
		signIn,
		verifyTotp,
		type LoginPage,
		type OidcStatus
	} from '#lib/api/signin.ts';
	import { i18n, switchLanguage, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import LangFlag from '#lib/ui/LangFlag.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Select from '#lib/ui/Select.svelte';
	import AttestBadge from './AttestBadge.svelte';
	import LoginBrand from './LoginBrand.svelte';
	import PromoPanel from './PromoPanel.svelte';
	import { clientFingerprint } from './fingerprint.ts';
	import { autoStartsSso, codeDigits, oidcErrorText, signInErrorText, type LoginQuery } from './login.ts';
	import { safeReturnPath } from './returnUrl.ts';

	interface Props {
		page: LoginPage;
		query: LoginQuery;
		/** Leave the page (tests pass their own) */
		go?: (url: string, replace?: boolean) => void;
	}

	let {
		page = $bindable(),
		query,
		go = (url, replace) => (replace ? location.replace(url) : location.assign(url))
	}: Props = $props();

	const uid = $props.id();
	/** How a recovery code looks; a format, not text to translate */
	const RECOVERY_FORMAT = 'XXXX-XXXX';
	const compact = $derived(query.desktop || page.desktopMode);
	const mode = $derived(compact ? 'classic' : page.branding.loginPromoMode);

	let step = $state<'password' | 'totp'>('password');
	let useRecovery = $state(false);
	let username = $state('');
	let password = $state('');
	let remember = $state(false);
	let shown = $state(false);
	let code = $state('');
	let recovery = $state('');
	let busy = $state(false);
	let error = $state('');
	let missing = $state<'username' | 'password' | 'code' | null>(null);
	let oidc = $state<OidcStatus | null>(null);
	/** Off to the identity provider ("Prefer SSO"): the form is hidden meanwhile */
	let leaving = $state(false);
	let languageError = $state('');
	let chosen = $state(i18n.lang);

	let usernameInput = $state<HTMLInputElement | null>(null);
	let passwordInput = $state<HTMLInputElement | null>(null);
	let codeInput = $state<HTMLInputElement | null>(null);
	let recoveryInput = $state<HTMLInputElement | null>(null);

	const fingerprint = clientFingerprint();
	const ssoHref = $derived(oidcStartUrl(query.returnPath));
	const ssoLabel = $derived(
		oidc?.display_name ? t('auth.login_sso_with', { provider: oidc.display_name }) : t('auth.login_sso')
	);
	const languageOptions = $derived(
		page.languages.map((l) => ({ value: l.code, label: l.native || l.name || l.code }))
	);

	// The old page's body classes: /css/branding.css paints the sign-in wallpaper and the promo picture through them
	$effect(() => {
		const classes = ['login-page', compact ? 'desktop-login' : `login-layout-${mode}`];
		document.body.classList.add(...classes);
		return () => document.body.classList.remove(...classes);
	});

	onMount(() => {
		if (query.oidcError) error = oidcErrorText(query.oidcError);
		// The old page's autofocus: the username first
		usernameInput?.focus();
		if (compact) return;
		const ctrl = new AbortController();
		getOidcStatus(ctrl.signal)
			.then((status) => {
				oidc = status;
				if (autoStartsSso(status, query)) {
					leaving = true;
					go(oidcStartUrl(query.returnPath), true);
				}
			})
			.catch(() => {
				/* No single sign-on button; the password form works without it */
			});
		return () => ctrl.abort();
	});

	function done(redirect: string | undefined) {
		// The server checked ?return= too; the page follows only a path it also accepts
		go(safeReturnPath(redirect) ?? query.returnPath ?? '/');
	}

	async function submitPassword(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		error = '';
		const name = username.trim();
		missing = !name ? 'username' : !password ? 'password' : null;
		if (missing) {
			error = compact ? t('desktop_login.fill_all_fields') : t('auth.fill_all_fields');
			(missing === 'username' ? usernameInput : passwordInput)?.focus();
			return;
		}
		busy = true;
		try {
			const res = await signIn({
				username: name,
				password,
				...(compact ? {} : { remember }),
				clientFingerprint: fingerprint,
				...(query.returnPath ? { return: query.returnPath } : {})
			});
			if (res.totpRequired) {
				busy = false;
				await showTotp();
				return;
			}
			done(res.redirect);
		} catch (err) {
			busy = false;
			error = signInErrorText(err, 'auth.login_failed');
			await tick();
			passwordInput?.select();
			passwordInput?.focus();
		}
	}

	async function showTotp() {
		step = 'totp';
		useRecovery = false;
		code = '';
		recovery = '';
		error = '';
		missing = null;
		await tick();
		codeInput?.focus();
	}

	async function backToPassword() {
		step = 'password';
		code = '';
		recovery = '';
		error = '';
		missing = null;
		await tick();
		passwordInput?.focus();
	}

	async function toggleRecovery() {
		useRecovery = !useRecovery;
		error = '';
		missing = null;
		await tick();
		(useRecovery ? recoveryInput : codeInput)?.focus();
	}

	async function submitTotp(e?: SubmitEvent) {
		e?.preventDefault();
		if (busy) return;
		error = '';
		const value = useRecovery ? recovery.trim() : codeDigits(code);
		if (useRecovery ? !value : value.length !== 6) {
			missing = 'code';
			error = useRecovery ? t('auth.totp_enter_recovery') : t('auth.totp_enter_code');
			(useRecovery ? recoveryInput : codeInput)?.focus();
			return;
		}
		missing = null;
		busy = true;
		try {
			const res = await verifyTotp({
				...(useRecovery ? { recoveryCode: value } : { code: value }),
				clientFingerprint: fingerprint,
				...(query.returnPath ? { return: query.returnPath } : {})
			});
			done(res.redirect);
		} catch (err) {
			busy = false;
			error = signInErrorText(err, 'auth.totp_invalid_code');
			if (!useRecovery) code = '';
			await tick();
			(useRecovery ? recoveryInput : codeInput)?.focus();
		}
	}

	// Digits only; the sixth one sends the code (typed or pasted)
	function oncodeinput(e: Event) {
		const digits = codeDigits((e.currentTarget as HTMLInputElement).value);
		if (digits !== code) code = digits;
		if (digits.length === 6) void submitTotp();
	}

	async function changeLanguage(next: string) {
		if (!next || next === i18n.lang) return;
		languageError = '';
		try {
			await switchLanguage(next, saveLanguage);
			// The badge's tier names come translated from the server
			const fresh = await getLoginPage();
			setCsrfToken(fresh.csrfToken);
			page = fresh;
		} catch {
			// The strings switched but the page's own values didn't reload: nothing to say
			if (i18n.lang !== next) languageError = t('errors.language_change_failed');
		} finally {
			chosen = i18n.lang;
		}
	}
</script>

<svelte:head>
	<title>{t('auth.login_title')} - {page.appName}</title>
</svelte:head>

<div class={['login-root', compact && 'is-compact']}>
	{#if !compact && (mode === 'single' || mode === 'slides')}
		<PromoPanel {mode} slides={page.branding.loginSlides} />
	{/if}

	<main class="login-main">
		<div class="login-box">
			<LoginBrand branding={page.branding} appName={page.appName} />

			<h1 class="login-title">
				{compact ? t('auth.login_title') : page.branding.loginTitle || t('auth.login_title')}
			</h1>
			{#if !compact && page.branding.loginSubtitle}
				<p class="login-subtitle">{page.branding.loginSubtitle}</p>
			{/if}

			{#if query.expired && !error}
				<Notice class="login-notice" role="status" message={t('auth.session_expired')} />
			{/if}
			{#if error}
				<Notice class="login-notice" tone="danger" role="alert" message={error} />
			{/if}

			{#if leaving}
				<p class="login-leaving" role="status">
					{tf('auth.sso_redirecting', 'Opening the sign-in of your organisation…')}
				</p>
			{:else if step === 'password'}
				<form class="login-form" novalidate onsubmit={submitPassword}>
					<Field label={t('auth.username')} id="username">
						{#snippet children(f)}
							<Input
								{...f}
								invalid={missing === 'username'}
								name="username"
								autocomplete="username"
								autocapitalize="none"
								spellcheck="false"
								required
								bind:value={username}
								bind:element={usernameInput}
							/>
						{/snippet}
					</Field>
					<Field label={t('auth.password')} id="password">
						{#snippet children(f)}
							<div class="password-wrapper">
								<Input
									{...f}
									invalid={missing === 'password'}
									type={shown ? 'text' : 'password'}
									name="password"
									autocomplete="current-password"
									required
									bind:value={password}
									bind:element={passwordInput}
								/>
								<Button
									class="password-toggle"
									size="sm"
									variant="ghost"
									aria-pressed={shown}
									aria-label={t('auth.show_password')}
									aria-controls="password"
									onclick={() => (shown = !shown)}
									>{shown ? t('actions.hide_value') : t('actions.show_value')}</Button
								>
							</div>
						{/snippet}
					</Field>
					{#if !compact}
						<Checkbox
							inline
							class="remember-me"
							label={t('auth.remember_me')}
							name="remember"
							bind:checked={remember}
						/>
					{/if}
					<Button type="submit" variant="primary" block {busy}>{t('auth.login')}</Button>
				</form>

				{#if !compact && oidc?.enabled}
					<div class="login-sso">
						<p class="login-divider"><span>{t('auth.or')}</span></p>
						<Button href={ssoHref} block>{ssoLabel}</Button>
					</div>
				{/if}
			{:else}
				<form class="login-form" novalidate onsubmit={submitTotp}>
					<div class="totp-header">
						<h2 class="totp-title">{t('auth.totp_title')}</h2>
						<p class="totp-subtitle" id="{uid}-totp-sub">{t('auth.totp_subtitle')}</p>
					</div>
					{#if useRecovery}
						<Field label={t('auth.totp_recovery_code')} id="recovery-code">
							{#snippet children(f)}
								<Input
									{...f}
									invalid={missing === 'code'}
									class="mono"
									placeholder={RECOVERY_FORMAT}
									autocomplete="off"
									spellcheck="false"
									maxlength={9}
									bind:value={recovery}
									bind:element={recoveryInput}
								/>
							{/snippet}
						</Field>
					{:else}
						<Field label={t('auth.totp_code')} id="totp-code">
							{#snippet children(f)}
								<Input
									{...f}
									describedby={[f.describedby, `${uid}-totp-sub`].filter(Boolean).join(' ')}
									invalid={missing === 'code'}
									class="totp-input"
									inputmode="numeric"
									autocomplete="one-time-code"
									pattern="[0-9]{6}"
									maxlength={6}
									bind:value={code}
									bind:element={codeInput}
									oninput={oncodeinput}
								/>
							{/snippet}
						</Field>
					{/if}
					<Button type="submit" variant="primary" block {busy}>{t('auth.totp_verify')}</Button>
					<p class="totp-links">
						<Button variant="link" onclick={() => void toggleRecovery()}
							>{useRecovery ? t('auth.totp_use_code') : t('auth.totp_use_recovery')}</Button
						>
						<Button variant="link" onclick={() => void backToPassword()}
							>{t('auth.totp_back_to_login')}</Button
						>
					</p>
				</form>
			{/if}

			<footer class="login-footer">
				<div class="login-language-picker">
					<label for="{uid}-lang">{t('settings.language')}</label>
					<LangFlag code={i18n.lang} />
					<Select
						id="{uid}-lang"
						small
						options={languageOptions}
						bind:value={chosen}
						onchange={() => void changeLanguage(chosen ?? '')}
					/>
				</div>
				{#if languageError}<p class="login-language-error" role="alert">{languageError}</p>{/if}
				{#if !compact && page.branding.footerText}
					<p class="login-footer-custom">{page.branding.footerText}</p>
				{/if}
				{#if compact || page.branding.showPoweredBy}
					<p class="login-version">{page.appName} {page.appVersion}</p>
				{/if}
			</footer>

			{#if page.attestation}
				<AttestBadge badge={page.attestation} appName={page.appName} />
			{/if}
		</div>
	</main>
</div>

<style>
	.login-root {
		display: flex;
		min-height: 100vh;
		min-height: 100dvh;
	}
	.login-main {
		display: flex;
		flex: 1;
		align-items: flex-start;
		justify-content: center;
		padding: 12vh var(--space-4) var(--space-6);
	}
	.login-box {
		width: 100%;
		max-width: 340px;
	}
	.login-title {
		margin-bottom: var(--space-4);
		font-size: var(--text-lg);
	}
	.login-title:has(+ .login-subtitle) {
		margin-bottom: var(--space-2);
	}
	.login-subtitle {
		margin-bottom: var(--space-4);
		color: var(--text-muted);
	}
	.login-box > :global(.login-notice) {
		margin-bottom: var(--space-4);
	}
	.login-leaving {
		color: var(--text-muted);
	}
	.login-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.login-form > :global(.form-group) {
		margin: 0;
	}
	/* The Show button sits inside the field's end, as high as the field */
	.password-wrapper {
		position: relative;
		display: flex;
	}
	.password-wrapper > :global(.form-input) {
		padding-inline-end: calc(var(--space-2) + 7ch);
	}
	/* As high as the field, so it is a full touch target (44 px on touch screens) */
	.password-wrapper > :global(.password-toggle) {
		position: absolute;
		top: 0;
		bottom: 0;
		inset-inline-end: 0;
		min-height: 0;
		height: auto;
	}
	.login-divider {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: var(--space-4) 0;
		color: var(--text-muted);
	}
	.login-divider::before,
	.login-divider::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--rule);
	}
	.totp-title {
		margin-bottom: var(--space-1);
		font-size: var(--text-md);
	}
	.totp-subtitle {
		color: var(--text-muted);
	}
	.login-form :global(.totp-input) {
		font-size: var(--text-md);
		letter-spacing: 0.2em;
	}
	.totp-links {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
	}
	/* Text links that are buttons: a 44 px target on touch screens */
	@media (pointer: coarse) {
		.totp-links > :global(.btn) {
			min-height: 44px;
		}
	}
	.login-footer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-6);
		padding-top: var(--space-4);
		border-top: 1px solid var(--rule);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.login-language-picker {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.login-language-picker > :global(.form-select) {
		width: auto;
	}
	.login-language-error {
		color: var(--danger);
	}
	@media (max-width: 640px) {
		.login-main {
			padding-top: var(--space-6);
		}
	}
</style>
