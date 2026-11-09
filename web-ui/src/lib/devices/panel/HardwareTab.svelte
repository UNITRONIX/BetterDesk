<!--
  Hardware: what the client reported (system, processor, memory, displays,
  encoders) and the agent's inventory report below it. "Read again" asks
  the device to send its hardware details again (device.edit).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { formatBytes, formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import States from '#lib/ui/States.svelte';
	import { refreshHardware } from '../panel-actions.svelte.ts';
	import type { PanelData } from '../panel-data.svelte.ts';
	import { sysinfoOf, type PanelDevice } from '../panel-logic.ts';
	import InventoryReport from './InventoryReport.svelte';
	import PanelSection from './PanelSection.svelte';

	let { device, data }: { device: PanelDevice; data: PanelData } = $props();

	/** Facts without the empty ones */
	const keep = (...items: (Fact | false | '' | 0 | null | undefined)[]): Fact[] =>
		items.filter((f): f is Fact => !!f);

	const sys = $derived(sysinfoOf(device));
	const canRefresh = $derived(!device.soft_deleted && can('device.edit'));
	const inv = $derived(data.inventory);
	let refreshing = $state(false);

	$effect(() => {
		if (untrack(() => data.inventory.state) === 'idle') void data.loadInventory();
	});

	async function refresh() {
		refreshing = true;
		try {
			await refreshHardware(device);
		} finally {
			refreshing = false;
		}
	}

	const ghz = (n: number | null) =>
		!n || n <= 0
			? ''
			: n >= 1
				? `${formatNumber(n, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} GHz`
				: `${formatNumber(n * 1000, { maximumFractionDigits: 0 })} MHz`;

	const systemFacts = $derived<Fact[]>(
		!sys
			? []
			: keep(
					sys.hostname && { label: t('devices.hostname'), value: sys.hostname },
					sys.username && { label: t('devices.username'), value: sys.username },
					sys.osFull && { label: t('device_detail.os'), value: sys.osFull },
					sys.platform && { label: t('devices.platform'), value: sys.platform },
					sys.version && { label: t('device_detail.version'), value: sys.version },
					sys.vendor && { label: t('device_detail.vendor'), value: sys.vendor },
					sys.domain && { label: t('device_detail.domain'), value: sys.domain },
					sys.cpu && { label: 'CPU', value: sys.cpu },
					sys.memory && { label: t('device_detail.total_memory'), value: sys.memory },
					sys.readStatus && { label: t('device_detail.read_status'), value: sys.readStatus }
				)
	);
	const cpuFacts = $derived<Fact[]>(
		!sys
			? []
			: keep(
					sys.cpuName && { label: t('device_detail.cpu_model'), value: sys.cpuName },
					sys.cpuCores && { label: t('device_detail.cpu_cores'), value: formatNumber(sys.cpuCores) },
					sys.cpuGhz && { label: t('device_detail.cpu_freq'), value: ghz(sys.cpuGhz) }
				)
	);
	const memoryGb = $derived(sys?.memoryGb && sys.memoryGb > 0 ? formatBytes(sys.memoryGb * 1024 ** 3) : '');
</script>

{#snippet readAgain()}
	{#if canRefresh}
		<Button size="sm" icon="refresh" busy={refreshing} onclick={refresh}
			>{t('device_detail.read_again')}</Button
		>
	{/if}
{/snippet}

{#if sys}
	<PanelSection title={t('device_detail.section_system')} actions={readAgain}>
		<Facts items={systemFacts} />
	</PanelSection>

	{#if cpuFacts.length}
		<PanelSection title={t('device_detail.section_cpu')}>
			<Facts items={cpuFacts} />
		</PanelSection>
	{/if}

	{#if memoryGb}
		<PanelSection title={t('device_detail.section_memory')}>
			<Facts items={[{ label: t('device_detail.total_memory'), value: memoryGb }]} />
		</PanelSection>
	{/if}

	{#if sys.displays.length}
		<PanelSection title={t('device_detail.section_displays')}>
			<ul class="dp-rows">
				{#each sys.displays as d, i (i)}
					<li>
						<Icon name="monitor" />
						<span>{d.name}</span>
						{#if d.width && d.height}<span class="dp-muted">{d.width}×{d.height}</span>{/if}
					</li>
				{/each}
			</ul>
		</PanelSection>
	{/if}

	{#if sys.encoders.length}
		<PanelSection title={t('device_detail.section_encoding')}>
			<p class="dp-muted">{sys.encoders.join(', ')}</p>
		</PanelSection>
	{/if}
{:else if inv.state === 'ready' && inv.value}
	<!-- Nothing from the client: the agent's report is the whole tab -->
{:else if inv.state !== 'loading'}
	<PanelSection title={t('device_detail.section_system')} actions={readAgain}>
		<p class="dp-empty">{t('device_detail.no_sysinfo')}</p>
		<p class="dp-muted">{t('device_detail.no_sysinfo_hint')}</p>
	</PanelSection>
{/if}

{#if inv.state === 'loading' || inv.state === 'idle'}
	<States kind="loading" message={t('inventory.loading_detail')} />
{:else if inv.state === 'error'}
	<States
		kind="error"
		message="{t('inventory.detail_failed')} {inv.error}"
		retryLabel={t('actions.retry')}
		onretry={() => data.loadInventory()}
	/>
{:else if inv.value}
	<InventoryReport report={inv.value} />
{/if}

<style>
	.dp-rows {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.dp-rows > li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.dp-rows > li > :global(.material-icons),
	.dp-rows > li > :global(.icon) {
		color: var(--text-muted);
	}
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-empty {
		margin: 0;
	}
</style>
