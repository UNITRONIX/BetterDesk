<!--
  A named group of fields in a sheet or dialog form (components.css
  .form-section): a section labelled by its h3.form-section-title. The
  first fields of the form stay plain; sections after them sit under a
  rule. Fields inside are one gap apart, also when a ShowWhen block is
  hidden. Put sections straight in the <form> (a block, not a flex box):
  the spacing relies on normal margins.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		id?: string;
		class?: string;
		children: Snippet;
	}

	let { title, id: givenId, class: cls = '', children }: Props = $props();

	const uid = $props.id();
	const titleId = $derived(`${givenId ?? `section-${uid}`}-title`);
</script>

<section class={['form-section', cls]} id={givenId} aria-labelledby={titleId}>
	<h3 class="form-section-title" id={titleId}>{title}</h3>
	{@render children()}
</section>

<style>
	.form-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
		margin: 0 0 var(--space-4);
	}
	.form-section:last-child {
		margin-bottom: 0;
	}
	/* After other fields: a rule above. The margin collapses with the field's
	   own space-4, leaving space-4 + space-2 as in components.css .form-stack */
	.form-section:not(:first-child) {
		margin-top: calc(var(--space-4) + var(--space-2));
		padding-top: var(--space-5);
		border-top: 1px solid var(--rule);
	}
	.form-section > :global(.form-group),
	.form-section > :global(.show-when) {
		margin: 0;
	}
	/* The title sits closer to its fields than the fields to each other */
	.form-section-title {
		margin: 0 0 calc(var(--space-2) - var(--space-4));
		font-size: var(--text-md);
		font-weight: 600;
		line-height: 1.3;
	}
</style>
