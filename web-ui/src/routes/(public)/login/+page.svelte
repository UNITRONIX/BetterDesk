<!--
  /login (and /login?desktop=1): the sign-in page, lib/public/LoginView.
  Reads the address once (return, expired, error, autoLaunch, desktop) and
  removes the one-time notices from it, so a reload doesn't repeat them.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { setCsrfToken } from '#lib/api/client.ts';
	import { getLoginPage, type LoginPage } from '#lib/api/signin.ts';
	import { i18n, tf } from '#lib/i18n/i18n.svelte.ts';
	import LoginView from '#lib/public/LoginView.svelte';
	import { hasNotices, readLoginQuery, withoutNotices } from '#lib/public/login.ts';
	import Button from '#lib/ui/Button.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const query = readLoginQuery(page.url.search);
	let login = $state<LoginPage | null>(null);
	let failed = $state(false);
	let retrying = $state(false);

	function apply(p: LoginPage) {
		setCsrfToken(p.csrfToken);
		i18n.available = p.languages;
		login = p;
	}

	async function retry() {
		retrying = true;
		failed = false;
		try {
			apply(await getLoginPage());
		} catch {
			failed = true;
		} finally {
			retrying = false;
		}
	}

	onMount(() => {
		if (hasNotices(location.href))
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own URL without the notices
			replaceState(withoutNotices(location.href), page.state);
		void data.early.then((p) => (p ? apply(p) : (failed = true)));
	});
</script>

{#if login}
	<LoginView bind:page={login} {query} />
{:else if failed}
	<main class="login-failed" role="alert">
		<p>
			{tf('desktop_login.network_error', 'Could not reach the server. Check your connection and try again.')}
		</p>
		<Button onclick={() => void retry()} busy={retrying}>{tf('errors.try_again', 'Try again')}</Button>
	</main>
{/if}

<style>
	.login-failed {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		max-width: calc(340px + 2 * var(--space-4));
		margin: 0 auto;
		padding: 12vh var(--space-4) var(--space-6);
	}
	.login-failed p {
		color: var(--danger);
	}
</style>
