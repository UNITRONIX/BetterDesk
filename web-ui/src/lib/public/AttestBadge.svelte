<!--
  The server capacity badge on the sign-in page (views/partials/
  server-attestation-badge.ejs, public/css/server-attestation.css): the
  console's name and the tier of its last capacity test, in the tier's
  metal colours. Shown only after a test with a result.
-->
<script lang="ts">
	import { has, t } from '#lib/i18n/i18n.svelte.ts';
	import type { Attestation } from '#lib/api/signin.ts';

	let { badge, appName }: { badge: Attestation; appName: string } = $props();

	const TIERS = new Set(['bronze', 'iron', 'platinum', 'titanium', 'obsidian']);
	const tier = $derived(TIERS.has(badge.tier.toLowerCase()) ? badge.tier.toLowerCase() : 'none');
	const label = $derived(
		badge.tierLabel ||
			(has(`server_attestation.tier_${tier}`) ? t(`server_attestation.tier_${tier}`) : tier.toUpperCase())
	);
	const title = $derived(badge.badgeTitle || t('server_attestation.badge_tooltip'));
</script>

<div class="login-attestation-badge">
	<div class="bd-attest-badge bd-attest-tier-{tier}" {title}>
		<div class="bd-attest-brand">{badge.brand || appName}</div>
		<div class="bd-attest-tier">{label}</div>
	</div>
</div>

<style>
	.login-attestation-badge {
		position: fixed;
		bottom: var(--space-4);
		inset-inline-start: var(--space-4);
		z-index: 10;
	}
	/* Phones: under the form instead of over it */
	@media (max-width: 640px) {
		.login-attestation-badge {
			position: static;
			margin-top: var(--space-5);
		}
	}
	.bd-attest-badge {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		min-width: 130px;
		padding: 10px 16px;
		border-radius: 4px;
		background:
			linear-gradient(
				135deg,
				rgba(255, 255, 255, 0.08) 0%,
				rgba(255, 255, 255, 0) 42%,
				rgba(0, 0, 0, 0.22) 100%
			),
			repeating-linear-gradient(
				45deg,
				rgba(255, 255, 255, 0.025) 0,
				rgba(255, 255, 255, 0.025) 1px,
				transparent 1px,
				transparent 3px
			),
			repeating-linear-gradient(
				-45deg,
				rgba(0, 0, 0, 0.035) 0,
				rgba(0, 0, 0, 0.035) 1px,
				transparent 1px,
				transparent 3px
			),
			linear-gradient(135deg, #3c3c3c 0%, #292929 52%, #171717 100%);
		box-shadow:
			0 2px 12px rgba(0, 0, 0, 0.45),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
		line-height: 1.1;
		user-select: none;
	}
	.bd-attest-brand,
	.bd-attest-tier {
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
		white-space: nowrap;
	}
	.bd-attest-brand {
		font-size: 17px;
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.bd-attest-tier {
		margin-top: 3px;
		font-size: 20px;
		font-weight: 300;
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}
	/* Tier metal colours */
	.bd-attest-tier-bronze :is(.bd-attest-brand, .bd-attest-tier) {
		background-image: linear-gradient(180deg, #e8a857 0%, #cd7f32 45%, #a0622a 100%);
	}
	.bd-attest-tier-iron :is(.bd-attest-brand, .bd-attest-tier) {
		background-image: linear-gradient(180deg, #f2f2f2 0%, #c8c8c8 45%, #9a9a9a 100%);
	}
	.bd-attest-tier-titanium :is(.bd-attest-brand, .bd-attest-tier) {
		background-image: linear-gradient(180deg, #ffffff 0%, #d8e0ea 40%, #a8b8c8 100%);
	}
	.bd-attest-tier-obsidian :is(.bd-attest-brand, .bd-attest-tier) {
		background-image: linear-gradient(180deg, #e8eeff 0%, #9aacff 35%, #5a6fd4 100%);
	}
	.bd-attest-tier-platinum :is(.bd-attest-brand, .bd-attest-tier) {
		background-image: linear-gradient(180deg, #fff8e7 0%, #e8dcc0 35%, #d4af37 100%);
	}
	.bd-attest-tier-none :is(.bd-attest-brand, .bd-attest-tier) {
		background-image: linear-gradient(180deg, #8899aa 0%, #556677 100%);
	}
	@media (forced-colors: active) {
		.bd-attest-brand,
		.bd-attest-tier {
			color: CanvasText;
			background: none;
		}
	}
</style>
