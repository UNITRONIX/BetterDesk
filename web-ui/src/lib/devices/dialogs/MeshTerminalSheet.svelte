<!--
  A shell on a MeshAgent device, in a wide side sheet. Escape goes to the
  shell; Shift+Escape closes the sheet (the Terminal component says so
  under the box). Closing the sheet ends the connection.
-->
<script lang="ts">
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Terminal from '#lib/ui/Terminal.svelte';
	import { meshAdapter, meshTerminalUrl, socketConnect } from '#lib/ui/terminal.ts';
	import type { DeviceLike } from '../model.ts';

	let { device, settle }: { device: DeviceLike; settle: (done: true | null) => void } = $props();

	const connect = socketConnect(() => meshTerminalUrl(device.id), meshAdapter());
</script>

<Sheet
	wide
	title={tf('mesh.terminal_title_named', 'Remote terminal on {id}', { id: device.id })}
	subtitle={tf(
		'mesh.terminal_sheet_desc',
		'A shell on the device through its MeshAgent. Escape goes to the shell, Shift+Escape closes the terminal.'
	)}
	onclose={() => settle(true)}
>
	<div class="mesh-term">
		<Terminal label={t('mesh.terminal_title')} {connect} focusOnOpen />
	</div>
	{#snippet footer()}
		<Button onclick={() => settle(true)}>{t('actions.close')}</Button>
	{/snippet}
</Sheet>

<style>
	/* The terminal takes the height the sheet has */
	.mesh-term {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 320px;
	}
	.mesh-term > :global(.terminal) {
		flex: 1;
	}
</style>
