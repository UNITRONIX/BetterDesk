<!--
  A Material Symbols glyph. Decorative by default (aria-hidden): the text
  next to it carries the meaning. `name` is a meaning from ICONS (ban,
  connect, copy ...) or a glyph name.
-->
<script lang="ts">
	import { iconName } from '#lib/util/display.ts';

	let { name, class: cls = '' }: { name: string; class?: string } = $props();
</script>

<span class={['material-icons', cls]} aria-hidden="true">{iconName(name)}</span>
