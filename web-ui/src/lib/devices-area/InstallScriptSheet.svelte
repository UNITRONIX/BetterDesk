<!--
  The overview's "Windows install script (Intune)": a PowerShell snippet
  that sets the same values as the deploy string, in a wide side sheet
  (details with one command: Copy in the code block, Close in the footer).
-->
<script lang="ts">
	import type { ClientConfig } from '#lib/api/dashboard.ts';
	import { intuneScript } from '#lib/devices-area/dashboard.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';

	let { config, onclose }: { config: ClientConfig; onclose: () => void } = $props();

	let open = $state(true);
	const script = $derived(intuneScript(config));
	/** The name an admin would save it under (not translated: a file name) */
	const FILE_NAME = 'install-rustdesk-config.ps1';
</script>

<Sheet
	bind:open
	wide
	title={t('dashboard.intune_script_title')}
	subtitle={t('dashboard.intune_script_hint')}
	{onclose}
>
	<CodeBlock code={script} title={FILE_NAME} />
	{#snippet footer()}
		<Button
			onclick={() => {
				open = false;
				onclose();
			}}>{t('actions.close')}</Button
		>
	{/snippet}
</Sheet>
