<!--
  Radios or checkboxes with a title and a sentence each, on rules
  (components.css .choice-list). The group role sits on a wrapper div, since
  a <ul role="radiogroup"> breaks the list semantics. The selected choice
  gets the accent tint and an accent rule on the start side.
  type radio binds `value`, type checkbox binds `selected` (an array).
  A choice with `controls` (a ShowWhen id) carries aria-controls.
  Keyboard is native: Tab into the group, arrow keys move the radio
  selection, Space toggles a checkbox.
-->
<script module lang="ts">
	export interface Choice<T extends string | number = string> {
		value: T;
		title: string;
		description?: string;
		disabled?: boolean;
		/** Id of the ShowWhen block this choice shows */
		controls?: string;
	}
</script>

<script lang="ts" generics="V extends string | number">
	interface Props {
		choices: Choice<V>[];
		type?: 'radio' | 'checkbox';
		/** The group's name for screen readers (or labelledby) */
		label?: string;
		labelledby?: string;
		describedby?: string;
		/** Selected value (radio) */
		value?: V | undefined;
		/** Selected values (checkbox) */
		selected?: V[];
		name?: string;
		disabled?: boolean;
		class?: string;
		onchange?: (value: V, checked: boolean) => void;
	}

	let {
		choices,
		type = 'radio',
		label,
		labelledby,
		describedby,
		value = $bindable(),
		selected = $bindable([]),
		name: givenName,
		disabled = false,
		class: cls = '',
		onchange
	}: Props = $props();

	const uid = $props.id();
	const name = $derived(givenName ?? `choice-${uid}`);

	function isChecked(v: V): boolean {
		return type === 'radio' ? value === v : selected.includes(v);
	}

	function change(v: V, checked: boolean) {
		if (type === 'radio') {
			if (checked) value = v;
		} else {
			selected = checked ? [...selected.filter((s) => s !== v), v] : selected.filter((s) => s !== v);
		}
		onchange?.(v, checked);
	}
</script>

<div
	role={type === 'radio' ? 'radiogroup' : 'group'}
	aria-label={label}
	aria-labelledby={labelledby}
	aria-describedby={describedby}
	class={cls}
>
	<ul class="choice-list">
		{#each choices as c, i (c.value)}
			{@const cid = `${name}-${i}`}
			<li>
				<label class="choice">
					<input
						{type}
						{name}
						value={c.value}
						checked={isChecked(c.value)}
						disabled={disabled || c.disabled}
						aria-labelledby="{cid}-title"
						aria-describedby={c.description ? `${cid}-desc` : undefined}
						aria-controls={c.controls}
						onchange={(e) => change(c.value, e.currentTarget.checked)}
					/>
					<span class="choice-title" id="{cid}-title">{c.title}</span>
					{#if c.description}<span class="choice-desc" id="{cid}-desc">{c.description}</span>{/if}
				</label>
			</li>
		{/each}
	</ul>
</div>

<style>
	.choice-list {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.choice {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 2px var(--check-gap);
		align-items: start;
		padding: var(--space-3) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		cursor: pointer;
	}
	.choice:hover {
		background: var(--bg-subtle);
	}
	.choice > input {
		flex-shrink: 0;
		width: var(--check-size);
		height: var(--check-size);
		margin: 2px 0 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.choice-title {
		font-weight: 600;
	}
	.choice-desc {
		grid-column: 2;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* Selected: a translucent tint and an accent rule on the start side; the
	   text keeps its colours (muted stays above 4.5:1 on the tint) */
	.choice:has(input:checked) {
		background: var(--accent-tint);
		box-shadow: inset 3px 0 0 var(--accent);
		color: var(--text);
	}
	.choice:has(input:checked):dir(rtl) {
		box-shadow: inset -3px 0 0 var(--accent);
	}
	.choice:has(input:disabled) {
		cursor: not-allowed;
		color: var(--text-muted);
	}
	.choice > input:disabled {
		cursor: not-allowed;
	}
</style>
