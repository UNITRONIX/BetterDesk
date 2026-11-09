<!--
  One session tab's panel: the remote screen (canvas) and, over it, the
  state screen while there is no picture. Every state starts at the same
  height from the top, so switching states or opening Details only grows
  the block downward (usability/remote-viewer.md). The letterbox around the
  picture stays black in both themes; the states use the page background.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { showDetails, stepRows, type View } from '#lib/remote/states.ts';
	import { isRemoteTargetId } from '#lib/remote/access.ts';
	import Button from '#lib/ui/Button.svelte';
	import LinkButton from '#lib/remote/LinkButton.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { copyText } from '#lib/ui/clipboard.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import type { Viewer, ViewerSession } from '#lib/remote/viewer.svelte.ts';

	let { viewer, session: s, active }: { viewer: Viewer; session: ViewerSession; active: boolean } = $props();

	const uid = $props.id();
	let canvas = $state<HTMLCanvasElement | null>(null);
	let passwordInput = $state<HTMLInputElement | null>(null);
	let tfaInput = $state<HTMLInputElement | null>(null);
	let reconnectBtn = $state<HTMLElement | null>(null);
	let summaryInput = $state<HTMLTextAreaElement | null>(null);
	let detailsOpen = $state(false);

	const name = $derived(s.label);
	const view = $derived<View>(s.view);
	const overState = $derived(view === 'connecting' || view === 'failed' || view === 'ended');
	const result = $derived(view === 'failed' || view === 'ended');
	const steps = $derived(stepRows(s.stepId, view === 'failed', name, viewer.transport));
	const rows = $derived(result ? viewer.details(s) : []);
	const hasMessage = $derived(!!(s.endInfo?.reason || s.lastError));
	const detailsShown = $derived(showDetails(view, hasMessage, s.endedBy));
	const openDevice = $derived(!viewer.guest && !isRemoteTargetId(s.deviceId));
	const title = $derived(
		view === 'failed'
			? tf('remote_viewer.title_failed', 'Could not connect')
			: view === 'ended'
				? tf('remote_viewer.title_ended', 'Session ended')
				: tf('remote_viewer.title_connecting', 'Connecting')
	);

	onMount(() => {
		s.focus = {
			canvas: () => canvas?.focus({ preventScroll: true }),
			password: () => passwordInput?.focus(),
			tfa: () => tfaInput?.focus(),
			reconnect: () => reconnectBtn?.focus({ preventScroll: true }),
			summary: () => summaryInput?.focus()
		};
		if (canvas) viewer.attach(s, canvas);
		return () => {
			s.focus = null;
		};
	});

	// A new result closes Details again
	$effect(() => {
		void s.endInfo;
		detailsOpen = false;
	});

	async function copyDetails() {
		const ok = await copyText(viewer.detailsText(s));
		if (ok) toast.success(tf('common.copied', 'Copied to clipboard'));
		else toast.error(tf('common.copy_failed', 'Could not copy. Select the text and copy it yourself.'));
	}

	function onTfaInput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const digits = el.value.replace(/[^0-9]/g, '');
		if (digits !== el.value) el.value = digits;
		s.tfaCode = digits;
	}

	async function startPlayback() {
		viewer.startPlayback(s);
		await tick();
		s.focus?.canvas();
	}
</script>

{#snippet device()}
	<div class="rd-state-device">
		{#if s.platform}<span class="rd-state-os"><Platform platform={s.platform} /></span>{/if}
		<h2 class="rd-state-name">{name}</h2>
		{#if name !== s.deviceId}
			<span class="rd-state-id"
				><ValueCopy
					value={s.deviceId}
					label={tf('remote_viewer.device_id_named', 'ID of {name}', { name })}
				/></span
			>
		{/if}
	</div>
{/snippet}

<div
	class={['session-panel', view === 'streaming' && 'streaming']}
	id="rd-panel-{s.deviceId}"
	role="tabpanel"
	aria-labelledby="rd-tab-{s.deviceId}"
	hidden={!active}
>
	<canvas
		bind:this={canvas}
		class="session-canvas"
		tabindex={view === 'streaming' ? 0 : -1}
		aria-label={tf('remote_viewer.screen_label', 'Screen of {name}', { name })}
	></canvas>

	{#if overState}
		<div class={['viewer-overlay', view === 'failed' && 'is-failed', view === 'ended' && 'is-ended']}>
			<div class={['overlay-card', s.billing && 'overlay-card--billing']}>
				<div class="rd-state">
					{@render device()}
					<h3
						class={['rd-state-title', view === 'failed' && 'tone-danger', view === 'ended' && 'tone-neutral']}
					>
						{#if result}<Status
								tone={view === 'failed' ? 'danger' : 'neutral'}
								label={title}
							/>{:else}{title}{/if}
					</h3>
					<p class="overlay-status" role="status">{s.statusText}</p>
					{#if result && s.tryText}<p class="rd-state-try">{s.tryText}</p>{/if}
					{#if view === 'connecting' || view === 'failed'}
						<ol class="rd-steps" aria-label={tf('remote_viewer.steps_label', 'Connection steps')}>
							{#each steps as step (step.id)}
								<li
									class={['rd-step', `is-${step.tone}`]}
									aria-current={step.state === 'now' || step.state === 'failed' ? 'step' : undefined}
								>
									<Status tone={step.tone} label={step.label} /><span class="sr-only"> ({step.word})</span>
								</li>
							{/each}
						</ol>
					{/if}
					{#if view === 'connecting' && s.slowHint}<p class="rd-state-hint">{s.slowHint}</p>{/if}
					{#if view === 'connecting'}
						<div class="overlay-actions">
							<Button onclick={() => viewer.cancel(s)}>{tf('common.cancel', 'Cancel')}</Button>
						</div>
					{:else}
						<div class="overlay-actions">
							<Button
								variant={s.billing ? 'secondary' : 'primary'}
								icon="refresh"
								bind:element={reconnectBtn}
								onclick={() => viewer.reconnect(s)}>{tf('remote.reconnect', 'Reconnect')}</Button
							>
							{#if s.cdapFallback}
								<LinkButton
									href={link(`/remote/${encodeURIComponent(s.deviceId)}?transport=cdap`)}
									title={tf('remote.cdap_fallback_hint', 'Connect through the BetterDesk agent instead')}
									>{tf('remote.use_cdap_fallback', 'Use agent connection')}</LinkButton
								>
							{/if}
							{#if openDevice}
								<LinkButton
									icon="open_in_new"
									href={link(`/devices?open=${encodeURIComponent(s.deviceId)}`)}
									target="_blank"
									rel="noopener noreferrer">{tf('remote_viewer.open_device', 'Open device')}</LinkButton
								>
							{/if}
							<Button onclick={() => viewer.close(s.deviceId)}
								>{tf('remote_viewer.close_tab', 'Close tab')}</Button
							>
						</div>
						{#if detailsShown}
							<details class="rd-state-details" bind:open={detailsOpen}>
								<summary>{tf('remote_viewer.details', 'Details')}</summary>
								<Button
									size="sm"
									variant="ghost"
									icon="content_copy"
									class="copy-details"
									onclick={copyDetails}>{tf('remote_viewer.copy_details', 'Copy details')}</Button
								>
								<dl class="facts">
									{#each rows as [k, v] (k)}
										<dt>{k}</dt>
										<dd>{v}</dd>
									{/each}
								</dl>
							</details>
						{/if}
					{/if}
				</div>
				{#if s.billing}
					{@const b = s.billing}
					{@const mins = b.session.billed_minutes ?? 0}
					{@const amount = (b.session.amount_included ?? 0) + (b.session.amount_overage ?? 0)}
					<div class="overlay-card-divider" aria-hidden="true"></div>
					<form
						class="overlay-card-billing"
						onsubmit={(e) => {
							e.preventDefault();
							void viewer.submitWorkReport(s);
						}}
					>
						<h3 class="billing-pane-title">{tf('commercialization.report.title', 'Work report')}</h3>
						<p class="billing-pane-package">
							{b.session.package_name
								? `${tf('commercialization.contracts.package', 'Package')}: ${b.session.package_name}`
								: s.label}
						</p>
						<p class="billing-pane-hours">
							{`${(mins / 60).toFixed(2)} h (${mins} min), ${amount.toFixed(2)} ${b.session.currency ?? ''}`.trim()}
						</p>
						<label class="billing-pane-label" for="{uid}-summary"
							>{tf('commercialization.report.summary', 'Work performed')}</label
						>
						<Textarea
							id="{uid}-summary"
							bind:element={summaryInput}
							rows={6}
							maxlength={8000}
							value={b.summary}
							invalid={!!b.error}
							describedby={b.error ? `${uid}-summary-error` : undefined}
							oninput={(e) => viewer.setReportSummary(s, (e.currentTarget as HTMLTextAreaElement).value)}
						/>
						{#if b.error}<p class="billing-pane-error" id="{uid}-summary-error" role="alert">
								{b.error}
							</p>{/if}
						<div class="billing-pane-actions">
							<Button onclick={() => viewer.skipWorkReport(s)} disabled={b.busy}
								>{tf('commercialization.report.skip', 'Skip for now')}</Button
							>
							<Button type="submit" variant="primary" busy={b.busy}
								>{tf('commercialization.report.submit', 'Submit report')}</Button
							>
						</div>
					</form>
				{/if}
			</div>
		</div>
	{:else if view === 'password'}
		<div class="viewer-overlay">
			<div class="overlay-card">
				<form
					class="rd-state"
					onsubmit={(e) => {
						e.preventDefault();
						viewer.authenticate(s);
					}}
				>
					{@render device()}
					<h3 class="rd-state-title">{tf('remote_viewer.password_title', 'Password needed')}</h3>
					<p class="rd-state-text">
						{tf(
							'remote_viewer.password_intro',
							'{name} asks for a password. Use the one set in RustDesk on that device.',
							{ name }
						)}
					</p>
					<div class="password-form">
						<label class="field-label" for="{uid}-pw">{tf('remote.password_placeholder', 'Password')}</label>
						<input
							bind:this={passwordInput}
							id="{uid}-pw"
							class="form-input"
							type="password"
							autocomplete="off"
							bind:value={s.password}
							aria-invalid={s.loginError ? 'true' : undefined}
							aria-describedby={s.loginError ? `${uid}-pw-error` : undefined}
						/>
						{#if s.loginError}<p class="login-error" id="{uid}-pw-error" role="alert">{s.loginError}</p>{/if}
						<Checkbox
							label={tf('remote_viewer.remember_password', 'Remember the password in this browser')}
							bind:checked={s.remember}
						/>
						<div class="overlay-actions">
							<Button type="submit" variant="primary">{tf('remote.connect', 'Connect')}</Button>
							<Button onclick={() => viewer.cancel(s)}>{tf('common.cancel', 'Cancel')}</Button>
						</div>
					</div>
				</form>
			</div>
		</div>
	{:else if view === 'tfa'}
		<div class="viewer-overlay">
			<div class="overlay-card">
				<form
					class="rd-state"
					onsubmit={(e) => {
						e.preventDefault();
						viewer.verifyCode(s);
					}}
				>
					{@render device()}
					<h3 class="rd-state-title">{tf('remote.2fa_required', 'Two-factor code required')}</h3>
					<p class="rd-state-text">
						{tf(
							'remote_viewer.tfa_intro',
							'{name} asks for a code from the authenticator app linked to it.',
							{
								name
							}
						)}
					</p>
					<div class="password-form">
						<label class="field-label" for="{uid}-tfa">{tf('auth.totp_code', 'Authentication code')}</label>
						<input
							bind:this={tfaInput}
							id="{uid}-tfa"
							class="form-input session-2fa-input"
							type="text"
							autocomplete="one-time-code"
							maxlength="6"
							inputmode="numeric"
							pattern="[0-9]*"
							value={s.tfaCode}
							oninput={onTfaInput}
							aria-describedby="{uid}-tfa-hint{s.tfaError ? ` ${uid}-tfa-error` : ''}"
							aria-invalid={s.tfaError ? 'true' : undefined}
						/>
						<p class="form-hint" id="{uid}-tfa-hint">
							{tf('remote.2fa_hint', 'Enter the 6-digit code from your authenticator app')}
						</p>
						{#if s.tfaError}<p class="login-error" id="{uid}-tfa-error" role="alert">{s.tfaError}</p>{/if}
						<div class="overlay-actions">
							<Button type="submit" variant="primary">{tf('remote.verify', 'Verify')}</Button>
							<Button onclick={() => viewer.cancel(s)}>{tf('common.cancel', 'Cancel')}</Button>
						</div>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if s.autoplayBlocked && view === 'streaming'}
		<div class="viewer-overlay autoplay-overlay">
			<div class="overlay-card">
				<h2 class="rd-state-title">{tf('remote.click_to_start', 'Click to Start')}</h2>
				<p class="rd-state-text">
					{tf(
						'remote.autoplay_blocked',
						'Browser requires user interaction to start video and audio playback.'
					)}
				</p>
				<div class="overlay-actions">
					<Button variant="primary" onclick={startPlayback}
						>{tf('remote.start_playback', 'Start Playback')}</Button
					>
				</div>
			</div>
		</div>
	{/if}

	{#if s.banner}
		<div class={['security-warning-banner', s.banner.level === 'error' && 'security-error']} role="alert">
			<span class="security-warning-text">{s.banner.message}</span>
			<IconButton icon="close" label={tf('actions.dismiss', 'Dismiss')} onclick={() => (s.banner = null)} />
		</div>
	{/if}
</div>

<style>
	.session-panel {
		position: absolute;
		inset: 0;
		overflow: hidden;
	}
	.session-panel[hidden] {
		display: none;
	}
	.session-canvas {
		display: block;
		width: 100%;
		height: 100%;
		outline: none;
		cursor: default;
	}
	/* Keyboard focus on the remote screen shows as an inset ring */
	.session-canvas:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.streaming .session-canvas {
		cursor: crosshair;
	}
	.viewer-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: flex-start;
		padding: min(18vh, 160px) var(--space-4) var(--space-6);
		overflow-y: auto;
		background: var(--bg);
		color: var(--text);
	}
	.autoplay-overlay {
		z-index: 150;
	}
	.overlay-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: min(36rem, 100%);
		margin: 0 auto;
	}
	.rd-state {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.rd-state-device {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		padding-bottom: var(--space-4);
		border-bottom: 1px solid var(--rule);
	}
	.rd-state-name {
		order: -1;
		flex-basis: 100%;
		margin: 0;
		font-size: var(--text-xl);
		overflow-wrap: anywhere;
	}
	.rd-state-os,
	.rd-state-id {
		color: var(--text-muted);
	}
	.rd-state-title {
		margin: var(--space-1) 0 0;
		font-size: var(--text-md);
	}
	.rd-state-title :global(.status) {
		color: var(--text);
		white-space: normal;
	}
	.overlay-status {
		margin: 0;
		font-size: var(--text-md);
	}
	.rd-state-try,
	.rd-state-text {
		margin: 0;
		color: var(--text-muted);
	}
	.rd-steps {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-1) 0 0;
		padding: 0;
		list-style: none;
	}
	.rd-step :global(.status) {
		align-items: center;
		white-space: normal;
	}
	.rd-step[aria-current='step'] {
		font-weight: 600;
	}
	.rd-step.is-good :global(.status) {
		color: var(--text-muted);
	}
	.rd-state-hint {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-inline-start: 3px solid var(--info);
		background: var(--bg-subtle);
	}
	/* Details come last, under the buttons; Copy sits on the summary's line */
	.rd-state-details {
		position: relative;
		margin-top: var(--space-2);
	}
	.rd-state-details > summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--row-h);
		font-weight: 600;
		cursor: pointer;
		list-style: none;
	}
	.rd-state-details > summary::-webkit-details-marker {
		display: none;
	}
	.rd-state-details > summary::before {
		content: 'expand_more';
		font-family: 'Material Symbols Outlined';
		font-size: 20px;
		font-weight: 400;
		line-height: 1;
		color: var(--text-muted);
		transform: rotate(-90deg);
		transition: transform var(--motion);
		font-feature-settings: 'liga';
	}
	.rd-state-details:dir(rtl) > summary::before {
		transform: rotate(90deg);
	}
	.rd-state-details[open] > summary::before {
		transform: none;
	}
	.rd-state-details > :global(.copy-details) {
		position: absolute;
		top: calc((var(--row-h) - var(--control-h-sm)) / 2);
		inset-inline-end: 0;
	}
	.rd-state-details .facts {
		margin-bottom: var(--space-3);
	}
	.rd-state-details .facts dd {
		overflow-wrap: anywhere;
	}
	.overlay-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.password-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.field-label {
		font-weight: 600;
	}
	.form-input {
		box-sizing: border-box;
		width: 100%;
		max-width: 24rem;
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
	.form-input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.session-2fa-input {
		max-width: 12ch;
		font-size: var(--text-md);
		letter-spacing: 0.2em;
	}
	.form-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.login-error {
		margin: 0;
		color: var(--danger);
	}
	/* Work report after a billed session: the state and the form side by side */
	.overlay-card.overlay-card--billing {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1.4fr);
		gap: var(--space-5);
		width: min(880px, 100%);
	}
	.overlay-card-divider {
		background: var(--rule);
	}
	.overlay-card-billing {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.billing-pane-title {
		margin: 0;
		font-size: var(--text-md);
	}
	.billing-pane-package,
	.billing-pane-hours {
		margin: 0;
		color: var(--text-muted);
	}
	.billing-pane-label {
		font-weight: 600;
	}
	.billing-pane-error {
		margin: 0;
		color: var(--danger);
	}
	.billing-pane-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	@media (max-width: 720px) {
		.overlay-card.overlay-card--billing {
			grid-template-columns: minmax(0, 1fr);
		}
		.overlay-card-divider {
			height: 1px;
		}
	}
	.security-warning-banner {
		position: absolute;
		top: var(--space-2);
		left: 50%;
		z-index: 210;
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		max-width: min(540px, calc(100% - 2 * var(--space-4)));
		padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
		border: 1px solid var(--rule);
		border-inline-start: 3px solid var(--warning);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		transform: translateX(-50%);
	}
	.security-warning-banner.security-error {
		border-inline-start-color: var(--danger);
	}
	@media (max-width: 640px) {
		.viewer-overlay {
			padding: var(--space-5) var(--space-4);
		}
		.rd-state-name {
			font-size: var(--text-lg);
		}
	}
</style>
