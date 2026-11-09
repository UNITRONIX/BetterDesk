<!--
  Set a new password for a local account (one field, so a centred dialog).
  The same rules as the server: at least 8 characters and not weak.
-->
<script lang="ts">
	import { resetUserPassword, type ConsoleUser } from '#lib/api/users.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import PasswordField from '#lib/people/PasswordField.svelte';
	import { passwordProblem } from '#lib/people/users.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { user, onclose }: { user: ConsoleUser; onclose: () => void } = $props();

	const form = createForm({
		initial: { password: '' },
		validate: (v) => {
			const problem = passwordProblem(v.password, true);
			return { password: problem ? t(problem) : undefined };
		},
		submit: async (v) => {
			await resetUserPassword(user.id, v.password);
			toast.success(t('users.password_reset_named', { username: user.username }));
			onclose();
		}
	});
</script>

<Dialog
	title={t('users.reset_password_for', { username: user.username })}
	beforeclose={() => !form.busy}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<PasswordField
			label={t('users.new_password')}
			hint={t('users.password_hint')}
			error={form.errors.password}
			autofocus
			bind:value={form.values.password}
		/>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('users.set_password')}</Button>
	{/snippet}
</Dialog>
