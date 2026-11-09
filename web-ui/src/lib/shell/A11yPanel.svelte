<!--
  Accessibility panel (public/js/accessibility.js): a side sheet from the
  top bar. Quick profiles, reading (sizes and spacing, fonts), visual
  (contrast, colour filter, saturation, links, headings, media) and
  interaction (focus, pointer, motion, reading guide and mask). Every
  change applies right away and is saved in this browser; Reset goes back
  to the defaults.
-->
<script lang="ts">
	import { i18n, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import {
		a11y,
		chooseProfile,
		resetA11y,
		setA11y,
		RANGES,
		type ColorFilter,
		type Contrast,
		type FlagKey,
		type Profile,
		type RangeKey
	} from './a11y.svelte.ts';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const uid = $props.id();
	const tr = (key: string, fallback: string) => tf(`accessibility.${key}`, fallback);

	function num(value: number, options: Intl.NumberFormatOptions): string {
		try {
			return new Intl.NumberFormat(i18n.lang, options).format(value);
		} catch {
			return String(value);
		}
	}

	/** Values in plain units: "100 %", "1.5", "Normal" or "+0.05 em" */
	function formatValue(key: RangeKey, value: number): string {
		if (key === 'fontScale' || key === 'saturation')
			return num(value / 100, { style: 'percent', maximumFractionDigits: 0 });
		if (key === 'lineHeight') return num(value, { maximumFractionDigits: 2 });
		if (value === 0) return tr('spacing_normal', 'Normal');
		return `+${num(value, { maximumFractionDigits: 3 })} em`;
	}

	const profiles: { id: Profile; title: [string, string]; hint: [string, string] }[] = [
		{
			id: 'lowVision',
			title: ['profile_low_vision', 'Low vision'],
			hint: [
				'profile_low_vision_hint',
				'Larger text, high contrast, a strong focus ring and a large pointer.'
			]
		},
		{
			id: 'dyslexia',
			title: ['profile_dyslexia', 'Reading comfort'],
			hint: ['profile_dyslexia_hint', 'Readable font, larger text and wider spacing.']
		},
		{
			id: 'motionSafe',
			title: ['profile_motion_safe', 'Less motion'],
			hint: ['profile_motion_safe_hint', 'Stops animations and adds a reading guide and a strong focus ring.']
		},
		{
			id: 'colorAssist',
			title: ['profile_color_assist', 'Color support'],
			hint: [
				'profile_color_assist_hint',
				'Color filter, stronger colors, underlined links and marked headings.'
			]
		}
	];

	const readingRanges: { key: RangeKey; label: [string, string] }[] = [
		{ key: 'fontScale', label: ['font_size', 'Font size'] },
		{ key: 'lineHeight', label: ['line_height', 'Line height'] },
		{ key: 'letterSpacing', label: ['letter_spacing', 'Letter spacing'] },
		{ key: 'wordSpacing', label: ['word_spacing', 'Word spacing'] }
	];

	type Check = { key: FlagKey; label: [string, string]; hint: [string, string] };
	const readingChecks: Check[] = [
		{
			key: 'readableFont',
			label: ['readable_font', 'Readable font'],
			hint: ['readable_font_hint', 'Uses a wide, plain font such as Verdana.']
		},
		{
			key: 'dyslexiaFont',
			label: ['dyslexia_spacing', 'Dyslexia spacing'],
			hint: ['dyslexia_spacing_hint', 'Adds space between letters and words.']
		}
	];
	const visualChecks: Check[] = [
		{
			key: 'underlineLinks',
			label: ['underline_links', 'Underline links'],
			hint: ['underline_links_hint', 'Makes links visible without relying on color.']
		},
		{
			key: 'highlightLinks',
			label: ['highlight_links', 'Highlight actions'],
			hint: ['highlight_links_hint', 'Outlines links and buttons.']
		},
		{
			key: 'highlightHeadings',
			label: ['highlight_headings', 'Highlight headings'],
			hint: ['highlight_headings_hint', 'Marks section titles with a color bar.']
		},
		{
			key: 'hideMedia',
			label: ['hide_media', 'Dim media'],
			hint: ['hide_media_hint', 'Fades out images, videos and charts.']
		}
	];
	const interactionChecks: Check[] = [
		{
			key: 'strongFocus',
			label: ['strong_focus', 'Strong focus'],
			hint: ['strong_focus_hint', 'Shows a large keyboard focus ring.']
		},
		{
			key: 'largeCursor',
			label: ['large_cursor', 'Large cursor'],
			hint: ['large_cursor_hint', 'Uses a larger high-contrast pointer.']
		},
		{
			key: 'reduceMotion',
			label: ['reduce_motion', 'Reduce motion'],
			hint: ['reduce_motion_hint', 'Turns off transitions and smooth scrolling.']
		},
		{
			key: 'pauseAnimations',
			label: ['pause_animations', 'Pause animations'],
			hint: ['pause_animations_hint', 'Freezes animations such as loading spinners.']
		},
		{
			key: 'readingGuide',
			label: ['reading_guide', 'Reading guide'],
			hint: ['reading_guide_hint', 'A line follows the pointer to help you keep your place.']
		},
		{
			key: 'readingMask',
			label: ['reading_mask', 'Reading mask'],
			hint: ['reading_mask_hint', 'Dims content above and below the pointer.']
		}
	];

	const contrastOptions = $derived<{ value: Contrast; label: string }[]>([
		{ value: 'normal', label: tr('contrast_normal', 'Normal') },
		{ value: 'high-dark', label: tr('contrast_high_dark', 'High contrast dark') },
		{ value: 'high-light', label: tr('contrast_high_light', 'High contrast light') },
		{ value: 'yellow-black', label: tr('contrast_yellow_black', 'Yellow on black') }
	]);
	const filterOptions = $derived<{ value: ColorFilter; label: string }[]>([
		{ value: 'none', label: tr('filter_none', 'None') },
		{ value: 'protanopia', label: tr('filter_protanopia', 'Protanopia (red-blind)') },
		{ value: 'deuteranopia', label: tr('filter_deuteranopia', 'Deuteranopia (green-blind)') },
		{ value: 'tritanopia', label: tr('filter_tritanopia', 'Tritanopia (blue-blind)') },
		{ value: 'achromatopsia', label: tr('filter_achromatopsia', 'Grayscale') }
	]);

	function onRange(key: RangeKey, e: Event) {
		setA11y(key, Number((e.currentTarget as HTMLInputElement).value));
	}
</script>

{#snippet range(key: RangeKey, label: [string, string])}
	{@const [min, max, step] = RANGES[key]}
	{@const text = formatValue(key, a11y.settings[key])}
	<div class="a11y-range">
		<label class="a11y-label" for={`${uid}-${key}`}>{tr(...label)}</label>
		<output class="a11y-value" for={`${uid}-${key}`}>{text}</output>
		<input
			id={`${uid}-${key}`}
			type="range"
			{min}
			{max}
			{step}
			value={a11y.settings[key]}
			aria-valuetext={text}
			oninput={(e) => onRange(key, e)}
		/>
	</div>
{/snippet}

{#snippet checks(list: Check[])}
	<div class="a11y-checks">
		{#each list as c (c.key)}
			<Checkbox
				label={tr(...c.label)}
				hint={tr(...c.hint)}
				checked={a11y.settings[c.key]}
				onchange={(e) => setA11y(c.key, (e.currentTarget as HTMLInputElement).checked)}
			/>
		{/each}
	</div>
{/snippet}

{#if open}
	<Sheet
		bind:open
		title={tr('title', 'Accessibility')}
		subtitle={tr(
			'subtitle',
			'Changes to text, color and motion apply right away and are saved in this browser.'
		)}
		class="bd-a11y-modal"
	>
		<section class="a11y-section" aria-labelledby={`${uid}-h-profiles`}>
			<h3 id={`${uid}-h-profiles`}>{tr('profiles', 'Quick profiles')}</h3>
			<p class="a11y-note">
				{tr(
					'profiles_note',
					'Each profile changes several settings below at once. Choose it again to go back to the defaults.'
				)}
			</p>
			<ul class="a11y-profiles">
				{#each profiles as p (p.id)}
					<li>
						<button
							type="button"
							class="a11y-profile"
							aria-pressed={a11y.settings.activeProfile === p.id}
							onclick={() => chooseProfile(p.id)}
						>
							<span class="a11y-profile-mark" aria-hidden="true"></span>
							<span class="a11y-profile-title">{tr(...p.title)}</span>
							<span class="a11y-hint">{tr(...p.hint)}</span>
						</button>
					</li>
				{/each}
			</ul>
		</section>

		<section class="a11y-section" aria-labelledby={`${uid}-h-reading`}>
			<h3 id={`${uid}-h-reading`}>{tr('reading', 'Reading')}</h3>
			<div class="a11y-ranges">
				{#each readingRanges as r (r.key)}{@render range(r.key, r.label)}{/each}
			</div>
			{@render checks(readingChecks)}
		</section>

		<section class="a11y-section" aria-labelledby={`${uid}-h-visual`}>
			<h3 id={`${uid}-h-visual`}>{tr('visual', 'Visual')}</h3>
			<div class="a11y-fields">
				<Field label={tr('contrast', 'Contrast')}>
					{#snippet children(f)}
						<Select
							{...f}
							options={contrastOptions}
							value={a11y.settings.contrast}
							onchange={(e) => setA11y('contrast', (e.currentTarget as HTMLSelectElement).value as Contrast)}
						/>
					{/snippet}
				</Field>
				<Field label={tr('color_filter', 'Color vision filter')}>
					{#snippet children(f)}
						<Select
							{...f}
							options={filterOptions}
							value={a11y.settings.colorFilter}
							onchange={(e) =>
								setA11y('colorFilter', (e.currentTarget as HTMLSelectElement).value as ColorFilter)}
						/>
					{/snippet}
				</Field>
			</div>
			<div class="a11y-ranges">{@render range('saturation', ['saturation', 'Color saturation'])}</div>
			{@render checks(visualChecks)}
		</section>

		<section class="a11y-section" aria-labelledby={`${uid}-h-interaction`}>
			<h3 id={`${uid}-h-interaction`}>{tr('interaction', 'Interaction')}</h3>
			{@render checks(interactionChecks)}
		</section>

		{#snippet footer()}
			<Button class="sheet-footer-start" onclick={resetA11y}
				>{tr('reset_defaults', 'Reset to defaults')}</Button
			>
			<Button variant="primary" onclick={() => (open = false)}>{tr('done', 'Done')}</Button>
		{/snippet}
	</Sheet>
{/if}

<style>
	/* Sections on rules; the sheet body pads the first and the last */
	.a11y-section {
		padding: var(--space-5) 0;
	}
	.a11y-section:first-child {
		padding-top: 0;
	}
	.a11y-section:last-child {
		padding-bottom: 0;
	}
	.a11y-section + .a11y-section {
		border-top: 1px solid var(--rule);
	}
	.a11y-section h3 {
		margin-bottom: var(--space-3);
		font-size: var(--text-md);
		font-weight: 600;
		line-height: 1.3;
	}
	.a11y-note,
	.a11y-hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.a11y-note {
		margin-bottom: var(--space-3);
	}
	.a11y-label,
	.a11y-profile-title {
		color: var(--text);
		font-weight: 600;
	}
	/* Quick profiles: one row each with a title and a sentence, on rules */
	.a11y-profiles {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.a11y-profiles li + li {
		border-top: 1px solid var(--rule);
	}
	.a11y-profile {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 2px var(--space-3);
		align-items: start;
		width: 100%;
		min-height: 44px;
		padding: var(--space-3) var(--row-pad-x);
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.a11y-profile:hover {
		background: var(--bg-subtle);
	}
	.a11y-profile[aria-pressed='true'] {
		background: var(--accent-tint);
	}
	.a11y-profile:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.a11y-profile .a11y-hint {
		grid-column: 2;
	}
	/* Radio-like mark: empty ring, filled when the profile is on */
	.a11y-profile-mark {
		box-sizing: border-box;
		width: 16px;
		height: 16px;
		margin-top: 2px;
		border: 1px solid var(--border);
		border-radius: 50%;
		background: var(--bg);
	}
	.a11y-profile[aria-pressed='true'] .a11y-profile-mark {
		border: 5px solid var(--accent);
	}
	/* Sliders: label and current value on one line, the slider under them */
	.a11y-ranges {
		display: grid;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.a11y-ranges:last-child {
		margin-bottom: 0;
	}
	.a11y-range {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		column-gap: var(--space-3);
	}
	.a11y-value {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.a11y-range input[type='range'] {
		grid-column: 1 / -1;
		width: 100%;
		height: var(--control-h);
		margin: 0;
		background: transparent;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.a11y-fields {
		display: grid;
		gap: var(--space-4);
		margin-bottom: var(--space-4);
	}
	.a11y-fields :global(.form-select) {
		width: 100%;
	}
	.a11y-checks {
		display: grid;
		gap: var(--space-3);
	}
	@media (pointer: coarse) {
		.a11y-range input[type='range'] {
			min-height: 44px;
		}
	}
</style>
