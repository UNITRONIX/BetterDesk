<!-- Test scenes for overlays.test.ts (menus, dialogs, sheets). Not shipped. -->
<script lang="ts">
	import Button from '../../../src/lib/ui/Button.svelte';
	import Dialog from '../../../src/lib/ui/Dialog.svelte';
	import DialogHost from '../../../src/lib/ui/DialogHost.svelte';
	import MenuButton from '../../../src/lib/ui/MenuButton.svelte';
	import MenuDivider from '../../../src/lib/ui/MenuDivider.svelte';
	import MenuItem from '../../../src/lib/ui/MenuItem.svelte';
	import Sheet from '../../../src/lib/ui/Sheet.svelte';
	import { confirm } from '../../../src/lib/ui/dialogs.svelte.ts';

	interface Props {
		scene: 'menus' | 'radio' | 'dialog' | 'sheet' | 'sheets';
		blocking?: boolean;
		onselect?: (what: string) => void;
		onanswer?: (answer: boolean) => void;
	}

	let { scene, blocking = false, onselect, onanswer }: Props = $props();

	let dialogOpen = $state(false);
	let sheetOpen = $state(false);
	let otherOpen = $state(false);
	let platform = $state(true);
	let lang = $state('en');
	let status = $state('');
	let tone = $state<'neutral' | 'ok' | 'error'>('neutral');

	async function remove() {
		onanswer?.(
			await confirm({
				title: 'Delete target?',
				message: 'It leaves the list.',
				confirmLabel: 'Delete',
				danger: true
			})
		);
	}
</script>

{#if scene === 'menus'}
	<button type="button">Before</button>
	<MenuButton label="Actions">
		<MenuItem icon="edit" onselect={() => onselect?.('edit')}>Edit</MenuItem>
		<MenuItem icon="tags" onselect={() => onselect?.('tags')}>Tags</MenuItem>
		<MenuItem icon="folder" disabled onselect={() => onselect?.('archive')}>Archive</MenuItem>
		<MenuItem icon="folder" onselect={() => onselect?.('move')}>Move to folder</MenuItem>
		<MenuItem type="checkbox" bind:checked={platform} onselect={() => onselect?.(`platform:${platform}`)}
			>Platform</MenuItem
		>
		<MenuDivider />
		<MenuItem icon="delete" danger onselect={() => onselect?.('delete')}>Delete…</MenuItem>
	</MenuButton>
	<MenuButton kebab label="Row actions">
		<MenuItem icon="connect" onselect={() => onselect?.('connect')}>Connect</MenuItem>
		<MenuItem icon="copy" onselect={() => onselect?.('copy')}>Copy ID</MenuItem>
	</MenuButton>
	<button type="button">After</button>
{:else if scene === 'radio'}
	<MenuButton label="Language">
		{#each [['en', 'English'], ['de', 'Deutsch']] as [code, name] (code)}
			<MenuItem
				type="radio"
				checked={lang === code}
				lang={code}
				onselect={() => {
					lang = code!;
					onselect?.(code!);
				}}
			>
				{#snippet lead()}<span class="flag">{code}</span>{/snippet}
				{name}
			</MenuItem>
		{/each}
	</MenuButton>
{:else if scene === 'dialog'}
	<Button onclick={() => (dialogOpen = true)}>Open</Button>
	<Dialog bind:open={dialogOpen} title="Rename tag" message="The new name shows on every device." {blocking}>
		<label for="tag-name">Name</label>
		<input id="tag-name" value="office" />
		{#snippet footer()}
			<Button onclick={() => (dialogOpen = false)}>Cancel</Button>
			<Button variant="primary" onclick={() => (dialogOpen = false)}>Rename</Button>
		{/snippet}
	</Dialog>
{:else if scene === 'sheets'}
	<Button onclick={() => (sheetOpen = true)}>Open first</Button>
	<Sheet bind:open={sheetOpen} title="First">
		<Button onclick={() => (otherOpen = true)}>Open second</Button>
	</Sheet>
	<Sheet bind:open={otherOpen} title="Second" wide>
		<p>Second sheet</p>
	</Sheet>
{:else}
	<Button onclick={() => (sheetOpen = true)}>Edit target</Button>
	<Sheet
		bind:open={sheetOpen}
		title="Edit target"
		subtitle="A computer without the client."
		{status}
		statusTone={tone}
	>
		<label for="host">Host</label>
		<input id="host" value="10.0.9.14" />
		<MenuButton kebab label="More">
			<MenuItem onselect={() => onselect?.('dup')}>Duplicate</MenuItem>
		</MenuButton>
		{#snippet footer()}
			<Button class="sheet-footer-start" onclick={() => (sheetOpen = false)}>Cancel</Button>
			<Button
				onclick={() => {
					status = 'Reached 10.0.9.14 on port 3389.';
					tone = 'ok';
				}}>Test connection</Button
			>
			<Button variant="danger-quiet" onclick={remove}>Delete…</Button>
			<Button variant="primary">Save</Button>
		{/snippet}
	</Sheet>
	<DialogHost />
{/if}
