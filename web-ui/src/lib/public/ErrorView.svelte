<!--
  The error page's content (views/errors/_page.ejs): heading and sentence
  for 403, 404 or 500, what to do next, and the way on: the overview when
  signed in, the sign-in page otherwise; Try again (reload) after a server
  error. A 403 may carry the route's own title and message (guest links
  pass the server's reason); the generic English permission message is
  replaced by the translated one. Signed in, a 403 says who you are.
  `standalone`: outside the console shell, with the console's name above.
-->
<script lang="ts">
	import { has, t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';

	interface Props {
		status: number;
		title?: string;
		message?: string;
		/** Development builds only: the server's error text */
		details?: string;
		user?: { username: string; role: string } | null;
		standalone?: boolean;
		appName?: string;
		/** Where "Go to the overview" leads when signed in */
		home?: string;
	}

	let {
		status,
		title = '',
		message = '',
		details = '',
		user = null,
		standalone = false,
		appName = '',
		home = '/'
	}: Props = $props();

	const GENERIC = new Set(['You do not have permission to access this resource']);
	const kind = $derived(status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'server_error');
	const routeMessage = $derived(kind === 'forbidden' && message && !GENERIC.has(message) ? message : '');
	const routeTitle = $derived(routeMessage && title && title !== 'Forbidden' ? title : '');
	const heading = $derived(routeTitle || t(`errors.${kind}_title`));
	const text = $derived(routeMessage || t(`errors.${kind}_message`));
	const roleLabel = $derived.by(() => {
		if (!user) return '';
		const key = `users.role_${user.role}`;
		return has(key) ? t(key) : user.role.replace(/_/g, ' ');
	});
	/** "You are signed in as {user} with the role {role}.", the name in bold */
	const signedInParts = $derived.by(() => {
		const sentence = t('errors.signed_in_as', { role: roleLabel });
		const at = sentence.indexOf('{user}');
		return at < 0 ? null : [sentence.slice(0, at), sentence.slice(at + '{user}'.length)];
	});
</script>

{#snippet body()}
	<div class="error-page">
		<div class="page-head">
			<h1>{heading}</h1>
			<p class="page-description">{text}</p>
		</div>
		<div class="error-next">
			{#if kind === 'forbidden' && !routeMessage && user && signedInParts}
				<p class="error-note">{signedInParts[0]}<strong>{user.username}</strong>{signedInParts[1]}</p>
			{:else if kind === 'server_error'}
				<p class="error-note">{t('errors.server_error_log')}</p>
			{/if}
			{#if kind === 'server_error' && details}
				<CodeBlock title={t('errors.error_details')} code={details} />
			{/if}
			<div class="page-actions">
				{#if kind === 'server_error'}
					<Button variant="primary" onclick={() => location.reload()}>{t('errors.try_again')}</Button>
				{/if}
				{#if user}
					<Button href={home} variant={kind === 'server_error' ? 'secondary' : 'primary'}
						>{t('errors.go_home')}</Button
					>
				{:else}
					<Button href="/login" variant={kind === 'server_error' ? 'secondary' : 'primary'}
						>{t('errors.go_sign_in')}</Button
					>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#if standalone}
	<main class="error-main">
		{#if appName}<p class="error-brand">{appName}</p>{/if}
		{@render body()}
	</main>
{:else}
	<div class="page">{@render body()}</div>
{/if}

<style>
	.error-page,
	.error-note {
		max-width: var(--measure);
	}
	.error-next {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		margin-top: var(--space-5);
	}
	.error-main {
		max-width: calc(var(--measure) + 2 * var(--space-4));
		margin: 0 auto;
		padding: 12vh var(--space-4) var(--space-6);
	}
	.error-brand {
		margin-bottom: var(--space-6);
		font-weight: 700;
	}
	@media (max-width: 640px) {
		.error-main {
			padding-top: var(--space-6);
		}
	}
</style>
