<!--
  The message next to the button that was pressed (components.css
  .form-status): "Reached 10.0.9.14 on port 3389.", "Could not reach the
  server." tone: neutral (default, e.g. "Testing…"), ok or error. The live
  region is always there, also when empty, so a new message is announced.
  Give it the form helper's status with `status`, or message and tone.
-->
<script lang="ts">
	import type { FormStatus } from './form.svelte.ts';

	type Tone = 'neutral' | 'ok' | 'error';

	interface Props {
		message?: string;
		tone?: Tone;
		status?: FormStatus;
		class?: string;
	}

	let { message, tone, status, class: cls = '' }: Props = $props();

	const text = $derived(message ?? status?.message ?? '');
	const t = $derived<Tone>(
		tone ?? (status?.state === 'saved' ? 'ok' : status?.state === 'error' ? 'error' : 'neutral')
	);
</script>

<p class={['form-status', t !== 'neutral' && `is-${t}`, cls]} role="status">{text}</p>

<style>
	.form-status {
		margin: 0;
		color: var(--text-muted);
	}
	.form-status.is-ok {
		color: var(--success);
	}
	.form-status.is-error {
		color: var(--danger);
	}
</style>
