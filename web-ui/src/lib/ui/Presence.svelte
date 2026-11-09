<!--
  Presence: a round mark for a person's status. Green online, yellow away,
  red busy, a grey ring offline. Next to the status word it is decorative;
  standing alone, pass `label` (the status word, translated) and it is
  announced as an image with that name. Avatar's `presence` prop puts it
  on the avatar's corner.
-->
<script lang="ts">
	import type { Presence } from '#lib/state/presence.svelte.ts';

	let { status, label }: { status: Presence; label?: string } = $props();
</script>

{#if label}
	<span class="presence is-{status}" role="img" aria-label={label} title={label}></span>
{:else}
	<span class="presence is-{status}" aria-hidden="true"></span>
{/if}

<style>
	.presence {
		display: inline-block;
		flex-shrink: 0;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--text-muted);
		vertical-align: middle;
	}
	.is-online {
		background: var(--success);
	}
	.is-away {
		background: var(--presence-away, var(--warning));
	}
	.is-busy {
		background: var(--danger);
	}
	.is-offline {
		background: transparent;
		box-shadow: inset 0 0 0 2px var(--text-muted);
	}
	@media (forced-colors: active) {
		.presence {
			forced-color-adjust: none;
			border: 1px solid CanvasText;
		}
	}
</style>
