<!--
  Every tag on the devices the user can see, with how many devices (and
  tag groups) use it; rename or delete a tag everywhere. A side sheet: the
  rename prompt and the delete confirm open on top of it, results go in its
  status line, and focus comes back to the row that was changed.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { deleteTag, renameTag, type Device, type DeviceGroup } from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let {
		tags,
		devices,
		groups,
		onclose,
		onchanged
	}: {
		tags: string[];
		devices: Device[];
		groups: DeviceGroup[];
		onclose: () => void;
		/** After a rename (from, to) or a delete (from, null); resolves once the lists reloaded */
		onchanged: (from: string, to: string | null) => Promise<void>;
	} = $props();

	const uid = $props.id();
	let status = $state('');
	let tone = $state<'neutral' | 'ok' | 'error'>('neutral');
	let list = $state<HTMLElement | null>(null);

	const deviceCount = (tag: string) => {
		const x = tag.toLowerCase();
		return devices.filter((d) => (d.tags ?? []).some((y) => y.toLowerCase() === x)).length;
	};
	const groupCount = (tag: string) => {
		const x = tag.toLowerCase();
		return groups.filter((g) => g.source_type === 'tag' && String(g.tag_filter ?? '').toLowerCase() === x)
			.length;
	};

	function meta(tag: string): string {
		const n = deviceCount(tag);
		const g = groupCount(tag);
		const parts = [`${n} ${n === 1 ? t('devices.tag_device_one') : t('devices.tag_device_many')}`];
		if (g > 0) parts.push(`${g} ${g === 1 ? t('devices.tag_group_one') : t('devices.tag_group_many')}`);
		return parts.join(', ');
	}

	async function focusRow(tag: string | null, index: number, which: 'rename' | 'delete') {
		await tick();
		const rows = Array.from(list?.querySelectorAll<HTMLElement>('li[data-tag]') ?? []);
		const row = rows.find((r) => r.dataset.tag === tag) ?? rows[Math.min(index, rows.length - 1)];
		row?.querySelector<HTMLElement>(`[data-act="${which}"]`)?.focus();
	}

	async function rename(from: string) {
		const to = await prompt({
			title: t('devices.rename_tag'),
			label: t('devices.rename_tag_prompt'),
			value: from,
			hint: t('devices.rename_tag_hint'),
			confirmLabel: t('actions.save')
		});
		if (to === null) return;
		const clean = to.trim();
		if (!clean) {
			status = t('devices.tag_name_required');
			tone = 'error';
			return;
		}
		if (clean === from) return;
		status = tf('ui_form.saving', 'Saving…');
		tone = 'neutral';
		try {
			const result = await renameTag(from, clean);
			const name = result.to || clean;
			await onchanged(from, name);
			status = `${t('devices.tag_renamed')} (${result.updatedDevices})`;
			tone = 'ok';
			await focusRow(name, 0, 'rename');
		} catch (err) {
			status = err instanceof Error ? err.message : t('errors.server_error');
			tone = 'error';
		}
	}

	async function remove(tag: string) {
		const index = tags.indexOf(tag);
		const ok = await confirm({
			title: t('devices.delete_tag'),
			message: t('devices.delete_tag_confirm')
				.replace('{tag}', tag)
				.replace('{count}', String(deviceCount(tag)))
				.replace('{groups}', String(groupCount(tag))),
			confirmLabel: t('actions.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		status = t('devices.tag_deleting');
		tone = 'neutral';
		try {
			const result = await deleteTag(tag);
			await onchanged(tag, null);
			status = `${t('devices.tag_deleted')} (${result.updatedDevices})`;
			tone = 'ok';
			await focusRow(null, Math.max(index, 0), 'delete');
		} catch (err) {
			status = err instanceof Error ? err.message : t('errors.server_error');
			tone = 'error';
		}
	}
</script>

<Sheet
	title={t('devices.manage_tags')}
	subtitle={t('devices.tags_manage_hint')}
	{status}
	statusTone={tone}
	{onclose}
>
	{#if tags.length}
		<ul class="tags" bind:this={list}>
			{#each tags as tag, i (tag)}
				<li data-tag={tag}>
					<span class="main">
						<span class="name" id="{uid}-tag-{i}">{tag}</span>
						<span class="sub">{meta(tag)}</span>
					</span>
					<span class="end">
						<Button size="sm" data-act="rename" aria-describedby="{uid}-tag-{i}" onclick={() => rename(tag)}
							>{t('devices.rename_tag')}</Button
						>
						<Button
							size="sm"
							variant="danger-quiet"
							data-act="delete"
							aria-describedby="{uid}-tag-{i}"
							onclick={() => remove(tag)}>{t('devices.delete_tag')}</Button
						>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">{t('devices.no_tags')}</p>
	{/if}
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.tags {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.tags li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--row-pad-y) 0;
		border-bottom: 1px solid var(--rule);
	}
	.main {
		display: flex;
		flex: 1 1 12rem;
		flex-direction: column;
		min-width: 0;
	}
	.name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.sub,
	.empty {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.end {
		display: flex;
		gap: var(--space-2);
	}
</style>
