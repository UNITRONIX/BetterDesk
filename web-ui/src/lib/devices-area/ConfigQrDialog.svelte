<!--
  The overview's "Show QR": the RustDesk configuration (rustdesk://config/...)
  as a QR code for the phone app. When the values point at this computer
  only (localhost, a .local name), the warning comes before the code.
  The code is drawn here from the config text (the server's PNG is not
  needed, so the page loads no data: image).
-->
<script lang="ts">
	import type { ClientConfig } from '#lib/api/dashboard.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import QR from '#lib/ui/QR.svelte';

	let { config, onclose }: { config: ClientConfig; onclose: () => void } = $props();

	let open = $state(true);
</script>

<Dialog bind:open title={t('dashboard.client_config_qr_title')} {onclose}>
	<div class="qr-body">
		{#if config.phone_unreachable_host}
			<Notice tone="warning" message={t('dashboard.client_config_qr_unreachable_host')} />
		{/if}
		<div class="qr-frame">
			<QR text={config.config_uri} label={t('dashboard.client_config_qr_title')} size={256} />
		</div>
		<p>{t('dashboard.client_config_qr_hint')}</p>
	</div>
	{#snippet footer()}
		<Button
			onclick={() => {
				open = false;
				onclose();
			}}>{t('actions.close')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.qr-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.qr-frame {
		display: flex;
		justify-content: center;
	}
	.qr-body p {
		margin: 0;
	}
</style>
