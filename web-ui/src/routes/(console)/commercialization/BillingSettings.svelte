<!--
  Billing settings (#billing-settings-panel): a closed section in the side
  column, opened by ?settings=1 or ?tab=settings. The link to the server
  clock settings, whether email sending works, and the help request email
  options (the other three show while "Send email for new help requests"
  is on). Loads when it opens. People without billing.manage see the
  options switched off and no save bar.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { getEmailConfig, saveEmailConfig, smtpConfigured } from '#lib/api/billing.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';

	let { open = false, canManage }: { open?: boolean; canManage: boolean } = $props();

	const uid = $props.id();
	// svelte-ignore state_referenced_locally
	let isOpen = $state(open);
	let loaded = $state(false);
	let loadError = $state(false);
	let smtp = $state<boolean | null>(null);
	let host = $state<HTMLElement | null>(null);

	const form = createForm({
		initial: {
			help_requests_enabled: true,
			notify_assigned_operators: true,
			fallback_alert_email: true,
			include_folder_in_subject: true
		},
		submit: (v) => saveEmailConfig(v),
		savedMessage: t('commercialization.notifications.saved')
	});

	async function load() {
		loaded = true;
		smtpConfigured().then(
			(on) => (smtp = on),
			() => (smtp = false)
		);
		try {
			form.reset(await getEmailConfig());
		} catch {
			loadError = true;
		}
	}

	$effect(() => {
		if (isOpen && !untrack(() => loaded)) void load();
	});

	// Opened from the URL: scroll it into view once it is drawn
	$effect(() => {
		if (!untrack(() => open)) return;
		void tick().then(() => host?.scrollIntoView({ block: 'start' }));
	});
</script>

<div id="billing-settings-panel" class="settings" bind:this={host}>
	<Disclosure class="section" title={t('commercialization.ui.settings_title')} bind:open={isOpen}>
		<div class="body">
			<p class="section-note">{t('commercialization.ui.settings_note')}</p>
			<p class="line">
				<a href={link('/settings?tab=time')}>{t('commercialization.clock.open_time_settings')}</a>
			</p>
			<form id={form.id} class="notifications" onsubmit={form.onsubmit} novalidate>
				<h3>{t('commercialization.notifications.title')}</h3>
				<p class="hint">{t('commercialization.notifications.desc')}</p>
				{#if smtp === true}
					<p class="line">{t('commercialization.notifications.smtp_configured')}</p>
				{:else if smtp === false}
					<Notice tone="warning" message={t('commercialization.ui.smtp_missing_effect')} />
				{/if}
				<p class="line">
					<a href={link('/settings?tab=email')}>{t('commercialization.notifications.smtp_link')}</a>
				</p>
				{#if loadError}
					<States
						kind="error"
						message={t('commercialization.ui.error_settings')}
						onretry={() => void load()}
					/>
				{/if}
				<Checkbox
					class="notif-help"
					label={t('commercialization.notifications.help_requests_enabled')}
					disabled={!canManage}
					aria-controls="{uid}-options"
					aria-expanded={form.values.help_requests_enabled}
					bind:checked={form.values.help_requests_enabled}
				/>
				<ShowWhen id="{uid}-options" when={form.values.help_requests_enabled}>
					<div class="options">
						<Checkbox
							label={t('commercialization.notifications.notify_assigned_operators')}
							disabled={!canManage}
							bind:checked={form.values.notify_assigned_operators}
						/>
						<Checkbox
							label={t('commercialization.notifications.fallback_alert_email')}
							disabled={!canManage}
							bind:checked={form.values.fallback_alert_email}
						/>
						<Checkbox
							label={t('commercialization.notifications.include_folder_in_subject')}
							disabled={!canManage}
							bind:checked={form.values.include_folder_in_subject}
						/>
					</div>
				</ShowWhen>
				<p class="hint">{t('commercialization.ui.applies_now')}</p>
				{#if canManage}
					<SaveBar {form} label={t('commercialization.notifications.save')} />
				{/if}
			</form>
		</div>
	</Disclosure>
</div>

<style>
	.settings {
		scroll-margin-top: calc(var(--topbar-h, 56px) + var(--space-4));
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}
	.line {
		margin: 0;
	}
	.notifications {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-top: var(--space-2);
	}
	.notifications h3 {
		margin: 0;
		font-size: var(--text-md);
	}
	.options {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
