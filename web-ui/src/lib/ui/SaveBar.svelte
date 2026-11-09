<!--
  The save bar at the end of a form (components.css .save-bar): the status
  line in a polite live region and the one save button. The button is
  primary only while the form has unsaved changes, so a page with several
  forms shows one primary action at a time; it is the form's submit button,
  so Enter in a field saves. While there are unsaved changes the bar sticks
  to the bottom of the view and says so.

    <SaveBar {form} label={t('settings.save_sign_in')} />

  Without the form helper pass dirty, busy and status yourself. `children`:
  other buttons that belong to the form, before Save.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from './Button.svelte';
	import type { FormStatus } from './form.svelte.ts';

	interface Props {
		label: string;
		form?: { id: string; dirty: boolean; busy: boolean; status: FormStatus };
		dirty?: boolean;
		busy?: boolean;
		status?: FormStatus;
		class?: string;
		children?: Snippet;
	}

	let { label, form, dirty, busy, status, class: cls = '', children }: Props = $props();

	const isDirty = $derived(dirty ?? form?.dirty ?? false);
	const isBusy = $derived(busy ?? form?.busy ?? false);
	const st = $derived<FormStatus>(status ?? form?.status ?? { state: 'idle', message: '' });

	const view = $derived.by((): { text: string; kind: '' | 'dirty' | 'ok' | 'error' } => {
		if (st.state === 'error') return { text: st.message, kind: 'error' };
		if (st.state === 'saving') return { text: st.message, kind: '' };
		if (isDirty) return { text: tf('ui_form.unsaved', 'Unsaved changes'), kind: 'dirty' };
		if (st.state === 'saved') return { text: st.message, kind: 'ok' };
		return { text: '', kind: '' };
	});
</script>

<div class={['save-bar', view.kind === 'dirty' && 'is-dirty', cls]}>
	<span
		class={['save-status', view.kind === 'ok' && 'is-ok', view.kind === 'error' && 'is-error']}
		aria-live="polite">{view.text}</span
	>
	{@render children?.()}
	<Button type="submit" form={form?.id} variant={isDirty ? 'primary' : 'secondary'} busy={isBusy}
		>{label}</Button
	>
</div>

<style>
	/* At the end of its form; it sticks to the bottom of the view only while
	   the form has unsaved changes, so several forms on one page don't cover
	   each other */
	.save-bar {
		position: static;
		bottom: 0;
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-3) 0;
		border-top: 1px solid var(--rule);
		background: var(--bg);
	}
	.save-status {
		margin-inline-end: auto;
		color: var(--text-muted);
	}
	.save-bar.is-dirty {
		position: sticky;
	}
	.save-bar.is-dirty .save-status {
		color: var(--warning);
		font-weight: 600;
	}
	.save-status.is-ok {
		color: var(--success);
	}
	.save-status.is-error {
		color: var(--danger);
		font-weight: 600;
	}
	/* Above the bottom navigation on phones */
	@media (max-width: 767px) {
		.save-bar {
			bottom: calc(56px + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
