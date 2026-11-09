/**
 * The self-hosted Material Symbols subset (static/fonts) has a glyph for
 * every icon the console draws. A name missing from the font draws nothing:
 * the icon box is 1em wide and hides the text, so the button looks empty.
 * scripts/icon-names.mjs finds the names (also the ones picked at run time),
 * scripts/update-material-symbols.mjs at the repo root builds the font from
 * them. The first block checks that the scan reads the ways the console
 * writes icon names; the last test checks the font against the scan.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ICONS } from '../../src/lib/util/display.ts';
import { collectCandidateIcons, iconNamesIn, readMeanings } from '../../scripts/icon-names.mjs';

const root = path.resolve(__dirname, '../..');

function subset(): Set<string> {
	const text = fs.readFileSync(path.join(root, 'static/fonts/MATERIAL_SYMBOLS_VERSION.txt'), 'utf8');
	const lines = text.split(/\r?\n/);
	const list = lines[lines.indexOf('Icons (alphabetical):') + 1] ?? '';
	return new Set(list.split(',').filter(Boolean));
}

const scan = (text: string, file = 'src/lib/Example.svelte') => iconNamesIn(text, file).sort();

let candidates: Map<string, Set<string>> | undefined;
const scanned = () => (candidates ??= collectCandidateIcons());

describe('icon name scan', () => {
	test('reads names written straight into Icon, icon props and icon fields', () => {
		const text = `<Icon name="devices" /><IconButton icon="close" label="x" />
<MenuItem trailingIcon="open_in_new">x</MenuItem>
<script>const BOTTOM = [{ id: 'home', icon: 'home', labelKey: 'mobile_nav.home' }];</script>`;
		expect(scan(text)).toEqual(['close', 'devices', 'home', 'open_in_new']);
	});

	test('reads the names a derived icon variable picks, like the theme toggle in the top bar', () => {
		const text = `<script lang="ts">
	const themeIcon = $derived(
		theme.choice === 'light' ? 'light_mode' : theme.choice === 'dark' ? 'dark_mode' : 'contrast'
	);
</script>
<IconButton icon={themeIcon} label="Theme" />`;
		expect(scan(text)).toEqual(['contrast', 'dark_mode', 'light_mode']);
	});

	test('reads a choice inside Icon name, also when the tag spans lines', () => {
		const text = `<Icon name={open ? 'expand_more' : 'expand_less'} class="account-chevron" />
<span class="bar-label">Controls</span><Icon
	name={viewer.controlsShown ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
	class="btn-caret"
/>
<Icon name={f.dir ? 'folder' : 'description'} />`;
		expect(scan(text)).toEqual([
			'description',
			'expand_less',
			'expand_more',
			'folder',
			'keyboard_arrow_down',
			'keyboard_arrow_up'
		]);
	});

	test('reads typed icon maps and what an icon function returns', () => {
		const text = `<script lang="ts">
	const ICON: Record<PhaseState, string> = {
		pending: 'radio_button_unchecked',
		active: 'sync',
		skipped: 'remove_circle_outline'
	};
	export function fileIcon(e: FileEntry): string {
		return e.dir ? 'folder' : 'description';
	}
</script>
<Icon name={ICON[st]} />`;
		expect(scan(text)).toEqual([
			'description',
			'folder',
			'radio_button_unchecked',
			'remove_circle_outline',
			'sync'
		]);
	});

	test('reads the file sheet the remote viewer loads from static/rdclient', () => {
		const text = `
    static getFileIcon(entry) {
        if (entry.isDir) {
            if (entry.entryType === 3) return 'storage'; // Drive
            return 'folder';
        }
        const imageExts = ['jpg', 'png', 'gif'];
        if (imageExts.includes(ext)) return 'image';
        return 'insert_drive_file';
    }
        function addItem(label, icon, action) {
            btn.innerHTML = '<span class="material-icons">' + icon + '</span><span>' + escapeHtml(label) + '</span>';
        }
        addItem(t('remote.file_rename', 'Rename'), 'drive_file_rename_outline', function () {});
        addItem(t('actions.delete', 'Delete'), 'delete_outline', function () {});
        row.innerHTML = '<span class="material-icons ft-row-icon">' + (entry.isDir ? 'folder_open' : 'description') + '</span>';
        var icon = meta.type === 'upload' ? 'upload' : 'download';
        if (meta.isFolder) icon = meta.type === 'upload' ? 'drive_folder_upload' : 'folder_zip';
        if (meta.phase === 'pending') icon = 'hourglass_empty';`;
		expect(scan(text, 'static/rdclient/file-modal.js')).toEqual([
			'delete_outline',
			'description',
			'download',
			'drive_file_rename_outline',
			'drive_folder_upload',
			'folder',
			'folder_open',
			'folder_zip',
			'hourglass_empty',
			'image',
			'insert_drive_file',
			'storage',
			'upload'
		]);
	});

	test('reads CSS content in a Svelte style block', () => {
		const text = `<details><summary>x</summary></details>
<style>
	summary::after {
		font-family: 'Material Symbols Outlined';
		content: 'expand_more';
	}
</style>`;
		expect(scan(text)).toEqual(['expand_more']);
	});

	test('leaves out ordinary words next to icons', () => {
		const text = `<script lang="ts">
	export function dayOf(ts: number): string {
		if (same) return 'today';
		return 'yesterday';
	}
	const filterOptions = [{ value: 'none', label: tr('filter_none', 'None') }];
	const icon = document.querySelector('link[rel="icon"]');
</script>
<MenuItem icon={ICONS.view} onselect={() => (sheet = { kind: 'output', task: x })}>{label}</MenuItem>
<Button icon={ICONS.download} onclick={() => void downloadAs('csv')}>CSV</Button>`;
		expect(scan(text)).toEqual([]);
	});
});

describe('icon font subset', () => {
	test('the subset list is readable', () => {
		expect(subset().size).toBeGreaterThan(100);
		expect(subset().has('devices')).toBe(true);
	});

	test('the scan turns meanings into glyphs with the same table as the Icon component', () => {
		expect(readMeanings()).toEqual(ICONS);
	});

	test('the scan covers the scripts the remote viewer loads from static', () => {
		const files = new Set([...scanned().values()].flatMap((f) => [...f]));
		expect(files).toContain('static/rdclient/file-modal.js');
		expect(files).toContain('src/lib/shell/Topbar.svelte');
	});

	test('has a glyph for every icon the console draws', () => {
		const have = subset();
		const missing: Record<string, string[]> = {};
		for (const [name, files] of scanned()) if (!have.has(name)) missing[name] = [...files];
		// Run `node scripts/update-material-symbols.mjs` from the repo root when this fails
		expect(missing).toEqual({});
	});
});
