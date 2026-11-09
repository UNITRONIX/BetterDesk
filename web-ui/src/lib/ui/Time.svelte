<!--
  A point in time (GUIDE section 10) as <time datetime>. Relative ("3h ago")
  up to a week, with the full date and time in the tooltip and for screen
  readers; older, the date itself. The relative text refreshes once a minute
  (one shared clock, paused while the tab is hidden).
  relative={false}: the date, for expiry or "created on". format: Intl
  options for that date (e.g. { hour: undefined, minute: undefined } for the
  day only). empty: a word for no date ("Never"); without it a dash.
-->
<script lang="ts">
	import { formatDate, formatRelative, parseDate } from '#lib/i18n/format.ts';
	import { minuteNow } from './clock.svelte.ts';
	import Empty from './Empty.svelte';

	interface Props {
		value: unknown;
		relative?: boolean;
		format?: Intl.DateTimeFormatOptions;
		empty?: string;
	}

	let { value, relative = true, format, empty }: Props = $props();

	const date = $derived(parseDate(value));
	const full = $derived(date ? formatDate(date) : '');
	const shown = $derived(
		!date ? '' : relative ? formatRelative(date, '', minuteNow()) : formatDate(date, format ?? {})
	);
</script>

{#if date}
	<time class="time" datetime={date.toISOString()} title={full}
		>{shown}{#if shown !== full}<span class="sr-only">{` (${full})`}</span>{/if}</time
	>
{:else}
	<Empty word={empty} />
{/if}

<style>
	.time {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
