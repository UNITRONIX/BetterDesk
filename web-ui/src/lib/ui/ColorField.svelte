<!--
  A colour: the swatch (native colour picker) and the hex value side by side
  (components.css .color-field). Both edit the same `value` ("#00677a").
  `label` names the swatch. Inside a Field the hex field takes the Field's
  id, hint and error ({...f}); on its own it is named by `hexLabel`.
  A hex value that is not complete yet leaves the swatch where it was.
-->
<script lang="ts">
	import Input from './Input.svelte';

	interface Props {
		value?: string;
		label: string;
		hexLabel?: string;
		id?: string;
		describedby?: string | undefined;
		invalid?: boolean;
		disabled?: boolean;
		class?: string;
	}

	let {
		value = $bindable(''),
		label,
		hexLabel,
		id,
		describedby,
		invalid = false,
		disabled = false,
		class: cls = ''
	}: Props = $props();

	/** #abc → #aabbcc; anything that isn't a hex colour → null */
	function normalise(v: string): string | null {
		const s = v.trim().toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(s)) return s;
		const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
		return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
	}

	// The last complete value, so the swatch stays put while someone types
	let lastValid = '#000000';
	const swatch = $derived.by(() => {
		const n = normalise(value);
		if (n) lastValid = n;
		return lastValid;
	});
</script>

<div class={['color-field', cls]}>
	<input
		type="color"
		value={swatch}
		aria-label={label}
		{disabled}
		oninput={(e) => (value = e.currentTarget.value)}
	/>
	<Input
		bind:value
		{id}
		{describedby}
		{invalid}
		{disabled}
		aria-label={id ? undefined : (hexLabel ?? label)}
		spellcheck="false"
		autocomplete="off"
		maxlength={7}
		translate="no"
	/>
</div>

<style>
	.color-field {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	input[type='color'] {
		flex-shrink: 0;
		width: var(--control-h);
		height: var(--control-h);
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		cursor: pointer;
	}
	input[type='color']:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}
	.color-field > :global(.form-input) {
		max-width: 12ch;
		font-family: var(--mono);
	}
</style>
