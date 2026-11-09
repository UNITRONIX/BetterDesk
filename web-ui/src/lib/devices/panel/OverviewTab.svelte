<!--
  Overview: the edit form in edit mode (passed in as children), the ban
  notice, current load, identity, the RDP/VNC target's connection, the
  connection mode, network and times. Everything from the device is text.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Folder } from '#lib/api/devices.ts';
	import { formatDate } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Status from '#lib/ui/Status.svelte';
	import TagSet from '#lib/ui/TagSet.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Version from '#lib/ui/Version.svelte';
	import { banLine, connectionModeOf, currentLoad, identityOf, type PanelDevice } from '../panel-logic.ts';
	import ConnectionMode from './ConnectionMode.svelte';
	import PanelSection from './PanelSection.svelte';

	interface Props {
		device: PanelDevice;
		folders: Folder[] | null;
		editing: boolean;
		/** The edit form, in edit mode */
		children?: Snippet;
	}

	let { device, folders, editing, children }: Props = $props();

	/** A technical name, the same in every language */
	const UUID = 'UUID';
	const raw = $derived(device as Record<string, unknown>);
	const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
	const identity = $derived(identityOf(device));
	const load = $derived(currentLoad(device));
	const conn = $derived(connectionModeOf(device, can));
	const ban = $derived(banLine(device));
	const sysVersion = $derived(text((device.sysinfo as Record<string, unknown> | null | undefined)?.version));
	const uuid = $derived(text(raw.uuid));
	const capabilities = $derived(
		Array.isArray(identity.capabilities) ? identity.capabilities.map(text).filter(Boolean).join(', ') : ''
	);
	const tier = $derived(String(device.status_tier ?? '').toLowerCase());
	const folderName = $derived.by(() => {
		if (!device.folder_id) return t('folders.unassigned');
		const f = folders?.find((x) => Number(x.id) === Number(device.folder_id));
		return f ? f.name : `#${device.folder_id}`;
	});
	const groupNames = $derived((device.groups ?? []).map((g) => g.name || g.guid));

	const credentialLabel: Record<string, string> = {
		saved: 'devices.remote_save_password',
		prompt: 'devices.remote_prompt_password',
		none: 'devices.remote_no_password'
	};
	const tlsLabel: Record<string, string> = {
		required: 'devices.remote_tls_required',
		preferred: 'devices.remote_tls_preferred',
		disabled: 'devices.remote_tls_disabled'
	};
	const keyed = (map: Record<string, string>, v: unknown) => {
		const k = map[text(v)];
		return k ? t(k) : text(v);
	};

	const loadFacts = $derived<Fact[]>(
		load
			? [
					{ label: t('device_detail.metric_cpu'), value: cpuMeter },
					{ label: t('device_detail.metric_memory'), value: memoryMeter },
					{ label: t('device_detail.metric_disk'), value: diskMeter }
				]
			: []
	);

	const identityFacts = $derived<Fact[]>([
		{ label: t('devices.id'), value: idValue },
		...(editing ? [] : [{ label: t('devices.display_name'), value: device.display_name }]),
		{ label: t('devices.hostname'), value: device.hostname || device.note },
		{ label: t('devices.username'), value: userValue },
		...(uuid ? [{ label: UUID, value: uuidValue }] : []),
		{ label: t('devices.platform'), value: platformValue },
		...(sysVersion ? [{ label: t('device_detail.version'), value: versionValue }] : []),
		...(identity.product_sku ? [{ label: 'SKU', value: text(identity.product_sku) }] : []),
		...(identity.conn_mode
			? [{ label: t('device_detail.client_mode'), value: text(identity.conn_mode) }]
			: []),
		...(capabilities ? [{ label: t('device_detail.capabilities'), value: capabilities }] : [])
	]);

	const targetFacts = $derived<Fact[]>([
		{
			label: t('devices.remote_protocol'),
			value: text(device.remote_protocol || device.device_type).toUpperCase()
		},
		{ label: t('devices.remote_host'), value: addressValue },
		{ label: t('devices.remote_credentials'), value: keyed(credentialLabel, device.credential_mode) },
		{ label: t('devices.remote_tls'), value: keyed(tlsLabel, device.tls_mode) },
		{ label: t('devices.remote_enabled'), value: enabledValue }
	]);

	const networkFacts = $derived<Fact[]>([
		{ label: t('devices.ip_address'), value: ipValue },
		{ label: t('device_detail.folder'), value: folderName },
		...(groupNames.length ? [{ label: t('device_detail.device_groups'), value: groupsValue }] : [])
	]);

	const timeFacts = $derived<Fact[]>([
		{ label: t('devices.first_seen'), value: firstSeenValue },
		{ label: t('devices.last_seen'), value: lastSeenValue },
		...(tier && tier !== 'online' && tier !== 'offline'
			? [{ label: t('device_detail.status_tier'), value: tierValue }]
			: [])
	]);
</script>

{#snippet cpuMeter()}<span class="dp-meter"><Meter value={load?.cpu} high={70} full={90} /></span>{/snippet}
{#snippet memoryMeter()}<span class="dp-meter"><Meter value={load?.memory} high={70} full={90} /></span
	>{/snippet}
{#snippet diskMeter()}<span class="dp-meter"><Meter value={load?.disk} high={70} full={90} /></span>{/snippet}
{#snippet idValue()}<ValueCopy value={device.id} label={t('devices.id')} />{/snippet}
{#snippet uuidValue()}<ValueCopy value={uuid} label={UUID} />{/snippet}
{#snippet userValue()}<User user={device.username} />{/snippet}
{#snippet platformValue()}<Platform platform={device.platform || device.os} />{/snippet}
{#snippet versionValue()}<Version version={sysVersion} />{/snippet}
{#snippet addressValue()}<ValueCopy
		value={device.host ? `${device.host}${device.port ? `:${device.port}` : ''}` : ''}
		label={t('devices.remote_host')}
	/>{/snippet}
{#snippet enabledValue()}<BooleanStatus value={device.enabled !== false} />{/snippet}
{#snippet ipValue()}<ValueCopy value={device.ip} label={t('devices.ip_address')} />{/snippet}
{#snippet groupsValue()}<TagSet tags={groupNames} />{/snippet}
{#snippet firstSeenValue()}<Time value={device.created_at} relative={false} />{/snippet}
{#snippet lastSeenValue()}
	{#if device.last_online && formatDate(device.last_online, {}, '')}
		<Time value={device.last_online} relative={false} />
		<span class="dp-muted">(<Time value={device.last_online} />)</span>
	{:else}
		<Empty word={t('time.never')} />
	{/if}
{/snippet}
{#snippet tierValue()}<Status
		tone={tier}
		label={tier === 'degraded' || tier === 'critical' ? t(`device_detail.availability_status_${tier}`) : tier}
	/>{/snippet}

{@render children?.()}

{#if device.banned}
	<Notice tone="danger" title={t('device_detail.device_banned')} role="note">
		<p>{t(ban.key, { date: ban.at ? formatDate(ban.at) : '', user: ban.user })}</p>
		<p>
			{device.ban_reason
				? t('device_detail.ban_reason_line', { reason: device.ban_reason })
				: t('device_detail.no_reason')}
		</p>
	</Notice>
{/if}

{#if load}
	<PanelSection title={t('device_detail.section_live_metrics')}>
		<Facts items={loadFacts} />
		{#if load.updatedAt}
			<p class="dp-muted">{t('device_detail.metrics_updated')} <Time value={load.updatedAt} /></p>
		{/if}
	</PanelSection>
{/if}

<PanelSection title={t('device_detail.section_identity')}>
	<Facts items={identityFacts} />
</PanelSection>

{#if device.remote_target}
	<PanelSection title={t('devices.remote_section_connection')}>
		<Facts items={targetFacts} />
	</PanelSection>
{/if}

{#if conn.shown}
	<ConnectionMode {device} view={conn} />
{/if}

<PanelSection title={t('device_detail.section_network')}>
	<Facts items={networkFacts} />
</PanelSection>

<PanelSection title={t('device_detail.section_timestamps')}>
	<Facts items={timeFacts} />
</PanelSection>

<style>
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* Meters fill the value column up to a readable length */
	.dp-meter {
		flex: 1;
		max-width: 360px;
	}
</style>
