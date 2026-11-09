<!--
  The idle warning (session-guard.js): shortly before an idle sign-out, a
  notice at the top with "Stay signed in". Not modal, like the old one:
  any use of the page hides it, the button also tells the server.
-->
<script lang="ts">
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { guard, staySignedIn } from './session-guard.svelte.ts';

	const uid = $props.id();
	const body = $derived(
		guard.warning === null
			? ''
			: tf(
					'auth.session_idle_warning_body',
					'You will be signed out due to inactivity in {{seconds}} seconds.'
				).replace('{{seconds}}', String(guard.warning))
	);
</script>

{#if guard.warning !== null}
	<div
		class="idle-warning"
		role="alertdialog"
		aria-labelledby={`${uid}-title`}
		aria-describedby={`${uid}-body`}
	>
		<Icon name="timer" />
		<div class="idle-text">
			<strong id={`${uid}-title`}>{t('auth.session_idle_warning_title')}</strong>
			<p id={`${uid}-body`}>{body}</p>
		</div>
		<Button variant="primary" onclick={staySignedIn}>{t('auth.session_stay_signed_in')}</Button>
	</div>
{/if}

<style>
	.idle-warning {
		position: fixed;
		top: var(--space-3);
		left: 50%;
		z-index: var(--layer-toast);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		box-sizing: border-box;
		width: max-content;
		max-width: calc(100vw - 2 * var(--space-4));
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule);
		border-inline-start: 3px solid var(--warning);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		transform: translateX(-50%);
	}
	.idle-warning > :global(.material-icons) {
		color: var(--warning);
	}
	.idle-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.idle-text p {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
