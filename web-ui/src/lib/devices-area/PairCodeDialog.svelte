<!--
  "Pair with code" (enrollment.approve): a one-time code for a BetterDesk
  agent. The server address is filled in with the client address the
  overview resolved (the person can change it), the label is optional.
  Create code asks the server for a code (POST /api/panel/pairing/codes);
  the code is shown once, with the address to type next to it and how long
  it still works (10 minutes). Copy sits with the code.

  The agent's QR code can still be read: "Scan agent QR" closes this dialog
  and opens the scanner. The list of active codes is on /pairing.

  A centred dialog: Close, and Create code as the answer; Enter in a field
  creates the code.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createCode } from '#lib/api/pairing.ts';
	import { endsAt, remaining } from '#lib/clients/pairing.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import { ICONS } from '#lib/util/display.ts';

	interface Props {
		/** The client address the overview resolved; fills the field while the person hasn't typed one */
		host: string;
		onclose: () => void;
		/** Open the agent QR scanner instead */
		onscan: () => void;
	}

	let { host, onclose, onscan }: Props = $props();

	const uid = $props.id();
	const formId = `${uid}-form`;

	let open = $state(true);
	let address = $state(untrack(() => host));
	let typed = false;
	let label = $state('');
	let creating = $state(false);
	let status = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' }>({
		message: '',
		tone: 'neutral'
	});
	let code = $state<{ value: string; host: string; endsAt: number } | null>(null);
	let now = $state(Date.now());

	// The client values can arrive after the dialog opened (?activateAgent=1 opens it at once)
	$effect(() => {
		const suggested = host;
		untrack(() => {
			if (!typed && !address.trim() && suggested) address = suggested;
		});
	});

	async function create(e?: SubmitEvent) {
		e?.preventDefault();
		if (creating) return;
		creating = true;
		status = { message: t('pairing.generating'), tone: 'neutral' };
		try {
			const out = await createCode(label.trim());
			if (!out.code) throw new Error('');
			code = { value: out.code, host: address.trim() || out.host, endsAt: endsAt(out.expires_in) };
			now = Date.now();
			status = { message: t('pairing.created'), tone: 'ok' };
		} catch (err) {
			const why = err instanceof Error ? err.message : '';
			status = {
				message: why ? `${t('pairing.create_failed')}: ${why}` : t('pairing.create_failed'),
				tone: 'error'
			};
		} finally {
			creating = false;
		}
	}

	// How long the code still works, every 5 seconds while it is shown
	$effect(() => {
		if (!code) return;
		const timer = setInterval(() => {
			now = Date.now();
			if (code && now >= code.endsAt) clearInterval(timer);
		}, 5000);
		return () => clearInterval(timer);
	});

	const left = $derived(code ? remaining(Math.round((code.endsAt - now) / 1000)) : null);
	const leftText = $derived(
		!left
			? ''
			: left.kind === 'expired'
				? t('pairing.expired_hint')
				: left.kind === 'under_minute'
					? t('pairing.valid_under_minute')
					: t('pairing.valid_minutes', { count: left.count })
	);

	function close() {
		open = false;
		onclose();
	}
</script>

<Dialog bind:open title={t('pairing.title')} {onclose}>
	<div class="pair">
		<p class="hint">{t('pairing.subtitle')}</p>
		<form id={formId} class="pair-form" onsubmit={create} novalidate>
			<Field label={t('pairing.host_field')} hint={t('pairing.host_hint')}>
				{#snippet children(f)}
					<Input
						{...f}
						width="host"
						autocomplete="off"
						spellcheck="false"
						dir="ltr"
						bind:value={address}
						oninput={() => (typed = true)}
					/>
				{/snippet}
			</Field>
			<Field label={t('pairing.label_field')} hint={t('pairing.label_hint')}>
				{#snippet children(f)}
					<Input
						{...f}
						width="medium"
						maxlength={64}
						autocomplete="off"
						placeholder={t('pairing.label_placeholder')}
						bind:value={label}
					/>
				{/snippet}
			</Field>
			<!-- Enter in a field creates the code (the visible button is in the footer) -->
			<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
		</form>

		{#if code}
			<div class="result" aria-live="polite">
				<p class="hint">{t('pairing.code_hint')}</p>
				<span class={['code', left?.kind === 'expired' && 'is-expired']}>
					<ValueField value={code.value} label={t('pairing.title')} />
				</span>
				<dl class="facts meta">
					<dt>{t('pairing.host_field')}</dt>
					<dd class="mono">{code.host}</dd>
					<dt>{t('pairing.expires_in')}</dt>
					<dd>{leftText}</dd>
				</dl>
			</div>
		{/if}

		<FormStatus message={status.message} tone={status.tone} />

		<!-- The other ways to pair: read the agent's QR code, or the list of codes -->
		<div class="other">
			<Button size="sm" icon={ICONS.qr} onclick={onscan}>{t('pairing.scan_qr_agent')}</Button>
			<a href={link('/pairing')}>{t('nav.pairing')}</a>
		</div>
	</div>
	{#snippet footer()}
		<Button onclick={close}>{t('actions.close')}</Button>
		<Button variant="primary" type="submit" form={formId} busy={creating}
			>{t('pairing.generate_button')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.pair {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
	}
	.pair-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.pair-form :global(.form-group) {
		margin-bottom: 0;
	}
	.result {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	/* The code is read out or typed from the screen: make it big */
	.code {
		align-self: flex-start;
		max-width: 100%;
	}
	.code :global(.value) {
		padding: var(--space-3) var(--space-4);
		font-size: 2.25rem;
		font-weight: 600;
		letter-spacing: 0.15em;
		line-height: 1.1;
	}
	.code.is-expired :global(.value) {
		color: var(--text-muted);
		text-decoration: line-through;
	}
	/* Label above value, so the facts line up under the code */
	.meta {
		grid-template-columns: minmax(0, 1fr);
	}
	.meta > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
		font-size: var(--text-sm);
	}
	.meta > dd {
		padding-top: var(--space-1);
	}
	.other {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
	}
</style>
