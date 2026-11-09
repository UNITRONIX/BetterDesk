<!--
  An error page anywhere in the app (views/errors): signed-in people get it
  inside the console shell, so the navigation stays; everyone else gets the
  standalone page with the console's name. GET /api/auth/login-page says
  whether there is a session; then the console starts (unless it already
  has), otherwise the strings alone.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getLoginPage } from '#lib/api/signin.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import Shell from '#lib/shell/Shell.svelte';
	import { session, startSession } from '#lib/state/session.svelte.ts';
	import { initTheme } from '#lib/state/theme.svelte.ts';
	import { dropEarlySession, publicPage, startPublic } from './boot.svelte.ts';
	import ErrorView from './ErrorView.svelte';

	interface Props {
		status: number;
		title?: string;
		message?: string;
		details?: string;
	}

	let { status, title, message, details }: Props = $props();

	let phase = $state<'starting' | 'console' | 'standalone'>(session.ready ? 'console' : 'starting');
	let appName = $state('');

	onMount(() => {
		if (phase !== 'starting') return;
		void (async () => {
			// The public answer says whether there is a session, so visitors without one
			// never send a session request that the server refuses
			const info = await getLoginPage().catch(() => null);
			if (info?.signedIn) {
				try {
					await startSession();
					if (session.raw) initTheme(session.raw.branding.themeMode, session.raw.palettes);
					phase = 'console';
					return;
				} catch {
					/* the session ended meanwhile: the standalone page */
				}
			}
			dropEarlySession();
			if (!publicPage.ready) await startPublic();
			appName = info?.appName ?? '';
			phase = 'standalone';
		})();
	});

	const user = $derived(session.user ? { username: session.user.username, role: session.user.role } : null);
</script>

<svelte:head>
	{#if phase !== 'starting'}
		<title
			>{t(
				status === 403
					? 'errors.forbidden_title'
					: status === 404
						? 'errors.not_found_title'
						: 'errors.server_error_title'
			)}{appName || session.appName ? ` - ${appName || session.appName}` : ''}</title
		>
	{/if}
</svelte:head>

{#if phase === 'console'}
	<Shell><ErrorView {status} {title} {message} {details} {user} home={link('/')} /></Shell>
{:else if phase === 'standalone'}
	<ErrorView {status} {title} {message} {details} standalone {appName} />
{/if}
