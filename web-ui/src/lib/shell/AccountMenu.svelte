<!--
  Account menu (views/partials/user-menu.ejs, public/js/app.js): the
  signed-in person with picture or initials and their status dot, then My
  status (online, away, busy), Change password, Two-factor sign-in and
  Sign out.

  place "sidebar": the sidebar footer button (avatar, name, role); the
  menu opens upwards there. place "topbar": the top bar button below
  1100 px, where the sidebar is a drawer.
-->
<script lang="ts">
	import { t, tf, has } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { session, clearSession } from '#lib/state/session.svelte.ts';
	import { myPresence, setPresence, PRESENCE_VALUES } from '#lib/state/presence.svelte.ts';
	import Avatar from '#lib/ui/Avatar.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Presence from '#lib/ui/Presence.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import RadioItem from './RadioItem.svelte';
	import { logout } from './api.ts';
	import { broadcastExpired, stopGuard } from './session-guard.svelte.ts';

	let { place = 'sidebar' }: { place?: 'sidebar' | 'topbar' } = $props();

	const uid = $props.id();
	let open = $state(false);
	let button = $state<HTMLButtonElement | null>(null);

	const user = $derived(session.user);
	const person = $derived(
		user ? { id: user.id, username: user.username, avatar_version: user.avatarVersion } : null
	);
	const name = $derived(user?.username ?? '');
	const role = $derived.by(() => {
		const r = user?.role ?? '';
		if (!r) return '';
		const key = `users.role_${r}`;
		if (has(key)) return t(key);
		const words = r.replace(/_/g, ' ');
		return words.charAt(0).toUpperCase() + words.slice(1);
	});
	const statusLabel = (s: string) => t(`chat.presence_${s}`);

	function toggle() {
		open = !open;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
		}
	}

	function onclose(returnFocus: boolean) {
		if (returnFocus) button?.focus();
	}

	async function signOut() {
		const label = t('user_menu.sign_out');
		const ok = await confirm({ title: label, message: t('auth.logout_confirm'), confirmLabel: label });
		if (!ok) return;
		try {
			await logout();
		} catch {
			toast.error(t('errors.logout_failed'));
			return;
		}
		// The other tabs leave too; this one forgets everything and goes to sign-in
		stopGuard();
		broadcastExpired('logout');
		clearSession();
		location.assign('/login');
	}
</script>

<span class={['account', `is-${place}`]}>
	{#if place === 'sidebar'}
		<button
			bind:this={button}
			type="button"
			class="account-btn"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? `${uid}-menu` : undefined}
			onclick={toggle}
			{onkeydown}
		>
			<Avatar user={person} size="md" presence={myPresence.status} />
			<span class="account-text">
				<span class="account-name">{name}</span>
				{#if role}<span class="account-role">{role}</span>{/if}
				<span class="sr-only">{statusLabel(myPresence.status)}</span>
			</span>
			<Icon name={open ? 'expand_more' : 'expand_less'} class="account-chevron" />
		</button>
	{:else}
		<button
			bind:this={button}
			type="button"
			class="account-icon-btn"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? `${uid}-menu` : undefined}
			title={name}
			onclick={toggle}
			{onkeydown}
		>
			<Avatar user={person} presence={myPresence.status} />
			<!-- The name, not the initials on the picture, names the button -->
			<span class="sr-only">{name}, {statusLabel(myPresence.status)}</span>
		</button>
	{/if}
	<Menu
		bind:open
		anchor={button}
		align={place === 'sidebar' ? 'start' : 'end'}
		id={`${uid}-menu`}
		label={tf('user_menu.label', 'Account')}
		class="account-menu"
		{onclose}
	>
		<!-- The name is on the button already; this repeats it for the eye -->
		<div class="account-person" aria-hidden="true">
			<Avatar user={person} size="md" presence={myPresence.status} />
			<span class="account-text">
				<span class="account-name">{name}</span>
				{#if role}<span class="account-role">{role}</span>{/if}
			</span>
		</div>
		<div role="group" aria-labelledby={`${uid}-status`}>
			<div class="menu-label" id={`${uid}-status`}>{t('chat.my_presence')}</div>
			{#each PRESENCE_VALUES as s (s)}
				<RadioItem checked={myPresence.status === s} onselect={() => setPresence(s)}>
					{#snippet lead()}<span class="status-dot"><Presence status={s} /></span>{/snippet}
					{statusLabel(s)}
				</RadioItem>
			{/each}
		</div>
		<MenuDivider />
		<MenuItem icon="key" href={link('/settings')}>{t('auth.change_password')}</MenuItem>
		<MenuItem icon="verified_user" href={link('/settings?tab=auth')}>{t('nav.account_2fa')}</MenuItem>
		<MenuDivider />
		<MenuItem icon="logout" onselect={signOut}>{t('user_menu.sign_out')}</MenuItem>
	</Menu>
</span>

<style>
	.account {
		position: relative;
		display: block;
	}
	.account.is-topbar {
		display: inline-flex;
	}
	/* The dot on the avatar is ringed in the surface it sits on */
	.account-btn {
		--presence-ring: var(--bg-subtle);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		width: calc(100% + 2 * var(--space-2));
		min-height: var(--control-h);
		margin-inline: calc(-1 * var(--space-2));
		padding: var(--space-1) var(--space-2);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.account-btn:hover,
	.account-btn[aria-expanded='true'] {
		--presence-ring: var(--hover);
		background: var(--hover);
	}
	.account-icon-btn {
		--presence-ring: var(--bg);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--control-h);
		height: var(--control-h);
		padding: 0;
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		cursor: pointer;
	}
	.account-icon-btn:hover,
	.account-icon-btn[aria-expanded='true'] {
		--presence-ring: var(--hover);
		background: var(--hover);
	}
	.account-text {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}
	.account-name {
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.account-role {
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.account-btn > :global(.account-chevron) {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: 18px;
	}
	.account :global(.menu.account-menu) {
		--presence-ring: var(--bg-float);
		width: max-content;
		min-width: 220px;
		max-width: min(320px, calc(100vw - 2 * var(--space-3)));
	}
	.account-person {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.menu-label {
		padding: var(--space-2) var(--space-3) var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* The status dot where menu icons go (20 px box) */
	.status-dot {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 20px;
	}
	@media (pointer: coarse) {
		.account-btn,
		.account-icon-btn {
			min-height: 44px;
		}
		.account-icon-btn {
			width: 44px;
			height: 44px;
		}
	}
</style>
