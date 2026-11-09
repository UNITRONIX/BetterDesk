<!--
  What a page shows to a role that may not open it, as the old console's
  403 page did (views/errors/_page.ejs, kind "forbidden"): what happened,
  who is signed in with which role, and the way to the overview. A page
  shows it instead of loading data the server would refuse, so it makes no
  request it knows will fail.
-->
<script lang="ts">
	import { t, has } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';

	const role = $derived(session.user?.role ?? '');
	const roleLabel = $derived(has(`users.role_${role}`) ? t(`users.role_${role}`) : role.replace(/_/g, ' '));
	// The sentence with the name in bold, wherever the language puts it
	const parts = $derived(t('errors.signed_in_as', { user: '\u0001', role: roleLabel }).split('\u0001'));
</script>

<div class="page no-access">
	<div class="page-head">
		<h1>{t('errors.forbidden_title')}</h1>
		<p class="page-description">{t('errors.forbidden_message')}</p>
	</div>
	<div class="section">
		{#if session.user}
			<p class="note">{parts[0]}<strong>{session.user.username}</strong>{parts.slice(1).join('')}</p>
		{/if}
		<div class="page-actions">
			<Button variant="primary" href={link('/')}>{t('errors.go_home')}</Button>
		</div>
	</div>
</div>

<style>
	.note {
		margin: 0;
		max-width: var(--measure);
		color: var(--text-muted);
	}
	.note strong {
		color: var(--text);
	}
</style>
