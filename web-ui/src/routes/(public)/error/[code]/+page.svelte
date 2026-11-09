<!--
  An error page the server decided on (web-nodejs/lib/webUi.js
  sendErrorPage): the server answers the address with the error status and
  marks the app page; src/hooks.ts shows this page at that address. The
  server may add the route's own title and message for a 403 (guest links).
-->
<script lang="ts">
	import { page } from '$app/state';
	import ErrorPage from '#lib/public/ErrorPage.svelte';
	import { serverError } from '#lib/public/server-error.ts';

	const code = Number(page.params.code);
	const status = code === 403 || code === 404 ? code : 500;
	const marked = serverError(document);
</script>

<ErrorPage {status} title={marked?.title} message={marked?.message} />
