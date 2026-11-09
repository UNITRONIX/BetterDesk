<!--
  Avatar (GUIDE section 10): one fixed box, 24 px (size md 32, lg 48), 4 px
  corners, never round. It holds the profile picture (<img alt="">, cut to
  fill) or the initials in a colour from the name (letters and digits only,
  two at most), or a person icon when the name has neither. A picture that
  fails to load turns into the initials. Hidden from screen readers: the
  name next to it carries the meaning.
  user: a name or a user object ({ id, username, display_name, first_name,
  last_name, has_avatar, avatar_version }); its picture is used unless
  `picture` is set ('' for none). presence: puts the presence dot on the
  bottom end corner; presenceLabel names it for screen readers.
-->
<script lang="ts">
	import { i18n } from '#lib/i18n/i18n.svelte.ts';
	import type { Presence as PresenceStatus } from '#lib/state/presence.svelte.ts';
	import { avatarColor, avatarUrl, displayName, initials, type PersonLike } from '#lib/util/display.ts';
	import Icon from './Icon.svelte';
	import Presence from './Presence.svelte';

	interface Props {
		user: PersonLike | string | null | undefined;
		picture?: string;
		size?: 'sm' | 'md' | 'lg';
		presence?: PresenceStatus;
		presenceLabel?: string;
	}

	let { user, picture, size = 'sm', presence, presenceLabel }: Props = $props();

	const name = $derived(displayName(user));
	const src = $derived(picture ?? (user && typeof user === 'object' ? avatarUrl(user) : ''));
	const letters = $derived(initials(name, i18n.locale));
	const color = $derived(avatarColor(name));
	/** The picture URL that failed to load; a new URL gets a new try */
	let failed = $state('');
	const showPicture = $derived(!!src && failed !== src);
</script>

{#snippet box()}
	<span class={['avatar', size !== 'sm' && `is-${size}`, !showPicture && `is-c${color}`]} aria-hidden="true"
		>{#if showPicture}<img
				{src}
				alt=""
				loading="lazy"
				onerror={() => (failed = src)}
			/>{:else if letters}{letters}{:else}<Icon name="user" />{/if}</span
	>
{/snippet}

{#if presence}
	<span class="avatar-presence">{@render box()}<Presence status={presence} label={presenceLabel} /></span>
{:else}
	{@render box()}
{/if}

<style>
	.avatar {
		--avatar-size: 24px;
		--avatar-c: var(--text-muted);
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: var(--avatar-size);
		height: var(--avatar-size);
		overflow: hidden;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--avatar-c) 16%, var(--bg));
		color: var(--avatar-c);
		font-size: calc(var(--avatar-size) * 0.42);
		font-weight: 600;
		line-height: 1;
		vertical-align: middle;
		user-select: none;
	}
	.is-md {
		--avatar-size: 32px;
	}
	.is-lg {
		--avatar-size: 48px;
	}
	.avatar > img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	/* A picture sits on no tint */
	.avatar:has(> img) {
		background: var(--bg-subtle);
	}
	.is-c1 {
		--avatar-c: var(--avatar-1);
	}
	.is-c2 {
		--avatar-c: var(--avatar-2);
	}
	.is-c3 {
		--avatar-c: var(--avatar-3);
	}
	.is-c4 {
		--avatar-c: var(--avatar-4);
	}
	.is-c5 {
		--avatar-c: var(--avatar-5);
	}
	.is-c6 {
		--avatar-c: var(--avatar-6);
	}
	.avatar > :global(.material-icons) {
		font-size: calc(var(--avatar-size) * 0.72);
	}
	@media (forced-colors: active) {
		.avatar {
			border: 1px solid CanvasText;
		}
	}

	/* The presence dot on the bottom end corner, ringed in the surface colour
	   (--presence-ring) so it reads on top of the picture */
	.avatar-presence {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		vertical-align: middle;
	}
	.avatar-presence > :global(.presence) {
		position: absolute;
		inset-inline-end: -3px;
		bottom: -3px;
		box-shadow: 0 0 0 2px var(--presence-ring, var(--bg));
	}
	.avatar-presence > :global(.presence.is-offline) {
		background: var(--presence-ring, var(--bg));
		box-shadow:
			inset 0 0 0 2px var(--text-muted),
			0 0 0 2px var(--presence-ring, var(--bg));
	}
</style>
