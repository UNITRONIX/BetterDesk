<!--
  A terminal widget. Before a session it shows the lines the device reports
  in its widget state (if any). Connect (cdap.terminal, as the socket
  checks) opens a shell: the Terminal component on
  /api/cdap/devices/:id/terminal with cdapAdapter(); Disconnect ends it.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { tf, t } from '#lib/i18n/i18n.svelte.ts';
	import { terminalLines, type Widget } from '#lib/devices-area/cdap/model.ts';
	import { cdapSocketPath } from '#lib/devices-area/cdap/streams.ts';
	import Button from '#lib/ui/Button.svelte';
	import Terminal from '#lib/ui/Terminal.svelte';
	import { cdapAdapter } from '#lib/ui/terminal.ts';
	import { ICONS } from '#lib/util/display.ts';

	interface Props {
		widget: Widget;
		value: unknown;
		deviceId: string;
		deviceName: string;
		canConnect: boolean;
	}

	let { widget, value, deviceId, deviceName, canConnect }: Props = $props();

	let open = $state(false);
	let opener = $state<HTMLElement | null>(null);

	// Lines from the widget state: a list replaces them, a new single line is added
	let lines = $state.raw<string[]>([]);
	let last: unknown = undefined;
	$effect(() => {
		const v = value;
		untrack(() => {
			lines = terminalLines(lines, v, last);
			last = v;
		});
	});

	const adapter = cdapAdapter();
</script>

<div class="terminal-widget">
	{#if open}
		<div class="term-box">
			<Terminal
				label={tf('cdap.terminal_label', 'Terminal on {name}', { name: deviceName })}
				url={cdapSocketPath(deviceId, 'terminal')}
				{adapter}
				convertEol
				focusOnOpen
			/>
		</div>
		<div class="term-actions">
			<Button
				size="sm"
				onclick={() => {
					open = false;
					void tick().then(() => opener?.focus());
				}}>{t('remote.disconnect')}</Button
			>
		</div>
	{:else}
		{#if lines.length}
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scroll box is reached with the keyboard) -->
			<pre
				class="term-lines"
				tabindex="0"
				role="region"
				aria-label={tf('cdap.terminal_output', 'Lines from {name}', { name: widget.label })}>{lines.join(
					'\n'
				)}</pre>
		{/if}
		{#if canConnect}
			<div class="term-actions">
				<Button bind:element={opener} icon={ICONS.terminal} onclick={() => (open = true)}
					>{t('cdap.connect_terminal')}</Button
				>
			</div>
		{/if}
	{/if}
</div>

<style>
	.terminal-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.term-box {
		display: flex;
		flex-direction: column;
		height: 420px;
		min-width: 0;
	}
	.term-lines {
		max-height: 280px;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		overflow-y: auto;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: #111414;
		color: #e3e6e6;
		font-family: var(--mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-all;
	}
	.term-lines:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.term-actions {
		display: flex;
		justify-content: center;
		padding: var(--space-2);
	}
</style>
