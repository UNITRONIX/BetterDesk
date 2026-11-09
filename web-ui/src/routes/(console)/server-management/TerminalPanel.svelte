<!--
  Terminal (?tab=terminal): a shell on the machine that runs the console,
  over /ws/server-management/terminal (ui/terminal.ts shellAdapter). It
  connects when the tab opens, without taking the focus (a focused
  terminal keeps Tab for the shell). Disconnect and Clear sit above it;
  after the session ends, the terminal's own Reconnect starts a new one
  and puts the focus in it. A shell that ends within 3 s says why in the
  status line (the shell is missing, or its exit code).
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Terminal from '#lib/ui/Terminal.svelte';
	import { shellAdapter, type TerminalState } from '#lib/ui/terminal.ts';

	let term = $state<ReturnType<typeof Terminal> | null>(null);
	let phase = $state<TerminalState>('loading');

	const adapter = shellAdapter();
	const live = $derived(phase === 'open' || phase === 'connecting');
</script>

<section class="section terminal-panel" aria-label={t('server_mgmt.tab_terminal')}>
	<p class="note">{t('server_mgmt.term_warning')}</p>
	<div class="actions">
		<Button class="term-disconnect" disabled={!live} onclick={() => term?.disconnect()}
			>{t('server_mgmt.term_disconnect')}</Button
		>
		<Button
			class="term-clear"
			disabled={phase === 'loading'}
			onclick={() => {
				term?.clear();
				term?.focus();
			}}>{t('server_mgmt.term_clear')}</Button
		>
	</div>
	<div class="term-host">
		<Terminal
			bind:this={term}
			label={t('server_mgmt.tab_terminal')}
			url="/ws/server-management/terminal"
			{adapter}
			onstatechange={(s) => (phase = s)}
		/>
	</div>
</section>

<style>
	.note {
		margin: 0;
		max-width: var(--measure);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	/* The terminal fills the window below the page head; it needs a set height */
	.term-host {
		height: clamp(420px, calc(100dvh - var(--topbar-h, 56px) - 300px), 1200px);
		min-width: 0;
	}
</style>
