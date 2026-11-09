<!--
  The device panel, mounted once by the shell. Opens whenever
  devicePanel.id is set (state/devicePanel.svelte.ts) and closes when it is
  cleared. The panel's code loads with the first device that opens, so
  pages that never open one don't download it. A different device opens a
  fresh panel (its own tabs, data and polling).
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import { devicePanel } from '#lib/state/devicePanel.svelte.ts';

	let Panel = $state<Component<{ id: string }> | null>(null);
	let failed = $state(false);

	$effect(() => {
		if (!devicePanel.id || Panel || failed) return;
		import('./DevicePanel.svelte')
			.then((m) => (Panel = m.default))
			.catch((err: unknown) => {
				failed = true;
				console.error('Could not load the device panel', err);
			});
	});
</script>

{#if devicePanel.id && Panel}
	{#key devicePanel.id}
		<Panel id={devicePanel.id} />
	{/key}
{/if}
