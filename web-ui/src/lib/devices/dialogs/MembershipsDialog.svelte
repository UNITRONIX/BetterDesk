<!--
  The device's groups: the manual ones to tick, and the tag groups it is in
  because of its tags (shown only; its tags decide them).
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import type { Memberships } from '../ask.svelte.ts';
	import type { DeviceLike } from '../model.ts';

	let {
		device,
		load,
		save,
		settle
	}: {
		device: DeviceLike;
		load: () => Promise<Memberships>;
		save: (guids: string[]) => Promise<void>;
		settle: (done: true | null) => void;
	} = $props();

	const formId = $props.id();
	let data = $state.raw<Memberships | null>(null);
	let picked = $state<string[]>([]);
	let busy = $state(false);
	let error = $state('');
	let loadError = $state('');

	$effect(() => {
		let gone = false;
		load().then(
			(m) => {
				if (gone) return;
				data = m;
				picked = [...m.selected];
			},
			(err: unknown) => {
				if (!gone) loadError = err instanceof Error ? err.message : String(err);
			}
		);
		return () => {
			gone = true;
		};
	});

	function toggle(guid: string, on: boolean) {
		picked = on ? [...picked.filter((g) => g !== guid), guid] : picked.filter((g) => g !== guid);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy || !data) return;
		busy = true;
		error = '';
		try {
			await save(picked);
			settle(true);
		} catch (err) {
			error = err instanceof Error ? err.message : t('errors.server_error');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title={t('devices.manage_groups')} onclose={() => settle(null)}>
	<form id={formId} onsubmit={submit} novalidate>
		<Facts
			items={[
				{ label: t('devices.id'), value: device.id },
				{ label: t('devices.hostname'), value: device.hostname }
			]}
		/>
		{#if loadError}
			<p class="state is-error">{loadError}</p>
		{:else if !data}
			<p class="state">{t('common.loading')}</p>
		{:else}
			<fieldset>
				<legend>{t('devices.manual_groups')}</legend>
				<p class="hint">{t('devices.manual_groups_hint')}</p>
				<ul class="pick">
					{#each data.manual as g (g.guid)}
						{@const guid = g.guid ?? ''}
						<li>
							<Checkbox
								label={g.name || guid}
								checked={picked.includes(guid)}
								onchange={(e) => toggle(guid, (e.currentTarget as HTMLInputElement).checked)}
							/>
						</li>
					{:else}
						<li class="empty">{t('devices.no_groups')}</li>
					{/each}
				</ul>
			</fieldset>
			{#if data.dynamic.length}
				<div class="block">
					<h3 class="label">{t('devices.dynamic_memberships')}</h3>
					<p class="hint">{t('devices.dynamic_memberships_hint')}</p>
					<ul class="pick">
						{#each data.dynamic as g (g.guid)}
							<li class="row">
								<span>{g.name}</span>
								{#if g.tag_filter}<span class="sub">{t('devices.tag_filter')}: {g.tag_filter}</span>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
		<FormStatus message={error} tone="error" />
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={formId} {busy} disabled={!data}>{t('actions.save')}</Button>
	{/snippet}
</Dialog>

<style>
	fieldset {
		min-width: 0;
		margin: var(--space-4) 0;
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		font-weight: 600;
	}
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label {
		margin: 0;
		font-size: inherit;
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.pick {
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.pick > li {
		border-bottom: 1px solid var(--rule);
	}
	.pick > li > :global(.check-field) {
		padding-block: var(--row-pad-y);
	}
	.pick .row,
	.pick .empty {
		display: flex;
		flex-direction: column;
		padding: var(--row-pad-y) 0;
	}
	.pick .empty,
	.sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.state {
		margin: var(--space-4) 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
</style>
