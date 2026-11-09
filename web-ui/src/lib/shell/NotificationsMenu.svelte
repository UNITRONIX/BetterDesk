<!--
  The bell (public/js/notif-center.js): a dot when something is unread
  (the number is in the button's name), and a menu with one row per help
  request or device asking to join: the device's OS mark (or the kind's
  icon), what happened, the device, details and age. Unread rows have an
  accent rule on the start side. "Mark all read" in the head, links to
  the full lists in the foot (by permission).

  Keys: Enter, Space or ArrowDown on the bell opens it on the first row;
  arrows, Home and End move; Escape closes and returns to the bell; Tab
  closes and moves on (Menu).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { isPorted, link } from '#lib/nav.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import OsIcon from '#lib/ui/OsIcon.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { platformId } from '#lib/util/display.ts';
	import type { Notification } from './api.ts';
	import {
		describe,
		loadNotifications,
		markAllRead,
		markRead,
		notifications
	} from './notifications.svelte.ts';

	const uid = $props.id();
	let open = $state(false);
	let bell = $state<HTMLButtonElement | null>(null);
	let list = $state<HTMLElement | null>(null);

	const count = $derived(notifications.unread);
	const label = $derived(
		count > 0 ? `${t('notifications.title')} (${count > 99 ? '99+' : count})` : t('notifications.title')
	);
	const rows = $derived(notifications.items.map((item) => ({ item, view: describe(item) })));
	const showHelpLink = $derived(can('device.view'));
	const showRegLink = $derived(can('enrollment.approve'));

	function firstRow(): HTMLElement | null {
		return list?.querySelector<HTMLElement>('.notif-row') ?? null;
	}

	function show() {
		if (open) return;
		open = true;
		void loadNotifications().catch(() => {});
		// Menu puts focus on itself; the first row is where the old menu started
		queueMicrotask(() => firstRow()?.focus());
	}

	function onclick() {
		if (open) {
			open = false;
			bell?.focus();
		} else show();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' && !open) {
			e.preventDefault();
			show();
		}
	}

	function onclose(returnFocus: boolean) {
		if (returnFocus) bell?.focus();
	}

	async function onMarkAll(e: MouseEvent) {
		const hadFocus = document.activeElement === e.currentTarget;
		try {
			await markAllRead();
		} catch {
			toast.error(t('errors.try_again'));
			return;
		}
		// The button hides once nothing is unread; keep focus in the menu
		if (hadFocus) firstRow()?.focus();
	}

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

	/** Unread: mark it read first (briefly), so the request is not cut off by leaving the page */
	async function openRow(e: MouseEvent, item: Notification, href: string, target: string) {
		if (item.read || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) {
			if (!item.read) void markRead(item.id).catch(() => {});
			return;
		}
		e.preventDefault();
		await Promise.race([markRead(item.id).catch(() => {}), sleep(600)]);
		open = false;
		if (isPorted(target)) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- link() adds the base
			await goto(href);
		} else location.assign(href);
	}

	function retry(e: MouseEvent) {
		e.stopPropagation();
		void loadNotifications().catch(() => {});
	}
</script>

<span class="notif-anchor">
	<IconButton
		bind:element={bell}
		icon="notifications"
		{label}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${uid}-menu` : undefined}
		{onclick}
		{onkeydown}
	/>
	{#if count > 0}<span class="notif-dot" aria-hidden="true"></span>{/if}
	<Menu
		bind:open
		anchor={bell}
		align="end"
		initialFocus="menu"
		id={`${uid}-menu`}
		labelledby={`${uid}-title`}
		class="notif-menu"
		{onclose}
	>
		<div class="notif-head">
			<span class="notif-title" id={`${uid}-title`}>{t('notifications.title')}</span>
			{#if count > 0}
				<button type="button" class="notif-link" role="menuitem" tabindex="-1" onclick={onMarkAll}>
					{t('notifications.mark_all_read')}
				</button>
			{/if}
		</div>
		<div class="notif-list" bind:this={list}>
			{#if notifications.failed && !notifications.items.length}
				<p class="notif-state is-error">
					{t('notifications.load_failed')}
					<button type="button" class="notif-link" role="menuitem" tabindex="-1" onclick={retry}>
						{t('errors.try_again')}
					</button>
				</p>
			{:else if !notifications.loaded}
				<p class="notif-state">{t('notifications.loading')}</p>
			{:else if !rows.length}
				<p class="notif-state">{t('notifications.empty_hint')}</p>
			{:else}
				<ul class="notif-rows" role="none">
					{#each rows as { item, view } (item.id)}
						{@const href = link(view.link)}
						<li role="none">
							<a
								class={['notif-row', !item.read && 'is-unread']}
								{href}
								role="menuitem"
								tabindex="-1"
								onclick={(e) => openRow(e, item, href, view.link)}
							>
								<span class="notif-mark" aria-hidden="true">
									{#if view.platform && platformId(view.platform)}
										<OsIcon platform={view.platform} />
									{:else}
										<Icon name={view.isRegistration ? 'enrollment_request' : 'help_request'} />
									{/if}
								</span>
								<span class="notif-kind menu-item-label">
									{view.isRegistration
										? t('notifications.kind_registration')
										: t('notifications.help_request')}
								</span>
								{#if view.name || view.deviceId}
									<span class="notif-device">
										{#if view.name}<span class="notif-name">{view.name}</span>{/if}
										{#if view.deviceId}<span class="notif-id">{view.deviceId}</span>{/if}
									</span>
								{/if}
								{#if view.detail}<span class="notif-detail">{view.detail}</span>{/if}
								{#if item.created_at}<span class="notif-time"><Time value={item.created_at} /></span>{/if}
								{#if !item.read}<span class="sr-only">, {t('notifications.unread')}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
		{#if showHelpLink || showRegLink}
			<div class="notif-foot">
				{#if showHelpLink}
					<a class="notif-link" href={link('/help-requests')} role="menuitem" tabindex="-1">
						{t('notifications.see_all')}
					</a>
				{/if}
				{#if showRegLink}
					<a class="notif-link" href={link('/registrations')} role="menuitem" tabindex="-1">
						{t('nav.registrations')}
					</a>
				{/if}
			</div>
		{/if}
	</Menu>
</span>

<style>
	.notif-anchor {
		position: relative;
		display: inline-flex;
	}
	/* A dot; the count is in the button's name */
	.notif-dot {
		position: absolute;
		top: 6px;
		inset-inline-end: 6px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--danger);
		pointer-events: none;
	}
	/* Head and foot stay; the rows scroll */
	.notif-anchor :global(.menu.notif-menu) {
		display: flex;
		flex-direction: column;
		width: min(400px, calc(100vw - 2 * var(--space-4)));
		max-height: min(calc(100vh - var(--topbar-h) - var(--space-5)), 560px);
		padding: 0;
		overflow: hidden;
	}
	.notif-head,
	.notif-foot {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		padding: var(--space-1) var(--space-3);
	}
	.notif-head {
		justify-content: space-between;
		min-height: var(--control-h);
		border-bottom: 1px solid var(--rule);
	}
	.notif-title {
		font-weight: 600;
	}
	.notif-foot {
		border-top: 1px solid var(--rule);
	}
	.notif-link {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h);
		padding: 0 var(--space-1);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.notif-link:hover {
		color: var(--accent-hover);
	}
	.notif-link:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.notif-list {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.notif-state {
		margin: 0;
		padding: var(--space-4) var(--space-3);
		color: var(--text-muted);
	}
	.notif-state.is-error {
		color: var(--text);
	}
	.notif-rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.notif-rows > li + li {
		border-top: 1px solid var(--rule);
	}
	/* Mark | what happened, device, details | age */
	.notif-row {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		grid-template-areas:
			'mark kind time'
			'mark device device'
			'mark detail detail';
		column-gap: var(--space-3);
		row-gap: 2px;
		min-height: var(--row-h);
		padding: var(--space-2) var(--space-3);
		padding-inline-start: calc(var(--space-3) - 3px);
		border-inline-start: 3px solid transparent;
		color: var(--text);
		font-size: var(--text-sm);
		line-height: 1.4;
		text-decoration: none;
	}
	.notif-row:hover {
		background: var(--hover);
		color: var(--text);
	}
	.notif-row:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.notif-row.is-unread {
		border-inline-start-color: var(--accent);
		background: color-mix(in srgb, var(--accent) 8%, transparent);
	}
	.notif-row.is-unread:hover {
		background: color-mix(in srgb, var(--accent) 14%, transparent);
	}
	.notif-mark {
		grid-area: mark;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		color: var(--text-muted);
	}
	.notif-mark :global(.os-icon) {
		width: 20px;
		height: 20px;
		vertical-align: 0;
	}
	.notif-mark :global(.material-icons) {
		font-size: 20px;
		line-height: 1;
	}
	.notif-kind {
		grid-area: kind;
		min-width: 0;
	}
	.notif-row.is-unread .notif-kind {
		font-weight: 600;
	}
	.notif-device {
		grid-area: device;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.notif-name + .notif-id {
		margin-inline-start: var(--space-1);
	}
	.notif-id {
		color: var(--text-muted);
		font-family: var(--mono);
		font-size: var(--text-xs);
	}
	.notif-detail {
		grid-area: detail;
		display: -webkit-box;
		min-width: 0;
		overflow: hidden;
		color: var(--text-muted);
		overflow-wrap: anywhere;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
	}
	.notif-time {
		grid-area: time;
		align-self: baseline;
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-align: end;
		white-space: nowrap;
	}
	@media (pointer: coarse) {
		.notif-link {
			min-height: 44px;
		}
	}
</style>
