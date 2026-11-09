<!--
  Errors inside the app: an address no page has (404) or a page that
  failed to load. The look of the server's error pages (lib/public/ErrorPage).
-->
<script lang="ts">
	import { page } from '$app/state';
	import ErrorPage from '#lib/public/ErrorPage.svelte';
</script>

<ErrorPage
	status={page.status === 403 || page.status === 404 ? page.status : 500}
	details={import.meta.env.DEV ? (page.error?.message ?? '') : ''}
/>
