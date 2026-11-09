<!--
  A person's name (GUIDE section 10). `avatar` adds the avatar box before
  it, only where people are the subject of the list (users, members, who is
  signed in). user: a name or a user object ({ id, username, display_name,
  first_name, last_name, has_avatar, avatar_version }); the name shown is
  display_name, else first and last name, else username. picture, size,
  presence and presenceLabel go to the Avatar. No name gives Empty.
-->
<script lang="ts">
	import type { Presence } from '#lib/state/presence.svelte.ts';
	import { displayName, type PersonLike } from '#lib/util/display.ts';
	import Avatar from './Avatar.svelte';
	import Empty from './Empty.svelte';

	interface Props {
		user: PersonLike | string | null | undefined;
		avatar?: boolean;
		picture?: string;
		size?: 'sm' | 'md' | 'lg';
		presence?: Presence;
		presenceLabel?: string;
		empty?: string;
	}

	let { user, avatar = false, picture, size, presence, presenceLabel, empty }: Props = $props();
	const name = $derived(displayName(user));
</script>

{#if !name}
	<Empty word={empty} />
{:else if avatar}
	<span class="user"
		><Avatar {user} {picture} {size} {presence} {presenceLabel} /><span class="user-name">{name}</span></span
	>
{:else}
	<span class="user-name">{name}</span>
{/if}

<style>
	.user {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	/* Names people type: direction marks in them stay inside the name */
	.user-name {
		unicode-bidi: isolate;
	}
</style>
