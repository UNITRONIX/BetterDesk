<!--
  Connect by ID: the field and Connect (and, on the dashboard, "Open in
  RustDesk app"). An ID that is not 3 to 64 letters, digits, - or _ says
  so under the field instead of connecting.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import { readQuickId } from './address-book.ts';

	interface Props {
		onconnect: (id: string) => void;
		/** "Open in RustDesk app" next to Connect (the dashboard) */
		onapp?: ((id: string) => void) | null;
		/** Phones: the app is the one action and Enter opens it */
		phone?: boolean;
		hint?: string;
		element?: HTMLInputElement | null;
	}

	let { onconnect, onapp = null, phone = false, hint = '', element = $bindable(null) }: Props = $props();

	const uid = $props.id();
	let value = $state('');
	let error = $state('');

	function read(): string {
		const id = readQuickId(value);
		error = id
			? ''
			: tf('remote_dashboard.quick_connect_invalid', 'Enter a device ID: 3 to 64 letters, digits, - or _.');
		if (!id) element?.focus();
		return id;
	}

	function connect() {
		const id = read();
		if (id) onconnect(id);
	}

	function app() {
		const id = read();
		if (id) onapp?.(id);
	}
</script>

<div class="quick">
	<label class="field-label" for="{uid}-id">{tf('remote_dashboard.col_id', 'ID')}</label>
	<div class="quick-row">
		<input
			bind:this={element}
			id="{uid}-id"
			class="quick-input mono"
			type="text"
			inputmode="numeric"
			autocomplete="off"
			spellcheck="false"
			autocapitalize="none"
			enterkeyhint="go"
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error || hint ? `${uid}-status` : undefined}
			onkeydown={(e) => {
				if (e.key !== 'Enter') return;
				e.preventDefault();
				if (phone && onapp) app();
				else connect();
			}}
		/>
		{#if !phone}
			<Button variant="primary" onclick={connect}>{tf('remote_dashboard.connect', 'Connect')}</Button>
		{/if}
		{#if onapp}
			<Button variant={phone ? 'primary' : 'secondary'} onclick={app}
				>{tf('remote_viewer.open_in_app', 'Open in RustDesk app')}</Button
			>
		{/if}
	</div>
	{#if error || hint}
		<p class={['quick-status', error && 'is-error']} id="{uid}-status" aria-live="polite">{error || hint}</p>
	{/if}
</div>

<style>
	.quick {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.field-label {
		font-weight: 600;
	}
	.quick-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.quick-input {
		box-sizing: border-box;
		flex: 1 1 12rem;
		max-width: 20rem;
		min-height: var(--control-h);
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font-size: inherit;
	}
	.quick-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.quick-input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.quick-status {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.quick-status.is-error {
		color: var(--danger);
	}
</style>
