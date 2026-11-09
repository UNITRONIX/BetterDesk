<!--
  The installers on the public download pages (/portal, /d/<id>): one row
  each with the system's mark and name, and a Download button, or the
  build state while it isn't ready. The row that fits this computer says
  so and has the primary button (lib/public/detect.ts).
-->
<script lang="ts" module>
	export interface InstallerRow {
		key: string;
		platform: string;
		title: string;
		/** The installer for this computer */
		matches: boolean;
		/** Ready: where it downloads from */
		href?: string | null;
		/** Not ready: building or failed */
		status?: 'building' | 'failed';
	}
</script>

<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import OsIcon from '#lib/ui/OsIcon.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import Status from '#lib/ui/Status.svelte';

	let { rows, label }: { rows: readonly InstallerRow[]; label: string } = $props();
</script>

<div class="dl-list">
	<RowList {label}>
		{#each rows as row (row.key)}
			<ListRow title={row.title} sub={row.matches ? t('download.this_device') : undefined}>
				{#snippet start()}<OsIcon platform={row.platform} />{/snippet}
				{#snippet end()}
					{#if row.href}
						<Button href={row.href} variant={row.matches ? 'primary' : 'secondary'}
							>{t('download.download')}</Button
						>
					{:else if row.status === 'failed'}
						<Status tone="danger" label={t('download.failed')} />
					{:else}
						<Status tone="waiting" label={t('download.building')} />
					{/if}
				{/snippet}
			</ListRow>
		{/each}
	</RowList>
</div>

<style>
	.dl-list :global(.os-icon) {
		width: 20px;
		height: 20px;
	}
	.dl-list :global(.row-end) {
		flex-shrink: 0;
	}
</style>
