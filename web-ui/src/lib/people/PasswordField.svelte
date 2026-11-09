<!--
  A new password: the field, a Show toggle (aria-pressed, the name stays
  "Show password" so it matches its word), a line that says how
  strong the password is while it is typed (the server refuses weak ones),
  and the hint. Used by the user sheet and the reset password dialog.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { passwordStrength } from './users.ts';

	interface Props {
		label: string;
		hint: string;
		value: string;
		error?: string | undefined;
		autofocus?: boolean;
	}

	let { label, hint, value = $bindable(''), error, autofocus = false }: Props = $props();

	const uid = $props.id();
	let shown = $state(false);

	const strength = $derived.by(() => {
		if (!value) return '';
		const level = passwordStrength(value);
		const line = t('users.strength_line', { strength: t(`users.strength_${level}`) });
		return level === 'weak' ? `${line} ${t('users.password_weak_hint')}` : line;
	});
</script>

<Field {label} {hint} {error} id="{uid}-input">
	{#snippet children(f)}
		<div class="password">
			<Input
				{...f}
				describedby={[f.describedby, `${uid}-strength`].filter(Boolean).join(' ')}
				type={shown ? 'text' : 'password'}
				autocomplete="new-password"
				spellcheck="false"
				data-autofocus={autofocus || undefined}
				bind:value
			/>
			<Button
				size="sm"
				variant="ghost"
				aria-pressed={shown}
				aria-label={t('users.show_password')}
				onclick={() => (shown = !shown)}>{t('actions.show_value')}</Button
			>
		</div>
		<p class="strength" id="{uid}-strength" aria-live="polite">{strength}</p>
	{/snippet}
</Field>

<style>
	.password {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		max-width: calc(40ch + 5rem);
	}
	.password > :global(input) {
		flex: 1;
		min-width: 0;
	}
	.strength {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.strength:empty {
		display: none;
	}
</style>
