<!--
  Fields that only apply to a choice (GUIDE section 11). The block stays in
  the DOM with the `hidden` attribute while the choice is off, and comes
  right after the control that shows it. That control points at it:

    import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';

    <Checkbox label={...} bind:checked={form.values.proxy} {...showWhenControl('proxy-fields', form.values.proxy)} />
    <ShowWhen id="proxy-fields" when={form.values.proxy}>...fields...</ShowWhen>

  showWhenControl gives aria-controls and aria-expanded, for a checkbox or a
  button. A select or a radio takes only aria-controls (pass expanded:
  false): aria-expanded means something else on those. Fields inside keep
  one gap, and a hidden block takes no room and no gap.
-->
<script module lang="ts">
	export interface ShowWhenControlProps {
		'aria-controls': string;
		'aria-expanded'?: boolean;
	}

	/** Attributes for the control that shows the block with this id */
	export function showWhenControl(
		id: string,
		shown: boolean,
		opts: { expanded?: boolean } = {}
	): ShowWhenControlProps {
		return opts.expanded === false
			? { 'aria-controls': id }
			: { 'aria-controls': id, 'aria-expanded': shown };
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The id the controlling input points at with aria-controls */
		id: string;
		when: boolean;
		class?: string;
		children: Snippet;
	}

	let { id, when, class: cls = '', children }: Props = $props();
</script>

<div {id} class={['show-when', cls]} hidden={!when}>
	{@render children()}
</div>

<style>
	.show-when {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		margin-bottom: var(--space-4);
	}
	.show-when:last-child {
		margin-bottom: 0;
	}
	.show-when > :global(.form-group) {
		margin: 0;
	}
</style>
