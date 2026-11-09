<!--
  An on/off setting as a status: "On" (good) or "Off" (neutral), never
  true/false. `on` / `off` change the words ("Enabled", "Allowed").
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Status from './Status.svelte';

	let { value, on, off }: { value: unknown; on?: string; off?: string } = $props();
</script>

<Status
	tone={value ? 'good' : 'neutral'}
	label={value ? (on ?? tf('common.on', 'On')) : (off ?? tf('common.off', 'Off'))}
/>
