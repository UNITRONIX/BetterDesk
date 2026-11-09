<!--
  The BetterDesk logo (.ui-rework/brand, views/partials/brand-logo.ejs):
  the mark (square, circle, overlap in --logo-* colours, which follow the
  theme) and the wordmark drawn 1.3 times its size in the brand file, in
  currentColor so it follows --text. Static, reviewed markup; never set
  the wordmark as live text.

  name: the app name. "BetterDesk" (or empty) draws mark and wordmark; any
  other name draws the mark followed by that name as text.
  mark: draw the mark alone (where it is tight; below 24 px use the mark).
  The full logo is labelled with the name; the mark alone is decoration.
-->
<script lang="ts">
	let { name = 'BetterDesk', mark = false }: { name?: string; mark?: boolean } = $props();

	const uid = $props.id();
	const trimmed = $derived(name.trim());
	const full = $derived(!mark && (!trimmed || trimmed.toLowerCase() === 'betterdesk'));
	const label = $derived(trimmed || 'BetterDesk');
</script>

{#snippet shapes(clip: string)}
	<rect x="10" y="22" width="32" height="32" rx="10" class="logo-square" />
	<circle cx="38" cy="26" r="16" class="logo-circle" />
	<rect x="10" y="22" width="32" height="32" rx="10" class="logo-overlap" clip-path="url(#{clip})" />
{/snippet}

{#if full}
	<svg
		class="brand-logo brand-logo-full"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="6.04 -100.21 815.9 132.92"
		role="img"
		aria-label={label}
		focusable="false"
	>
		<defs><clipPath id="{uid}-f"><circle cx="38" cy="26" r="16" /></clipPath></defs>
		<g aria-hidden="true" transform="translate(-24.167 -130.417) scale(3.02083)"
			>{@render shapes(`${uid}-f`)}</g
		>
		<path
			aria-hidden="true"
			fill="currentColor"
			transform="translate(177.27 -34.5) scale(1.3) translate(-177.27 34.5)"
			d="M212.63 1Q206.37 1 201.88 -1.4Q197.4 -3.8 194.77 -8.17H191.27V0H177.27V-13.67H184.1V-70H197.93V-43.17H198.27Q200.47 -46.9 204.41 -48.95Q208.35 -51 213.83 -51Q221.05 -51 226.14 -47.78Q231.23 -44.55 233.92 -38.68Q236.6 -32.82 236.6 -25Q236.6 -17.25 233.84 -11.38Q231.08 -5.52 225.77 -2.26Q220.45 1 212.63 1ZM210.08 -11Q216.4 -11 219.58 -14.75Q222.77 -18.5 222.77 -25Q222.77 -31.5 219.58 -35.25Q216.4 -39 210.08 -39Q204.5 -39 201.22 -35.87Q197.93 -32.73 197.93 -27.28V-22.72Q197.93 -17.27 201.22 -14.13Q204.5 -11 210.08 -11ZM265.7 1Q257.57 1 251.57 -2.21Q245.57 -5.42 242.32 -11.3Q239.07 -17.18 239.07 -25.17Q239.07 -33.15 242.25 -38.94Q245.43 -44.73 251.32 -47.87Q257.2 -51 265.17 -51Q272.98 -51 278.62 -47.99Q284.25 -44.98 287.26 -39.4Q290.27 -33.82 290.27 -26.05V-21.42H252.37Q253.17 -15.83 256.57 -12.9Q259.98 -9.97 265.62 -9.97Q269.97 -9.97 272.56 -11.47Q275.15 -12.97 276.23 -16.12H290.1Q288.45 -8.07 282.01 -3.53Q275.57 1 265.7 1ZM252.65 -30.62H277.02Q276.3 -35.3 273.3 -37.68Q270.3 -40.07 265.22 -40.07Q260.2 -40.07 256.97 -37.65Q253.75 -35.23 252.65 -30.62ZM311.37 0Q306 0 303.04 -2.72Q300.08 -5.45 300.08 -11.03V-39.2H291.5V-50H300.23V-65H313.77V-50H325.3V-39.2H313.92V-10.83H326.5V0ZM346.87 0Q341.5 0 338.54 -2.72Q335.58 -5.45 335.58 -11.03V-39.2H327V-50H335.73V-65H349.27V-50H360.8V-39.2H349.42V-10.83H362V0ZM390.37 1Q382.23 1 376.23 -2.21Q370.23 -5.42 366.98 -11.3Q363.73 -17.18 363.73 -25.17Q363.73 -33.15 366.92 -38.94Q370.1 -44.73 375.98 -47.87Q381.87 -51 389.83 -51Q397.65 -51 403.28 -47.99Q408.92 -44.98 411.92 -39.4Q414.93 -33.82 414.93 -26.05V-21.42H377.03Q377.83 -15.83 381.24 -12.9Q384.65 -9.97 390.28 -9.97Q394.63 -9.97 397.23 -11.47Q399.82 -12.97 400.9 -16.12H414.77Q413.12 -8.07 406.67 -3.53Q400.23 1 390.37 1ZM377.32 -30.62H401.68Q400.97 -35.3 397.97 -37.68Q394.97 -40.07 389.88 -40.07Q384.87 -40.07 381.64 -37.65Q378.42 -35.23 377.32 -30.62ZM424.5 0V-36.33H417.67V-50H431.67V-40.17H435.17Q437.13 -45.38 441.47 -47.99Q445.82 -50.6 451.28 -50.6H455.5V-38.6H450.67Q444.17 -38.6 441.12 -34.93Q438.07 -31.27 438.07 -25.27V0ZM478.7 1Q470.97 1 465.61 -2.26Q460.25 -5.52 457.49 -11.38Q454.73 -17.25 454.73 -25Q454.73 -32.82 457.42 -38.68Q460.1 -44.55 465.23 -47.78Q470.35 -51 477.5 -51Q483 -51 486.97 -48.95Q490.93 -46.9 493.07 -43.17H493.4V-70H507.23V-13.67H514.07V0H500.07V-8.17H496.57Q493.93 -3.8 489.45 -1.4Q484.97 1 478.7 1ZM481.25 -11Q486.83 -11 490.12 -14.13Q493.4 -17.27 493.4 -22.72V-27.28Q493.4 -32.73 490.12 -35.87Q486.83 -39 481.25 -39Q474.93 -39 471.75 -35.25Q468.57 -31.5 468.57 -25Q468.57 -18.5 471.75 -14.75Q474.93 -11 481.25 -11ZM542.7 1Q534.57 1 528.57 -2.21Q522.57 -5.42 519.32 -11.3Q516.07 -17.18 516.07 -25.17Q516.07 -33.15 519.25 -38.94Q522.43 -44.73 528.32 -47.87Q534.2 -51 542.17 -51Q549.98 -51 555.62 -47.99Q561.25 -44.98 564.26 -39.4Q567.27 -33.82 567.27 -26.05V-21.42H529.37Q530.17 -15.83 533.57 -12.9Q536.98 -9.97 542.62 -9.97Q546.97 -9.97 549.56 -11.47Q552.15 -12.97 553.23 -16.12H567.1Q565.45 -8.07 559.01 -3.53Q552.57 1 542.7 1ZM529.65 -30.62H554.02Q553.3 -35.3 550.3 -37.68Q547.3 -40.07 542.22 -40.07Q537.2 -40.07 533.97 -37.65Q530.75 -35.23 529.65 -30.62ZM594.42 1Q583.38 1 577.03 -3.64Q570.68 -8.28 570.17 -16.6H583.53Q584.18 -12.97 586.95 -11.23Q589.72 -9.5 595 -9.5Q603.55 -9.5 603.55 -14.27Q603.55 -16.2 602.26 -17.33Q600.97 -18.45 597.97 -19.02L586.85 -21.15Q571.87 -24.05 571.87 -35.22Q571.87 -42.43 577.62 -46.72Q583.37 -51 593.47 -51Q603.62 -51 609.51 -46.6Q615.4 -42.2 615.97 -34.23H602.63Q601.78 -37.72 599.43 -39.31Q597.08 -40.9 592.65 -40.9Q588.87 -40.9 586.83 -39.78Q584.8 -38.65 584.8 -36.43Q584.8 -34.8 586.06 -33.74Q587.32 -32.68 589.93 -32.18L601.3 -29.98Q609.13 -28.45 612.8 -24.92Q616.47 -21.38 616.47 -15.38Q616.47 -7.67 610.78 -3.33Q605.1 1 594.42 1ZM621.27 0V-70H635.1V-32.07H635.43L655.08 -50H671.57L650.33 -30.83L673.17 0H656.97L640.62 -22.4L635.1 -17.93V0Z"
		/>
	</svg>
{:else}
	<svg
		class="brand-logo brand-logo-mark"
		xmlns="http://www.w3.org/2000/svg"
		viewBox="10 10 44 44"
		aria-hidden="true"
		focusable="false"
	>
		<defs><clipPath id="{uid}-m"><circle cx="38" cy="26" r="16" /></clipPath></defs>
		<g>{@render shapes(`${uid}-m`)}</g>
	</svg>
	{#if !mark}<span class="brand-name">{trimmed}</span>{/if}
{/if}

<style>
	.brand-logo {
		display: block;
		flex: none;
	}
	/* Fills the width the parent gives it; the height follows */
	.brand-logo-full {
		width: 100%;
		height: auto;
	}
	.brand-logo-mark {
		width: 24px;
		height: 24px;
	}
	.logo-square {
		fill: var(--logo-square);
	}
	.logo-circle {
		fill: var(--logo-circle);
	}
	.logo-overlap {
		fill: var(--logo-overlap);
	}
	.brand-name {
		overflow: hidden;
		color: var(--text);
		font-weight: 700;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@media (forced-colors: active) {
		.logo-square,
		.logo-circle {
			fill: CanvasText;
		}
		.logo-overlap {
			fill: Canvas;
		}
	}
</style>
