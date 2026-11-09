<!--
  An on/off setting (components.css "Switches render as plain checkboxes").
  The old console marks it up as a plain checkbox with .toggle-switch and no
  switch role, so it is a Checkbox: same label, hint and keyboard (Space
  toggles). Props are Checkbox's.
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import Checkbox from './Checkbox.svelte';

	type Props = Omit<ComponentProps<typeof Checkbox>, 'inputClass'>;

	let { checked = $bindable(false), element = $bindable(null), ...rest }: Props = $props();
</script>

<Checkbox bind:checked bind:element inputClass="toggle-switch" {...rest} />
