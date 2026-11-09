<!--
  The layout of a system settings tab (settings.css "Settings page
  layout"): forms in the main column, what is in use now in a sticky side
  column beside them from 1200 px (under them before that).

  formSide: a tab that is one form (Email, Time zones) keeps the form at
  its measure and gives the rest of the width to the side column.

  Classes for the snippets' markup:
  - .settings-grid: independent sections side by side once the main column
    has room for two (880 px), one under the other before that
  - .settings-stack: one column of sections inside the grid
  - .settings-side-grid: side sections in two columns once the side has
    room (720 px, formSide only)
  - .settings-inline-controls: buttons and a status on one wrapping row
  - .settings-subfields: fields that belong to the control above them
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		formSide?: boolean;
		/** Accessible name of the side column */
		sideLabel: string;
		main: Snippet;
		side?: Snippet;
	}

	let { formSide = false, sideLabel, main, side }: Props = $props();
</script>

<div class={['page-cols', 'settings-cols', formSide && 'is-form-side']}>
	<div class="page-main">{@render main()}</div>
	{#if side}
		<aside class="page-side is-sticky settings-side" aria-label={sideLabel}>{@render side()}</aside>
	{/if}
</div>

<style>
	.settings-cols > .page-main {
		gap: var(--space-6);
		container: settings-main / inline-size;
	}

	.settings-cols :global(.settings-grid) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6) var(--space-7);
		align-items: start;
	}

	.settings-cols :global(.settings-stack) {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}

	@container settings-main (min-width: 880px) {
		.settings-cols :global(.settings-grid) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	.settings-cols :global(.settings-side-grid) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6) var(--space-7);
		align-items: start;
	}

	@media (min-width: 1200px) {
		.settings-cols.is-form-side {
			grid-template-columns: minmax(0, var(--measure)) minmax(280px, 1fr);
		}

		.settings-cols.is-form-side > .page-side {
			container: settings-side / inline-size;
		}
	}

	@container settings-side (min-width: 720px) {
		.settings-cols :global(.settings-side-grid) {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	/* The side column is narrow: labels take what they need, values the rest */
	@media (min-width: 641px) {
		.settings-side :global(.facts) {
			grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
		}

		.settings-side :global(.facts > dt) {
			max-width: 160px;
		}
	}

	/* Facts and notices keep the width of the forms around them */
	.settings-cols :global(.facts),
	.settings-cols :global(.notice) {
		max-width: var(--measure);
	}

	.settings-cols :global(:is(section, form, details)[id]) {
		scroll-margin-top: calc(var(--topbar-h) + var(--space-4));
	}

	.settings-cols :global(.form-column) {
		max-width: var(--measure);
	}

	.settings-cols :global(.form-column > :is(.check-field, .notice, .disclosure, .field-effect, .form-hint)) {
		margin-bottom: var(--space-3);
	}

	.settings-cols :global(.form-column > .check-field + .check-field) {
		margin-top: calc(-1 * var(--space-1));
	}

	.settings-cols :global(.settings-subfields) {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.settings-cols :global(.settings-subfields .form-group) {
		margin-bottom: 0;
	}

	.settings-cols :global(.settings-inline-controls) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}

	.settings-cols :global(fieldset) {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.settings-cols :global(legend) {
		padding: 0;
	}

	/* What happens after a change (components.css .field-effect) */
	.settings-cols :global(.field-effect) {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.settings-cols :global(.field-effect.is-restart) {
		color: var(--warning);
	}

	/* A value with where it comes from under it */
	.settings-cols :global(.side-value) {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.settings-cols :global(.side-sub) {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* Long IDs and keys wrap instead of widening the page */
	.settings-cols :global(.facts code) {
		overflow-wrap: anywhere;
		word-break: break-all;
	}
</style>
