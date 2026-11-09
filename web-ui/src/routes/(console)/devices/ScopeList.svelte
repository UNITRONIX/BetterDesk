<!--
  Folders and groups beside the device list. They filter the list: one
  entry is chosen at a time (a folder or a group; "All devices" clears
  both). Each entry shows how many devices it holds. With device.edit,
  folders and groups have a menu (Edit, Delete; Support package for groups
  with billing.manage), opened by its ⋮ button or a right-click, and take
  a device row dropped on them: a folder moves it there, a manual group
  makes it a member ("All groups" takes it out of the open group).
  Narrow screens: two scrolling rows of entries.
-->
<script module lang="ts">
	export type DropTarget =
		| { kind: 'unassigned' }
		| { kind: 'folder'; id: number }
		| { kind: 'group'; guid: string }
		| { kind: 'all-groups' };
</script>

<script lang="ts">
	import type { DeviceGroup, Folder } from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import Button from '#lib/ui/Button.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import type { Counts, Scope } from '#lib/devices/model.ts';

	interface Props {
		folders: Folder[];
		groups: DeviceGroup[];
		counts: Counts;
		scope: Scope;
		canManage: boolean;
		canBilling: boolean;
		/** A device row is being dragged (entries that take it are marked on hover) */
		dragging: boolean;
		onscope: (scope: Scope) => void;
		onnewfolder: () => void;
		oneditfolder: (f: Folder) => void;
		ondeletefolder: (f: Folder) => void;
		onnewgroup: () => void;
		oneditgroup: (g: DeviceGroup) => void;
		ondeletegroup: (g: DeviceGroup) => void;
		onbilling: (g: DeviceGroup) => void;
		ondrop: (target: DropTarget, deviceId: string) => void;
	}

	let {
		folders,
		groups,
		counts,
		scope,
		canManage,
		canBilling,
		dragging,
		onscope,
		onnewfolder,
		oneditfolder,
		ondeletefolder,
		onnewgroup,
		oneditgroup,
		ondeletegroup,
		onbilling,
		ondrop
	}: Props = $props();

	const uid = $props.id();
	/** The entry whose menu is open (one popup at a time) */
	let menuFor = $state<string | null>(null);
	let over = $state<string | null>(null);

	const isTagGroup = (g: DeviceGroup) => (g.source_type || 'manual') === 'tag';
	const folderColor = (c: string | undefined) =>
		/^#[0-9a-f]{3,8}$/i.test(c ?? '') ? (c as string) : 'var(--text-muted)';

	function key(target: DropTarget): string {
		return target.kind === 'folder'
			? `f${target.id}`
			: target.kind === 'group'
				? `g${target.guid}`
				: target.kind;
	}

	function accepts(target: DropTarget): boolean {
		if (!canManage) return false;
		if (target.kind === 'all-groups') return scope.kind === 'group';
		if (target.kind === 'group') {
			const g = groups.find((x) => x.guid === target.guid);
			return !!g && !isTagGroup(g);
		}
		return true;
	}

	function dragover(e: DragEvent, target: DropTarget) {
		if (!dragging || !accepts(target)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		over = key(target);
	}

	function dragleave(e: DragEvent, target: DropTarget) {
		const el = e.currentTarget as HTMLElement;
		if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
		if (over === key(target)) over = null;
	}

	function dropOn(e: DragEvent, target: DropTarget) {
		e.preventDefault();
		over = null;
		const id = e.dataTransfer?.getData('text/plain');
		if (id && accepts(target)) ondrop(target, id);
	}

	function sameScope(a: Scope, b: Scope): boolean {
		if (a.kind !== b.kind) return false;
		if (a.kind === 'folder' && b.kind === 'folder') return a.id === b.id;
		if (a.kind === 'group' && b.kind === 'group') return a.guid === b.guid;
		return true;
	}

	function contextmenu(e: MouseEvent, id: string) {
		if (!canManage) return;
		e.preventDefault();
		menuFor = id;
	}

	$effect(() => {
		if (!dragging) over = null;
	});
</script>

{#snippet entry(label: string, count: number, target: Scope, into?: DropTarget, color?: string)}
	{@const active = sameScope(scope, target)}
	<button
		type="button"
		class={['filter-option', active && 'active', into && over === key(into) && 'drag-over']}
		aria-pressed={active}
		onclick={() => onscope(target)}
		ondragover={into ? (e) => dragover(e, into) : undefined}
		ondragleave={into ? (e) => dragleave(e, into) : undefined}
		ondrop={into ? (e) => dropOn(e, into) : undefined}
	>
		{#if color}<span class="folder-mark" style:--folder-color={color} aria-hidden="true"></span>{/if}
		<span class="chip-label">{label}</span>
		<span class="chip-count">{formatNumber(count)}</span>
	</button>
{/snippet}

<nav class="scopes" aria-label={tf('devices.scopes_label', 'Folders and groups')}>
	<div class="filter-block">
		<div class="filter-head">
			<h2 id="{uid}-folders">{t('folders.title')}</h2>
			{#if canManage}
				<Button size="sm" variant="ghost" icon={ICONS.add} class="filter-add" onclick={onnewfolder}
					>{t('folders.create')}</Button
				>
			{/if}
		</div>
		<ul class="filter-list" aria-labelledby="{uid}-folders">
			<li class="filter-item">{@render entry(t('folders.all_devices'), counts.all, { kind: 'all' })}</li>
			<li class="filter-item">
				{@render entry(
					t('folders.unassigned'),
					counts.unassigned,
					{ kind: 'unassigned' },
					{ kind: 'unassigned' }
				)}
			</li>
			{#each folders as f (f.id)}
				<li
					class={['filter-item', menuFor === `f${f.id}` && 'menu-open']}
					oncontextmenu={(e) => contextmenu(e, `f${f.id}`)}
				>
					{@render entry(
						f.name,
						counts.folders.get(f.id) ?? 0,
						{ kind: 'folder', id: f.id },
						{ kind: 'folder', id: f.id },
						folderColor(f.color)
					)}
					{#if canManage}
						<MenuButton
							kebab
							class="chip-menu"
							label="{t('devices.actions')}: {f.name}"
							bind:open={() => menuFor === `f${f.id}`, (v) => (menuFor = v ? `f${f.id}` : null)}
						>
							<MenuItem icon={ICONS.edit} onselect={() => oneditfolder(f)}>{t('actions.edit')}</MenuItem>
							<MenuDivider />
							<MenuItem icon={ICONS.delete} danger onselect={() => ondeletefolder(f)}
								>{t('actions.delete')}</MenuItem
							>
						</MenuButton>
					{/if}
				</li>
			{/each}
		</ul>
	</div>

	<div class="filter-block">
		<div class="filter-head">
			<h2 id="{uid}-groups">{t('device_detail.device_groups')}</h2>
			{#if canManage}
				<Button size="sm" variant="ghost" icon={ICONS.add} class="filter-add" onclick={onnewgroup}
					>{t('devices.create_group')}</Button
				>
			{/if}
		</div>
		<ul class="filter-list" aria-labelledby="{uid}-groups">
			<li class="filter-item all-groups">
				{@render entry(t('devices.all_groups'), counts.all, { kind: 'all' }, { kind: 'all-groups' })}
			</li>
			{#each groups as g (g.guid)}
				{@const guid = g.guid ?? ''}
				<li
					class={['filter-item', menuFor === `g${guid}` && 'menu-open']}
					oncontextmenu={(e) => contextmenu(e, `g${guid}`)}
				>
					{@render entry(
						g.name || guid,
						counts.groups.get(guid) ?? 0,
						{ kind: 'group', guid },
						{ kind: 'group', guid }
					)}
					{#if canManage}
						<MenuButton
							kebab
							class="chip-menu"
							label="{t('devices.actions')}: {g.name}"
							bind:open={() => menuFor === `g${guid}`, (v) => (menuFor = v ? `g${guid}` : null)}
						>
							{#if canBilling}
								<MenuItem icon={ICONS.billing} onselect={() => onbilling(g)}
									>{t('devices.group_commercialization')}</MenuItem
								>
							{/if}
							<MenuItem icon={ICONS.edit} onselect={() => oneditgroup(g)}>{t('actions.edit')}</MenuItem>
							<MenuDivider />
							<MenuItem icon={ICONS.delete} danger onselect={() => ondeletegroup(g)}
								>{t('actions.delete')}</MenuItem
							>
						</MenuButton>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</nav>

<style>
	/* Rows hang their padding outside the column, as table and list rows do */
	.scopes {
		display: block;
		margin-inline-start: calc(-1 * var(--row-pad-x));
		padding-bottom: var(--space-2);
	}
	.filter-block + .filter-block {
		margin-top: var(--space-5);
	}
	/* Heading row: the height, rules and type of the table's header row */
	.filter-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: 40px;
		padding-inline-start: var(--row-pad-x);
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
	}
	.filter-head h2 {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.filter-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/* Name and count, then a column for the ⋮ menu, so every count ends on the same line */
	.filter-item {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) var(--control-h-sm);
		align-items: center;
	}
	.all-groups {
		display: none;
	}
	.filter-option {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		min-height: var(--control-h);
		padding: var(--space-1) var(--space-2) var(--space-1) calc(var(--row-pad-x) - 2px);
		border: 0;
		border-inline-start: 2px solid transparent;
		border-start-end-radius: var(--radius);
		border-end-end-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.filter-option:hover {
		background: var(--hover);
	}
	.filter-option:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.filter-option.active {
		border-inline-start-color: var(--accent);
		background: var(--bg-subtle);
		font-weight: 600;
	}
	/* A device row is dragged over an entry that takes it */
	.filter-option.drag-over {
		border-inline-start-color: var(--accent);
		background: var(--accent-tint);
	}
	.chip-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip-count {
		margin-inline-start: auto;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.folder-mark {
		width: 8px;
		height: 8px;
		flex-shrink: 0;
		border-radius: 1px;
		background: var(--folder-color, var(--text-muted));
	}
	/* The ⋮ menu shows on hover or keyboard focus; always on touch */
	.filter-item > :global(.chip-menu) {
		opacity: 0;
	}
	.filter-item:hover > :global(.chip-menu),
	.filter-item > :global(.chip-menu:focus-within),
	.filter-item.menu-open > :global(.chip-menu) {
		opacity: 1;
	}
	@media (pointer: coarse) {
		.filter-item > :global(.chip-menu) {
			opacity: 1;
		}
	}

	/* Narrow: folders and groups become two scrolling rows of text */
	@media (max-width: 899px) {
		.scopes {
			display: flex;
			flex-direction: column;
			gap: var(--space-2);
			margin-inline-start: 0;
			padding: 0;
		}
		.filter-block + .filter-block {
			margin-top: 0;
		}
		.filter-block {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			overflow-x: auto;
			scrollbar-width: none;
		}
		.filter-head {
			flex-shrink: 0;
			min-height: 0;
			padding: 0;
			border: 0;
		}
		.filter-head h2 {
			font-weight: 400;
		}
		.filter-head :global(.filter-add) {
			order: 2;
		}
		.filter-list {
			display: flex;
			flex-shrink: 0;
		}
		.filter-item {
			display: flex;
		}
		.all-groups {
			display: flex;
		}
		.filter-option {
			flex: none;
			border-inline-start: 0;
			border-bottom: 2px solid transparent;
			border-radius: 0;
			white-space: nowrap;
		}
		.filter-option.active {
			border-bottom-color: var(--accent);
			background: transparent;
		}
		.filter-option.drag-over {
			border-bottom-color: var(--accent);
			background: var(--accent-tint);
		}
		.filter-item > :global(.chip-menu) {
			display: none;
		}
	}
</style>
