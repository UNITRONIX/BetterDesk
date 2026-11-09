<!-- A rule between groups of items in a Menu -->
<script lang="ts">
	let { class: cls = '' }: { class?: string } = $props();
</script>

<div class={['menu-divider', cls]} role="separator"></div>

<style>
	.menu-divider {
		height: 0;
		margin: var(--space-1) 0;
		border-top: 1px solid var(--rule);
	}
</style>
