<!--
  Device identity (/attestation): the hardware fingerprint each device
  reports, its status and last check, with a count line and the share of
  verified, waiting and problem devices. Each row: Mark as verified, and a
  menu with Copy fingerprint and Revoke (both asking first where they
  change something).

  The server can't receive fingerprints yet (BUGS.md P5): while the list is
  empty, a notice says so and what the page will show.

  Who: the four admin roles (requireAdmin).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listAttestation, setAttestationStatus, type AttestationRecord } from '#lib/api/attestation.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { isAdminRole } from '#lib/rules/access.ts';
	import {
		attStatus,
		canRevoke,
		canVerify,
		countGroups,
		fingerprintOf,
		sortRecords
	} from '#lib/rules/attestation.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { copyText } from '#lib/ui/clipboard.svelte.ts';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	$effect(() => setPageTitle(t('nav.attestation')));
	const allowed = $derived(isAdminRole(session.user?.role));

	let records = $state.raw<AttestationRecord[]>([]);
	let loaded = $state(false);
	let failed = $state(false);

	async function load() {
		try {
			records = sortRecords(await listAttestation());
			failed = false;
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	}

	$effect(() => {
		if (allowed) untrack(() => void load());
	});
	$effect(() => onRefresh(() => void load()));

	const groups = $derived(countGroups(records));
	const share = $derived([
		{ value: groups.failed, label: t('attestation.legend_failed'), tone: 'danger' as const },
		{ value: groups.pending, label: t('attestation.legend_pending'), tone: 'warning' as const },
		{ value: groups.verified, label: t('attestation.legend_verified'), tone: 'ok' as const }
	]);

	let menuFor = $state<string | null>(null);
	const keyOf = (r: AttestationRecord) => r.device_id || r.hostname || fingerprintOf(r);

	async function verify(r: AttestationRecord) {
		const ok = await confirm({
			title: t('attestation.confirm_verify_title', { device: r.device_id }),
			message: t('attestation.confirm_verify_message'),
			confirmLabel: t('attestation.mark_verified'),
			confirmIcon: ICONS.approve
		});
		if (!ok) return;
		try {
			await setAttestationStatus(r.device_id, 'verified');
			toast.success(t('attestation.verify_success'));
			void load();
		} catch (err) {
			toast.error(`${t('attestation.verify_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		}
	}

	async function revoke(r: AttestationRecord) {
		const ok = await confirm({
			title: t('attestation.confirm_revoke_title', { device: r.device_id }),
			message: t('attestation.confirm_revoke_message'),
			confirmLabel: t('attestation.revoke_confirm'),
			confirmIcon: ICONS.revoke,
			danger: true
		});
		if (!ok) return;
		try {
			await setAttestationStatus(r.device_id, 'revoked');
			toast.success(t('attestation.revoke_success'));
			void load();
		} catch (err) {
			toast.error(`${t('attestation.revoke_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		}
	}

	async function copyFingerprint(r: AttestationRecord) {
		if (await copyText(fingerprintOf(r))) toast.success(t('common.copied'));
		else toast.error(t('attestation.copy_failed'));
	}

	const columns = $derived<Column<AttestationRecord>[]>([
		{
			id: 'device',
			label: t('attestation.col_device_short'),
			cell: deviceCell,
			sortValue: (r) => r.device_id
		},
		{ id: 'fingerprint', label: t('attestation.col_fingerprint'), cell: fingerprintCell, class: 'col-fp' },
		{ id: 'status', label: t('attestation.col_status'), cell: statusCell },
		{ id: 'last', label: t('attestation.col_last_check'), cell: lastCell, sortValue: (r) => r.last_check },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet deviceCell(r: AttestationRecord)}{#if r.device_id}<ValueCopy value={r.device_id} />{:else}<Empty
		/>{/if}{#if r.hostname}<span class="cell-sub">{r.hostname}</span>{/if}{/snippet}
{#snippet fingerprintCell(r: AttestationRecord)}{#if fingerprintOf(r)}<ValueCopy
			value={fingerprintOf(r)}
			label={t('attestation.col_fingerprint')}
		/>{:else}<Empty />{/if}{/snippet}
{#snippet statusCell(r: AttestationRecord)}{@const s = attStatus(r.status)}<Status
		tone={s.tone}
		label={t(s.labelKey)}
	/>{/snippet}
{#snippet lastCell(r: AttestationRecord)}<Time value={r.last_check} />{/snippet}
{#snippet actionsCell(r: AttestationRecord)}{#if canVerify(r)}<Button
			size="sm"
			icon={ICONS.approve}
			onclick={() => void verify(r)}>{t('attestation.mark_verified')}</Button
		>{/if}<MenuButton
		kebab
		label={t('attestation.actions_for', { device: r.device_id || r.hostname })}
		bind:open={
			() => menuFor === keyOf(r), (v) => (menuFor = v ? keyOf(r) : menuFor === keyOf(r) ? null : menuFor)
		}
	>
		<MenuItem icon={ICONS.copy} disabled={!fingerprintOf(r)} onselect={() => void copyFingerprint(r)}
			>{t('attestation.copy_fingerprint')}</MenuItem
		>
		{#if canRevoke(r)}
			<MenuDivider />
			<MenuItem icon={ICONS.revoke} danger onselect={() => void revoke(r)}>{t('attestation.revoke')}</MenuItem
			>
		{/if}
	</MenuButton>{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide att-page">
		<div class="page-head">
			<h1>{t('nav.attestation')}</h1>
			<p class="page-description">{t('attestation.page_description')}</p>
		</div>

		<section class="section" aria-labelledby="att-list-title">
			<h2 id="att-list-title" class="sr-only">{t('nav.attestation')}</h2>
			{#if !loaded}
				<States kind="loading" message={t('attestation.loading')} />
			{:else if failed}
				<States kind="error" message={t('attestation.load_error')} onretry={() => void load()} />
			{:else if !records.length}
				<!-- No records: why the list is empty and what will show here -->
				<div class="att-empty">
					<Notice message={t('attestation.unavailable_note')} />
					<p class="muted">{t('attestation.empty_how')}</p>
				</div>
			{:else}
				<CountLine
					text={t(records.length === 1 ? 'attestation.count_one' : 'attestation.count_many')}
					values={{ count: records.length }}
				/>
				<ShareBar parts={share} label={t('nav.attestation')} />
				<Table rows={records} {columns} key={keyOf} label={t('nav.attestation')} />
			{/if}
		</section>
	</div>
{/if}

<style>
	.att-empty {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: var(--measure);
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	.att-page :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* A fingerprint stays on one line, cut off with an ellipsis; Copy takes the whole value */
	.att-page :global(td.col-fp) {
		max-width: 28ch;
	}
</style>
