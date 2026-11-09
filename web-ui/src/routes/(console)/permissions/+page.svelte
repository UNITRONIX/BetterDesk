<!--
  Roles and permissions (/permissions, super admins only, as the server
  requires since commit 024540ff). Pick a role, then allow or deny each
  permission: every change is saved right away as an override, the row
  says "Saving…", then "Saved" or why it failed. Changed permissions are
  marked with words and can be reset one by one, or all at once from the
  danger zone. Super admin roles always have everything (a note says so).

  URL: ?role= opens that role and follows the picker.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import {
		clearOverride,
		listOverrides,
		listRoles,
		roleEffective,
		setOverride,
		type RoleInfo,
		type RoleOverride
	} from '#lib/api/roles.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		categoryLabel,
		overrideMap,
		permissionGroups,
		permLabel,
		pickRole
	} from '#lib/people/permissions.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import DangerZone from '#lib/ui/DangerZone.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Switch from '#lib/ui/Switch.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	const allowed = session.isSuperAdmin;

	let roles = $state.raw<RoleInfo[]>([]);
	let all = $state.raw<string[]>([]);
	let overrides = $state.raw<RoleOverride[]>([]);
	let effective = $state.raw(new Set<string>());
	let phase = $state<'loading' | 'ok' | 'error'>('loading');
	let role = $state('');
	/** Per permission: what its row says after a change */
	const rowStatus = new SvelteMap<string, { text: string; tone: '' | 'ok' | 'error' }>();
	const busy = new SvelteMap<string, boolean>();
	let resetting = $state(false);

	const current = $derived(roles.find((r) => r.name === role) ?? null);
	const changed = $derived(overrideMap(overrides, role));
	const groups = $derived(permissionGroups(all));
	const defaults = $derived(new Set(current?.permissions ?? []));

	function roleLabel(name: string): string {
		const key = `users.role_${name}`;
		return t(key) === key ? name : t(key);
	}

	async function loadRole(name: string) {
		const [perms, ovr] = await Promise.all([roleEffective(name), listOverrides()]);
		if (name !== role) return;
		effective = new Set(perms);
		overrides = ovr;
	}

	async function load() {
		phase = 'loading';
		try {
			const [r, ovr] = await Promise.all([listRoles(), listOverrides()]);
			roles = r.roles;
			all = r.all;
			overrides = ovr;
			role = pickRole(
				r.roles,
				untrack(() => page.url.searchParams.get('role'))
			);
			if (role) await loadRole(role);
			phase = 'ok';
		} catch {
			phase = 'error';
		}
	}

	$effect(() => {
		if (!allowed) return;
		untrack(() => void load());
		return onRefresh(() => void load());
	});

	async function selectRole(name: string) {
		role = name;
		rowStatus.clear();
		const url = new URL(location.href);
		url.searchParams.set('role', name);
		// This page's own address with another ?role=
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, page.state);
		try {
			await loadRole(name);
		} catch {
			phase = 'error';
		}
	}

	/** Save one change, read the role again, keep focus on the control that was used */
	async function change(perm: string, work: () => Promise<unknown>, done: string, focus: 'toggle' | 'reset') {
		busy.set(perm, true);
		rowStatus.set(perm, { text: t('permissions.saving'), tone: '' });
		try {
			await work();
			await loadRole(role);
			rowStatus.set(perm, { text: done, tone: 'ok' });
		} catch (err) {
			rowStatus.set(perm, {
				text: `${t('permissions.save_failed')} ${err instanceof Error ? err.message : ''}`.trim(),
				tone: 'error'
			});
		} finally {
			busy.delete(perm);
		}
		await tick();
		const row = document.querySelector(`[data-perm="${CSS.escape(perm)}"]`);
		const target =
			(focus === 'reset' ? row?.querySelector<HTMLElement>('.perm-reset') : null) ??
			row?.querySelector<HTMLElement>('input');
		if (target && !row?.contains(document.activeElement)) target.focus({ preventScroll: true });
	}

	function toggle(perm: string, granted: boolean) {
		void change(perm, () => setOverride(role, perm, granted), t('permissions.saved'), 'toggle');
	}

	function resetOne(perm: string) {
		void change(perm, () => clearOverride(role, perm), t('permissions.reverted'), 'toggle');
	}

	async function resetAll() {
		if (!current) return;
		const list = overrides.filter((o) => o.role === role);
		if (!list.length) return;
		const ok = await confirm({
			title: t('permissions.reset_overrides'),
			message: t('permissions.confirm_reset_named', { role: roleLabel(role) }),
			confirmLabel: t('permissions.reset_overrides'),
			confirmIcon: ICONS.reset,
			danger: true
		});
		if (!ok) return;
		resetting = true;
		try {
			for (const o of list) await clearOverride(role, o.permission);
			toast.success(t('permissions.all_reverted'));
		} catch (err) {
			toast.error(`${t('permissions.save_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		} finally {
			resetting = false;
		}
		rowStatus.clear();
		try {
			await loadRole(role);
		} catch {
			phase = 'error';
		}
	}

	const roleOptions = $derived(roles.map((r) => ({ value: r.name, label: roleLabel(r.name) })));
	const summary = $derived.by(() => {
		if (!current) return '';
		const parts = [t('permissions.level_n', { level: current.level })];
		if (current.is_super_admin) parts.push(t('permissions.tag_full_access'));
		else if (current.is_server_level) parts.push(t('permissions.tag_server_wide'));
		return `${parts.join(', ')}.`;
	});
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide permissions-page">
		<div class="page-head">
			<h1>{t('nav.permissions')}</h1>
			<p class="page-description">{t('permissions.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				{#if phase === 'loading'}
					<States kind="loading" message={t('permissions.loading')} />
				{:else if phase === 'error'}
					<States kind="error" message={t('permissions.load_failed')} onretry={() => void load()} />
				{:else if !current}
					<States message={t('permissions.empty_desc')} />
				{:else if current.is_super_admin}
					<Notice message={t('permissions.locked_desc')} />
				{:else}
					<div class="matrix">
						{#each groups as g (g.id)}
							<section class="section group" aria-labelledby="perm-cat-{g.id}">
								<h2 id="perm-cat-{g.id}">{categoryLabel(g.id, t)}</h2>
								<ul class="perm-list">
									{#each g.permissions as perm (perm)}
										{@const isChanged = changed.has(perm)}
										{@const st = rowStatus.get(perm)}
										<li class={['perm-row', isChanged && 'is-changed']} data-perm={perm}>
											<Switch
												class="perm-switch"
												label={permLabel(perm, t)}
												hint={perm}
												checked={effective.has(perm)}
												disabled={busy.has(perm)}
												onchange={(e) => toggle(perm, (e.currentTarget as HTMLInputElement).checked)}
											/>
											<span class="row-end">
												<span class={['perm-status', st?.tone && `is-${st.tone}`]} aria-live="polite"
													>{st?.text ?? ''}</span
												>
												{#if isChanged}
													<span class="perm-changed"
														>{defaults.has(perm)
															? t('permissions.changed_default_on')
															: t('permissions.changed_default_off')}</span
													>
													<Button
														class="perm-reset"
														variant="link"
														size="sm"
														disabled={busy.has(perm)}
														aria-label={t('permissions.reset_one', { name: permLabel(perm, t) })}
														onclick={() => resetOne(perm)}>{t('permissions.reset')}</Button
													>
												{/if}
											</span>
										</li>
									{/each}
								</ul>
							</section>
						{/each}
					</div>
				{/if}
			</div>

			<aside class="page-side is-sticky" aria-labelledby="perm-role-title">
				<section class="section" aria-labelledby="perm-role-title">
					<h2 id="perm-role-title" class="sr-only">{t('permissions.select_role')}</h2>
					{#if roles.length}
						<Field label={t('permissions.select_role')}>
							{#snippet children(f)}
								<Select
									{...f}
									options={roleOptions}
									value={role}
									onchange={(e) => void selectRole((e.currentTarget as HTMLSelectElement).value)}
								/>
							{/snippet}
						</Field>
					{/if}
					{#if current}
						<div class="role-info" aria-live="polite">
							{#if t(`users.role_desc_${current.name}`) !== `users.role_desc_${current.name}`}
								<p>{t(`users.role_desc_${current.name}`)}</p>
							{/if}
							<div class="role-summary">
								<p>{summary}</p>
								{#if !current.is_super_admin}
									<CountLine
										text={t('permissions.role_summary')}
										values={{ granted: effective.size, total: all.length, changed: changed.size }}
									/>
								{/if}
							</div>
						</div>
					{/if}
				</section>

				{#if current && !current.is_super_admin}
					<DangerZone
						title={t('permissions.danger_title')}
						rows={[
							{
								title: t('permissions.reset_overrides'),
								consequence: t('permissions.reset_overrides_desc'),
								action: t('permissions.reset_overrides_button'),
								onclick: () => void resetAll(),
								disabled: changed.size === 0,
								busy: resetting
							}
						]}
					/>
				{/if}
			</aside>
		</div>
	</div>
{/if}

<style>
	/* Groups flow down two or three columns on wide screens; a group is never
	   split, and the reading order is column by column */
	.matrix {
		columns: 3 340px;
		column-gap: var(--space-7);
	}
	.group {
		break-inside: avoid;
		margin-bottom: var(--space-6);
	}
	.perm-list {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.perm-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.perm-row :global(.check-field) {
		flex: 1 1 260px;
		min-width: 0;
	}
	.perm-row :global(.check-field .form-hint) {
		font-family: var(--mono);
	}
	.row-end {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-1) var(--space-3);
		margin-inline-start: auto;
	}
	.perm-status:empty {
		display: none;
	}
	.perm-status.is-ok {
		color: var(--success);
	}
	.perm-status.is-error {
		color: var(--danger);
	}
	/* A change is marked with words, not only a colour */
	.perm-changed {
		color: var(--text);
		font-weight: 600;
	}
	.role-info {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.role-info p {
		margin: 0;
	}
	.role-info > p:first-child {
		color: var(--text-muted);
	}
	@media (pointer: coarse) {
		.perm-row :global(.perm-reset) {
			min-height: 44px;
		}
	}
	/* One column: the role picker first (it decides what the list shows),
	   the permission groups next, the reset at the end */
	@media (max-width: 1199px) {
		.permissions-page .page-side {
			display: contents;
		}
		.permissions-page .page-side > :global(.section) {
			order: -1;
		}
		.permissions-page .page-side > :global(.danger-zone) {
			order: 1;
		}
	}
</style>
