<!--
  The language picker of the remote client's pages (a select, as on the old
  pages). Switching loads the strings without a reload and stores the
  choice (POST /api/i18n/set/:code: on the account when signed in, in the
  language cookie otherwise).
-->
<script lang="ts">
	import { i18n, switchLanguage, tf } from '#lib/i18n/i18n.svelte.ts';
	import { saveLanguageChoice } from '#lib/api/remote.ts';
	import Select from '#lib/ui/Select.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let busy = false;

	async function choose(code: string) {
		if (busy || code === i18n.lang) return;
		busy = true;
		try {
			await switchLanguage(code, saveLanguageChoice);
		} catch {
			toast.error(tf('errors.language_change_failed', 'The language could not be changed.'));
		} finally {
			busy = false;
		}
	}
</script>

{#if i18n.available.length > 1}
	<label class="lang">
		<span class="sr-only">{tf('settings.language', 'Language')}</span>
		<Select
			small
			options={i18n.available.map((l) => ({ value: l.code, label: l.native || l.name || l.code }))}
			value={i18n.lang}
			onchange={(e: Event) => void choose((e.currentTarget as HTMLSelectElement).value)}
		/>
	</label>
{/if}

<style>
	.lang {
		display: inline-flex;
	}
</style>
