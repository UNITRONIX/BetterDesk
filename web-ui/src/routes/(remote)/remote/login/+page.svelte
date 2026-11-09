<!--
  Sign-in of the remote client (/remote/login), for the desktop app and for
  remote pages whose session ended: user name and password, then the
  authenticator code when the account has one. Afterwards to ?return= when
  it is a path under /remote, else /remote. Someone already signed in with
  device.connect goes straight on. "Remember me" starts off (DECISIONS S5);
  a remembered password is kept encrypted in this browser
  (secure-store.ts).
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { setCsrfToken } from '#lib/api/client.ts';
	import { getLoginInfo, signIn, verifyTotp, type PageInfo } from '#lib/api/remote.ts';
	import { i18n, tf } from '#lib/i18n/i18n.svelte.ts';
	import { base, link } from '#lib/nav.ts';
	import { setLanguages } from '#lib/remote/boot.ts';
	import { safeRemoteReturn, splitBase, totpDigits } from '#lib/remote/login.ts';
	import { secureStore } from '#lib/remote/secure-store.ts';
	import LanguageSelect from '#lib/remote/LanguageSelect.svelte';
	import RemoteBrand from '#lib/remote/RemoteBrand.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import LangFlag from '#lib/ui/LangFlag.svelte';
	import Notice from '#lib/ui/Notice.svelte';

	const uid = $props.id();
	let info = $state.raw<PageInfo | null>(null);
	let target = $state('');
	let step = $state<'password' | 'totp'>('password');
	let username = $state('');
	let password = $state('');
	let remember = $state(false);
	let showPassword = $state(false);
	let code = $state('');
	let error = $state('');
	let totpError = $state('');
	let busy = $state(false);
	let userInput = $state<HTMLInputElement | null>(null);
	let codeInput = $state<HTMLInputElement | null>(null);
	let loadFailed = $state(false);

	function go() {
		location.assign(target || link('/remote'));
	}

	async function load() {
		loadFailed = false;
		const q = new URLSearchParams(location.search);
		const { path, underBase } = splitBase(q.get('return') ?? '', base);
		try {
			const out = await getLoginInfo(path);
			info = out;
			setCsrfToken(out.csrfToken);
			setLanguages(out.languages);
			const next = safeRemoteReturn(out.returnUrl) ?? '/remote';
			target = underBase ? base + next : link(next);
			if (out.signedIn) return go();
		} catch {
			loadFailed = true;
			return;
		}
		if (q.get('expired') === '1' || q.get('expired') === 'true')
			error = tf('rdclient_login.session_expired', 'Session expired. Please sign in again.');
		try {
			const creds = await secureStore().loadCredentials();
			if (creds.username) username = creds.username;
			if (creds.password) {
				password = creds.password;
				remember = true;
			}
		} catch {
			/* nothing remembered */
		}
		await tick();
		userInput?.focus();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		const name = username.trim();
		if (!name || !password) {
			error = tf('rdclient_login.fill_all_fields', 'Please fill in all fields');
			return;
		}
		busy = true;
		error = '';
		try {
			const out = await signIn(name, password);
			if (out.success && out.totpRequired) {
				step = 'totp';
				code = '';
				totpError = '';
				await tick();
				codeInput?.focus();
				return;
			}
			if (out.success) {
				await secureStore()
					.saveCredentials(name, password, remember)
					.catch(() => {});
				return go();
			}
			error = out.error || tf('rdclient_login.invalid_credentials', 'Invalid credentials');
		} catch {
			error = tf('rdclient_login.network_error', 'Network error');
		} finally {
			busy = false;
		}
	}

	async function submitCode() {
		if (busy) return;
		if (code.length !== 6) {
			totpError = tf('rdclient_login.enter_6_digits', 'Enter all 6 digits');
			return;
		}
		busy = true;
		totpError = '';
		try {
			const out = await verifyTotp(code);
			if (out.success) {
				await secureStore()
					.saveCredentials(username.trim(), password, remember)
					.catch(() => {});
				return go();
			}
			totpError = out.error || tf('rdclient_login.invalid_code', 'Invalid code');
			code = '';
			codeInput?.focus();
		} catch {
			totpError = tf('rdclient_login.network_error', 'Network error');
		} finally {
			busy = false;
		}
	}

	function onCode(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		code = totpDigits(el.value);
		if (el.value !== code) el.value = code;
		if (code.length === 6) void submitCode();
	}

	async function backToPassword(e: MouseEvent) {
		e.preventDefault();
		step = 'password';
		code = '';
		totpError = '';
		await tick();
		userInput?.focus();
	}

	onMount(() => void load());
</script>

<svelte:head>
	<title>{tf('rdclient_login.title', 'Sign in to remote desktop')} - {info?.appName ?? 'BetterDesk'}</title>
</svelte:head>

<main class="login-main">
	<div class="login-box">
		<div class="login-brand">
			<RemoteBrand appName={info?.appName ?? 'BetterDesk'} branding={info?.branding ?? null} />
		</div>

		<h1 class="login-title">{tf('rdclient_login.title', 'Sign in to remote desktop')}</h1>
		<p class="login-subtitle">{tf('rdclient_login.subtitle', 'Use your BetterDesk console account.')}</p>

		{#if loadFailed}
			<Notice tone="danger" message={tf('shell.start_failed', 'The console could not start.')} />
			<Button onclick={() => void load()}>{tf('errors.try_again', 'Try again')}</Button>
		{:else if step === 'password'}
			<form class="login-form" onsubmit={submit} novalidate>
				{#if error}<Notice tone="danger" role="alert" message={error} />{/if}
				<div class="field">
					<label class="field-label" for="{uid}-user"
						>{tf('rdclient_login.username_placeholder', 'Username')}</label
					>
					<input
						bind:this={userInput}
						id="{uid}-user"
						class="form-input"
						type="text"
						autocomplete="username"
						autocapitalize="none"
						spellcheck="false"
						required
						bind:value={username}
					/>
				</div>
				<div class="field">
					<label class="field-label" for="{uid}-pw"
						>{tf('rdclient_login.password_placeholder', 'Password')}</label
					>
					<span class="password-wrap">
						<input
							id="{uid}-pw"
							class="form-input"
							type={showPassword ? 'text' : 'password'}
							autocomplete="current-password"
							required
							bind:value={password}
						/>
						<IconButton
							class="password-toggle"
							icon={showPassword ? 'visibility_off' : 'visibility'}
							label={tf('auth.show_password', 'Show password')}
							aria-pressed={showPassword}
							onclick={() => (showPassword = !showPassword)}
						/>
					</span>
				</div>
				<Checkbox label={tf('rdclient_login.remember_me', 'Remember me')} bind:checked={remember} />
				<Button type="submit" variant="primary" block {busy}>{tf('rdclient_login.sign_in', 'Sign in')}</Button
				>
			</form>
		{:else}
			<form
				class="login-form"
				novalidate
				onsubmit={(e) => {
					e.preventDefault();
					void submitCode();
				}}
			>
				<div class="totp-head">
					<h2>{tf('rdclient_login.totp_title', 'Two-factor authentication')}</h2>
					<p class="login-subtitle">
						{tf('rdclient_login.totp_subtitle', 'Enter the 6-digit code from your authenticator app.')}
					</p>
				</div>
				{#if totpError}<Notice tone="danger" role="alert" message={totpError} />{/if}
				<div class="field">
					<label class="field-label" for="{uid}-code">{tf('auth.totp_code', 'Authentication code')}</label>
					<input
						bind:this={codeInput}
						id="{uid}-code"
						class="form-input totp-input"
						type="text"
						autocomplete="one-time-code"
						inputmode="numeric"
						pattern="[0-9]{6}"
						maxlength="6"
						required
						value={code}
						oninput={onCode}
					/>
				</div>
				<Button type="submit" variant="primary" block {busy}>{tf('rdclient_login.verify', 'Verify')}</Button>
				<p class="totp-links">
					<a href="#back" onclick={backToPassword}>{tf('rdclient_login.back_to_login', 'Back to sign in')}</a>
				</p>
			</form>
		{/if}

		<div class="login-footer">
			<a href="/login" class="console-link"
				>{tf('rdclient_login.open_console_login', 'Open the console sign-in')}</a
			>
			{#if i18n.available.length > 1}
				<span class="lang-row"><LangFlag code={i18n.lang} /><LanguageSelect /></span>
			{/if}
			{#if info}<p class="version">{info.appName} {info.appVersion}</p>{/if}
		</div>
	</div>
</main>

<style>
	.login-main {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		min-height: 100vh;
		min-height: 100dvh;
		padding: 12vh var(--space-4) var(--space-6);
		background: var(--bg);
	}
	.login-box {
		width: 100%;
		max-width: 340px;
	}
	.login-brand {
		margin-bottom: var(--space-6);
	}
	.login-brand :global(.brand-logo-full) {
		height: 28px;
	}
	.login-title {
		margin: 0 0 var(--space-2);
		font-size: var(--text-lg);
	}
	.login-subtitle {
		margin: 0;
		color: var(--text-muted);
	}
	.login-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.field-label {
		font-weight: 600;
	}
	.form-input {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--control-h);
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.form-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.password-wrap {
		position: relative;
		display: block;
	}
	.password-wrap .form-input {
		padding-inline-end: calc(var(--icon-btn-size) + var(--space-2));
	}
	.password-wrap :global(.password-toggle) {
		position: absolute;
		top: 50%;
		inset-inline-end: 2px;
		transform: translateY(-50%);
	}
	.totp-head h2 {
		margin: 0 0 var(--space-1);
		font-size: var(--text-md);
	}
	.totp-input {
		font-size: var(--text-md);
		letter-spacing: 0.2em;
	}
	.totp-links {
		margin: 0;
	}
	.login-footer {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin-top: var(--space-6);
		padding-top: var(--space-4);
		border-top: 1px solid var(--rule);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.lang-row {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.version {
		margin: 0;
	}
	@media (pointer: coarse) {
		.console-link,
		.totp-links a {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
	@media (max-width: 640px) {
		.login-main {
			padding-top: var(--space-6);
		}
	}
</style>
