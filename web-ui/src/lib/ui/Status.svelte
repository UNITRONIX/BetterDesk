<!--
  Status: a mark and a word (GUIDE section 10). `tone` is a tone (good,
  waiting, neutral, warning, danger) or a status word that maps to one
  ("pending" → waiting). Each tone has its own shape, so colour is never
  the only cue. `title`: a longer explanation on hover.
-->
<script lang="ts">
	import { statusTone } from '#lib/util/display.ts';

	let { tone, label, title }: { tone: string; label: string; title?: string } = $props();
	const t = $derived(statusTone(tone));
</script>

<span class="status is-{t}" {title}>{label}</span>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		white-space: nowrap;
	}
	.status::before {
		content: '';
		flex-shrink: 0;
		box-sizing: border-box;
		width: 8px;
		height: 8px;
		border: 1.5px solid var(--text-muted);
		border-radius: 50%;
		forced-color-adjust: none;
	}
	.is-good::before {
		border-color: var(--success);
		background: var(--success);
	}
	.is-waiting::before {
		width: 8px;
		height: 10px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		clip-path: polygon(0 0, 100% 0, 62% 50%, 100% 100%, 0 100%, 38% 50%);
	}
	.is-neutral {
		color: var(--text-muted);
	}
	.is-warning {
		color: var(--warning);
	}
	.is-warning::before {
		width: 10px;
		height: 9px;
		border: 0;
		border-radius: 0;
		background: var(--warning);
		clip-path: polygon(50% 0, 100% 100%, 0 100%);
	}
	.is-danger {
		color: var(--danger);
	}
	.is-danger::before {
		border-color: var(--danger);
		border-radius: 1px;
		background: var(--danger);
	}
</style>
