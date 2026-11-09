<!--
  Connect on a phone: the web viewer needs a wider screen, so offer it
  anyway (to turn the phone sideways) or hand the ID to the RustDesk app.
  RDP/VNC targets have no app choice.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { deviceLabel, type DeviceLike } from '../model.ts';

	let {
		device,
		app,
		settle
	}: { device: DeviceLike; app: boolean; settle: (choice: 'web' | 'app' | null) => void } = $props();
</script>

<Dialog
	title={t('devices.connect_phone_title')}
	message={t('devices.connect_phone_intro')}
	onclose={() => settle(null)}
>
	<p class="for">{deviceLabel(device)}</p>
	<ul class="choices">
		<li>
			<span class="main">
				<span class="title">{t('devices.connect_phone_web')}</span>
				<span class="sub">{t('devices.connect_phone_web_desc')}</span>
			</span>
			<Button size="sm" onclick={() => settle('web')}>{t('devices.connect_phone_web_action')}</Button>
		</li>
		{#if app}
			<li>
				<span class="main">
					<span class="title">{t('devices.connect_phone_app')}</span>
					<span class="sub">{t('devices.connect_phone_app_desc')}</span>
				</span>
				<Button size="sm" onclick={() => settle('app')}>{t('devices.connect_phone_app_action')}</Button>
			</li>
		{/if}
	</ul>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
	{/snippet}
</Dialog>

<style>
	.for {
		margin: 0;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.choices {
		margin: var(--space-3) 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.choices li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--row-pad-y) 0;
		border-bottom: 1px solid var(--rule);
	}
	.main {
		display: flex;
		flex: 1 1 200px;
		flex-direction: column;
		min-width: 0;
	}
	.title {
		font-weight: 600;
	}
	.sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
