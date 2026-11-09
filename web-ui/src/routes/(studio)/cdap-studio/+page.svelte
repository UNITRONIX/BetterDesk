<!--
  Flow builder (/cdap-studio, old cdap-studio.ejs and cdap-studio.js): a
  full-window node editor for data flows. Node list on the start side, the
  canvas in the middle, node settings and the log on the end side; both
  side panels fold to a strip (remembered per browser), the log folds to
  its latest line. Toolbar: New, Open (a sheet with the saved flows), Save,
  Test run, Deploy, Undo, Redo and More (name and description, templates,
  import, download as .bdflow, the flow as JSON), snap to grid and zoom.

  Allowed for operator, admin and super_admin (requireRole('operator'),
  DECISIONS R5); other roles get the no-access page and no requests.
  Data: GET /api/cdap-studio/flows once on load (a warning when the server
  can't store flows), the rest on demand.

  Keys (not while typing or while a dialog is open): Delete or Backspace
  removes the selected node or connection, Ctrl+Z undoes, Ctrl+Y redoes,
  Ctrl+S saves.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		createFlow,
		deleteFlow,
		deployFlow,
		flowExportUrl,
		getFlow,
		listFlows,
		listTemplates,
		testFlow,
		updateFlow,
		type FlowSummary,
		type FlowTemplate
	} from '#lib/api/cdapStudio.ts';
	import {
		addNode,
		bdflowFileName,
		CATEGORIES,
		categoryOf,
		configLabel,
		connect,
		GRID,
		jsonPreview,
		lastNodeNumber,
		NODE_DEFS,
		NODE_H,
		NODE_W,
		nodeLabel,
		nodePorts,
		nodeSubtitle,
		normalizeFlow,
		parseBdflow,
		parseFlowJson,
		removeNode,
		toBdflow,
		typesOf,
		wireEnd,
		type Flow,
		type FlowNode
	} from '#lib/canvas/flow.ts';
	import { bounds, zoomTo, type View } from '#lib/canvas/geometry.ts';
	import { History } from '#lib/canvas/history.svelte.ts';
	import NodeCanvas, { type PortRef } from '#lib/canvas/NodeCanvas.svelte';
	import { formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { openLayers } from '#lib/ui/layers.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import { readPref, writePref } from '#lib/util/storage.ts';
	import NodeSettings from './NodeSettings.svelte';

	const allowed = $derived(['operator', 'admin', 'super_admin'].includes(session.user?.role ?? ''));
	const tr = (key: string, fallback: string) => tf(key, fallback);
	const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

	/* ── The flow ── */

	let flow = $state<Flow>({ nodes: [], wires: [] });
	let meta = $state({ id: null as string | null, name: '', description: '' });
	const untitled = () => t('sdk_studio.untitled');
	const flowName = $derived(meta.name || untitled());
	let lastId = 0;
	const history = new History<Flow>(50);
	let selectedNode = $state<string | null>(null);
	let selectedWire = $state<string | null>(null);
	let view = $state<View>({ x: 0, y: 0, zoom: 1 });
	let showGrid = $state(true);
	let canvas = $state<ReturnType<typeof NodeCanvas<FlowNode>> | null>(null);

	type Deploy = 'neutral' | 'good' | 'danger';
	let deploy = $state<Deploy>('neutral');
	const deployLabel = $derived(
		deploy === 'good'
			? t('sdk_studio.status_deployed')
			: deploy === 'danger'
				? t('sdk_studio.status_deploy_failed')
				: t('sdk_studio.status_ready')
	);

	const node = $derived(flow.nodes.find((n) => n.id === selectedNode) ?? null);
	const wires = $derived(flow.wires.map((w, i) => ({ key: String(i), ...w })));

	function snapshot(): Flow {
		return $state.snapshot(flow) as Flow;
	}

	function change(fn: () => void) {
		history.push(snapshot());
		fn();
	}

	function replaceFlow(next: Flow) {
		flow = next;
		lastId = lastNodeNumber(next);
		selectedNode = null;
		selectedWire = null;
	}

	function undo() {
		const prev = history.undo(snapshot());
		if (!prev) return;
		flow = prev;
		selectedNode = null;
		selectedWire = null;
		log(t('sdk_studio.log_undo'));
	}

	function redo() {
		const next = history.redo(snapshot());
		if (!next) return;
		flow = next;
		selectedNode = null;
		selectedWire = null;
		log(t('sdk_studio.log_redo'));
	}

	/* ── Log ── */

	type Level = 'info' | 'success' | 'warn' | 'error' | 'data';
	interface Line {
		id: number;
		time: string;
		level: Level;
		text: string;
	}
	let lines = $state.raw<Line[]>([]);
	let lineId = 0;
	const last = $derived(lines.at(-1) ?? null);
	let logOpen = $state(readPref('bd.studio.log') === '1');
	let logBody = $state<HTMLElement | null>(null);

	function clock(): string {
		const d = new Date();
		return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
	}

	function log(text: string, level: Level = 'info') {
		lines = [...lines, { id: ++lineId, time: clock(), level, text }];
	}

	function setLogOpen(open: boolean, remember: boolean) {
		logOpen = open;
		if (remember) writePref('bd.studio.log', open ? '1' : '0');
	}

	$effect(() => {
		void lines.length;
		const el = logBody;
		if (logOpen && el) el.scrollTop = el.scrollHeight;
	});

	/* ── Panels ── */

	let paletteOpen = $state(readPref('bd.studio.btn-toggle-palette') !== '0');
	let settingsOpen = $state(readPref('bd.studio.btn-toggle-inspector') !== '0');

	function togglePalette() {
		paletteOpen = !paletteOpen;
		writePref('bd.studio.btn-toggle-palette', paletteOpen ? '1' : '0');
	}

	function toggleSettings() {
		settingsOpen = !settingsOpen;
		writePref('bd.studio.btn-toggle-inspector', settingsOpen ? '1' : '0');
	}

	let search = $state('');
	let closedCats = $state<Record<string, boolean>>({});
	const catLabel = (cat: string) =>
		cat === 'processing'
			? t('sdk_studio.cat_processing')
			: cat === 'outputs'
				? t('sdk_studio.cat_outputs')
				: t('sdk_studio.cat_sources');
	const visibleTypes = (cat: (typeof CATEGORIES)[number]) => {
		const q = search.trim().toLowerCase();
		return typesOf(cat).filter((type) => !q || nodeLabel(type, tr).toLowerCase().includes(q));
	};

	/* ── Editing ── */

	function place(type: string, x: number, y: number, select: boolean) {
		if (!NODE_DEFS[type]) return;
		history.push(snapshot());
		const added = addNode(flow, type, x, y, 'n' + ++lastId, nodeLabel(type, tr));
		if (added && select) selectedNode = added.id;
		log(t('sdk_studio.log_node_added', { name: nodeLabel(type, tr) }), 'success');
	}

	/** Click or Enter in the node list: in the middle of the visible canvas, a little apart from the last one */
	function addAtCentre(type: string) {
		const c = canvas?.centre() ?? { x: 0, y: 0 };
		const shift = (flow.nodes.length % 5) * 24;
		place(type, c.x - NODE_W / 2 + shift / view.zoom, c.y - NODE_H / 2 + shift / view.zoom, true);
	}

	function deleteNode(id: string) {
		change(() => removeNode(flow, id));
		if (selectedNode === id) selectedNode = null;
		log(t('sdk_studio.log_node_deleted'), 'warn');
	}

	function deleteWire(index: number) {
		if (index < 0 || index >= flow.wires.length) return;
		change(() => flow.wires.splice(index, 1));
		selectedWire = null;
		log(t('sdk_studio.log_wire_removed'), 'warn');
	}

	function onconnect(a: PortRef, b: PortRef) {
		const before = snapshot();
		if (connect(flow, a, b)) {
			history.push(before);
			log(t('sdk_studio.log_wire_connected'), 'success');
		}
	}

	// A move is one undo step: the state before the drag, kept once it really moved
	let beforeMove: Flow | null = null;
	function onmovestart() {
		beforeMove = snapshot();
	}
	function onmove(id: string, x: number, y: number) {
		const n = flow.nodes.find((q) => q.id === id);
		if (n) {
			n.x = x;
			n.y = y;
		}
	}
	function onmoveend() {
		if (beforeMove) history.push(beforeMove);
		beforeMove = null;
	}

	function setLabel(label: string) {
		const n = node;
		if (!n) return;
		change(() => (n.label = label));
	}

	function setConfig(key: string, value: unknown) {
		const n = node;
		if (!n) return;
		change(() => (n.config[key] = value));
	}

	/* ── Zoom ── */

	const MIN_ZOOM = 0.25;
	const MAX_ZOOM = 4;
	const zoomBy = (factor: number) => (view = zoomTo(view, view.zoom * factor, MIN_ZOOM, MAX_ZOOM));
	// On touch screens fitting stops at 85 %, where a node is still 44 px high to tap and drag
	const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	const fit = () => canvas?.fit({ pad: 60, min: coarse() ? 0.85 : MIN_ZOOM, max: 2 });
	const fitSoon = () => requestAnimationFrame(() => fit());

	/* ── Server ── */

	let storeFailed = $state(false);
	$effect(() => {
		if (!allowed) return;
		untrack(() => {
			log(t('sdk_studio.console_ready'));
			listFlows().then(
				() => (storeFailed = false),
				() => (storeFailed = true)
			);
		});
	});

	// The save dialog: opened by Save on a new flow, by "Name and description…", and before
	// a test run or deploy of a flow that was never saved (it carries on after saving)
	let saveDialog = $state<{ note: string; status: string } | null>(null);
	let saveName = $state('');
	let saveDescription = $state('');
	let afterSave: (() => void) | null = null;
	let saving = $state(false);

	function openSave(note: string, then: (() => void) | null) {
		afterSave = then;
		saveName = meta.name || untitled();
		saveDescription = meta.description;
		saveDialog = { note, status: '' };
	}

	function closeSave() {
		saveDialog = null;
		afterSave = null;
	}

	function save() {
		if (meta.id) void doSave();
		else openSave('', null);
	}

	async function doSave() {
		if (saving) return;
		if (saveDialog) {
			meta.name = saveName.trim() || untitled();
			meta.description = saveDescription.trim();
		}
		const body = {
			name: meta.name || untitled(),
			description: meta.description,
			flow_json: JSON.stringify(snapshot())
		};
		saving = true;
		try {
			if (meta.id) await updateFlow(meta.id, body);
			else meta.id = await createFlow(body);
			meta.name = body.name;
			saveDialog = null;
			const done = t('sdk_studio.log_saved', { name: body.name });
			log(done, 'success');
			toast.success(done);
			const next = afterSave;
			afterSave = null;
			next?.();
		} catch (err) {
			const msg = t('sdk_studio.log_save_failed', { error: message(err) });
			log(msg, 'error');
			if (saveDialog) saveDialog.status = msg;
			else toast.error(msg);
		} finally {
			saving = false;
		}
	}

	async function runTest() {
		if (!meta.id) {
			openSave(t('sdk_studio.save_first_test_note'), () => void runTest());
			return;
		}
		setLogOpen(true, false);
		log(t('sdk_studio.log_test_started'));
		try {
			const run = await testFlow(meta.id);
			log(t('sdk_studio.log_test_done', { nodes: run.nodeCount, wires: run.wireCount }), 'success');
			for (const r of run.results ?? []) log(`  [${r.label}] → ${JSON.stringify(r.output)}`, 'data');
		} catch (err) {
			const msg = t('sdk_studio.log_test_failed', { error: message(err) });
			log(msg, 'error');
			toast.error(msg);
		}
	}

	async function runDeploy() {
		if (!meta.id) {
			openSave(t('sdk_studio.save_first_deploy_note'), () => void runDeploy());
			return;
		}
		try {
			await deployFlow(meta.id);
			const done = t('sdk_studio.log_deployed', { name: flowName });
			log(done, 'success');
			toast.success(done);
			deploy = 'good';
		} catch (err) {
			deploy = 'danger';
			const msg = t('sdk_studio.log_deploy_failed', { error: message(err) });
			log(msg, 'error');
			toast.error(msg);
		}
	}

	function newFlow() {
		replaceFlow({ nodes: [], wires: [] });
		meta = { id: null, name: '', description: '' };
		history.clear();
		view = { x: 0, y: 0, zoom: 1 };
		deploy = 'neutral';
		log(t('sdk_studio.log_new_flow'));
	}

	async function openFlow(id: string) {
		openSheet = false;
		try {
			const stored = await getFlow(id);
			meta = { id: stored.id, name: stored.name, description: stored.description };
			replaceFlow(parseFlowJson(stored.flow_json));
			history.clear();
			deploy = stored.status === 'deployed' ? 'good' : 'neutral';
			fitSoon();
			log(t('sdk_studio.log_flow_opened', { name: flowName }), 'success');
		} catch (err) {
			const msg = t('sdk_studio.log_open_failed', { error: message(err) });
			log(msg, 'error');
			toast.error(msg);
		}
	}

	/* ── Files ── */

	function download() {
		const file = toBdflow(
			{ name: flowName, description: meta.description },
			snapshot(),
			session.user?.username ?? ''
		);
		const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = bdflowFileName(flowName);
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
		log(t('sdk_studio.log_exported'), 'success');
	}

	let fileInput = $state<HTMLInputElement | null>(null);

	function chooseFile() {
		if (!fileInput) return;
		fileInput.value = '';
		fileInput.click();
	}

	async function importFile(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		if (!file) return;
		const parsed = parseBdflow(await file.text());
		if (!parsed.ok) {
			const msg =
				parsed.reason === 'invalid'
					? t('sdk_studio.log_import_invalid')
					: t('sdk_studio.log_import_failed', { error: parsed.message });
			log(msg, 'error');
			toast.error(msg);
			return;
		}
		replaceFlow(parsed.flow);
		meta = { id: null, name: parsed.name || untitled(), description: parsed.description };
		history.clear();
		deploy = 'neutral';
		fitSoon();
		const done = t('sdk_studio.log_imported', { name: meta.name });
		log(done, 'success');
		toast.success(done);
	}

	function showJson() {
		setLogOpen(true, false);
		const preview = jsonPreview(snapshot());
		log(t('sdk_studio.log_json_heading'));
		for (const line of preview.lines) log(line, 'data');
		if (preview.more) log(t('sdk_studio.log_json_more', { count: preview.more }));
	}

	/* ── Open flow sheet ── */

	let openSheet = $state(false);
	let flows = $state.raw<FlowSummary[] | null>(null);
	let flowsError = $state(false);

	async function loadFlows() {
		flowsError = false;
		try {
			flows = await listFlows();
			storeFailed = false;
		} catch (err) {
			flows = null;
			flowsError = true;
			log(t('sdk_studio.log_list_failed', { error: message(err) }), 'error');
		}
	}

	// "Changed 3h ago by anna" with the time and the person as components; only what is known
	const TIME = '{time}';
	const USER = '{user}';
	function changedParts(when: string, by: string): string[] {
		const text = when && by ? t('sdk_studio.flow_changed') : when ? t('sdk_studio.flow_changed_at') : USER;
		return text.split(/(\{time\}|\{user\})/).filter(Boolean);
	}

	function showOpen() {
		flows = null;
		openSheet = true;
		void loadFlows();
	}

	async function removeFlow(f: FlowSummary) {
		const ok = await confirm({
			title: t('sdk_studio.delete_title'),
			message: t('sdk_studio.confirm_delete', { name: f.name }),
			confirmLabel: t('sdk_studio.delete_flow'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteFlow(f.id);
			if (meta.id === f.id) meta.id = null;
			const done = t('sdk_studio.log_flow_deleted', { name: f.name });
			toast.success(done);
			log(done, 'warn');
		} catch (err) {
			const msg = t('sdk_studio.log_delete_failed', { error: message(err) });
			toast.error(msg);
			log(msg, 'error');
		}
		void loadFlows();
	}

	/* ── Templates dialog ── */

	let templatesOpen = $state(false);
	let templates = $state.raw<FlowTemplate[] | null>(null);
	let templatesError = $state(false);

	async function showTemplates() {
		templatesOpen = true;
		templates = null;
		templatesError = false;
		try {
			templates = await listTemplates();
		} catch {
			templatesError = true;
		}
	}

	function useTemplate(tpl: FlowTemplate) {
		if (!tpl.flow) return;
		templatesOpen = false;
		history.push(snapshot());
		replaceFlow(normalizeFlow(structuredClone(tpl.flow)));
		meta = { id: null, name: tpl.name, description: tpl.description };
		deploy = 'neutral';
		fitSoon();
		log(t('sdk_studio.log_template_opened', { name: tpl.name }), 'success');
	}

	/* ── Keys ── */

	function onkeydown(e: KeyboardEvent) {
		if (!allowed || openLayers() > 0) return;
		const el = e.target instanceof HTMLElement ? e.target : null;
		if (el && (el.matches('input, textarea, select') || el.isContentEditable)) return;
		const ctrl = e.ctrlKey || e.metaKey;
		if ((e.key === 'Delete' || e.key === 'Backspace') && !ctrl) {
			if (selectedNode) {
				e.preventDefault();
				deleteNode(selectedNode);
			} else if (selectedWire !== null) {
				e.preventDefault();
				deleteWire(Number(selectedWire));
			}
			return;
		}
		if (!ctrl || e.altKey) return;
		const key = e.key.toLowerCase();
		if (key === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if (key === 'y') {
			e.preventDefault();
			redo();
		} else if (key === 's') {
			e.preventDefault();
			save();
		}
	}

	/* ── Minimap ── */

	const map = $derived.by(() => {
		const box = bounds(flow.nodes, NODE_W, NODE_H);
		if (!box) return null;
		const pad = 40;
		return {
			viewBox: `${box.minX - pad} ${box.minY - pad} ${box.maxX - box.minX + pad * 2} ${box.maxY - box.minY + pad * 2}`
		};
	});
	const byId = $derived(new Map(flow.nodes.map((n) => [n.id, n])));
</script>

<svelte:head><title>{`${t('nav.sdk_studio')} - ${session.appName}`}</title></svelte:head>
<svelte:document {onkeydown} />

{#snippet nodeBody(n: FlowNode)}
	{@const kind = categoryOf(n.type)}
	<rect class={['node-body', selectedNode === n.id && 'is-selected']} width={NODE_W} height={NODE_H} rx="3" />
	<rect class={['node-accent', `is-${kind}`]} width="4" height={NODE_H} />
	<text class="node-label" x="16" y="22">{(n.label || NODE_DEFS[n.type]?.label || n.type).slice(0, 20)}</text>
	<text class="node-type" x="16" y="38">{nodeSubtitle(n, tr).slice(0, 26)}</text>
{/snippet}

{#if !allowed}
	<main class="denied" id="main-content"><NoAccess /></main>
{:else}
	<main class="studio" id="main-content">
		<header class="studio-head">
			<a href={link('/')} class="studio-back">{t('sdk_studio.back_console')}</a>
			<h1>{t('nav.sdk_studio')}</h1>
			<p class="studio-description">{t('sdk_studio.page_description')}</p>
		</header>

		<div class="studio-toolbar" role="toolbar" aria-label={t('nav.sdk_studio')}>
			<div class="toolbar-part">
				<span class="flow-name" title={flowName}>{flowName}</span>
				<Button size="sm" icon={ICONS.add} onclick={newFlow}>{t('sdk_studio.new_flow')}</Button>
				<Button size="sm" onclick={showOpen}>{t('sdk_studio.open_flow')}</Button>
				<Button size="sm" variant="primary" busy={saving && !saveDialog} onclick={save}
					>{t('sdk_studio.save_flow')}</Button
				>
				<span class="sep" aria-hidden="true"></span>
				<Button size="sm" onclick={() => void runTest()}>{t('sdk_studio.run_flow')}</Button>
				<Button size="sm" onclick={() => void runDeploy()}>{t('sdk_studio.deploy')}</Button>
				<span class="sep" aria-hidden="true"></span>
				<Button size="sm" disabled={!history.canUndo} onclick={undo}>{t('sdk_studio.undo')}</Button>
				<Button size="sm" disabled={!history.canRedo} onclick={redo}>{t('sdk_studio.redo')}</Button>
				<MenuButton label={t('sdk_studio.more')} size="sm">
					<MenuItem icon={ICONS.rename} onselect={() => openSave('', null)}
						>{t('sdk_studio.rename_flow')}</MenuItem
					>
					<MenuItem icon={ICONS.open} onselect={() => void showTemplates()}
						>{t('sdk_studio.browse_templates')}</MenuItem
					>
					<MenuDivider />
					<MenuItem icon={ICONS.import} onselect={chooseFile}>{t('sdk_studio.import_flow')}</MenuItem>
					<MenuItem icon={ICONS.download} onselect={download}>{t('sdk_studio.download_file')}</MenuItem>
					<MenuDivider />
					<MenuItem icon={ICONS.view} onselect={showJson}>{t('sdk_studio.show_json')}</MenuItem>
				</MenuButton>
				<input
					bind:this={fileInput}
					type="file"
					accept=".bdflow,.json"
					hidden
					tabindex="-1"
					aria-hidden="true"
					onchange={(e) => void importFile(e)}
				/>
			</div>
			<div class="toolbar-part">
				<Checkbox inline label={t('sdk_studio.snap_grid')} bind:checked={showGrid} />
				<div class="zoom" role="group" aria-label={t('sdk_studio.zoom')}>
					<IconButton icon="remove" label={t('sdk_studio.zoom_out')} onclick={() => zoomBy(0.8)} />
					<span class="zoom-level" aria-live="polite">{formatPercent(view.zoom, { fraction: true })}</span>
					<IconButton icon="add" label={t('sdk_studio.zoom_in')} onclick={() => zoomBy(1.2)} />
					<IconButton icon="fit_screen" label={t('sdk_studio.zoom_fit')} onclick={fit} />
				</div>
			</div>
		</div>

		{#if storeFailed}
			<Notice tone="warning" class="store-notice" message={t('sdk_studio.store_unavailable')} />
		{/if}
		<Notice class="small-screen" message={t('sdk_studio.small_screen')} />

		<div class="workspace">
			<section
				class={['panel', 'palette', !paletteOpen && 'is-collapsed']}
				aria-labelledby="studio-palette-title"
			>
				<div class="panel-head">
					<h2 id="studio-palette-title">{t('sdk_studio.palette')}</h2>
					<IconButton
						icon="chevron_left"
						class="panel-toggle"
						label={paletteOpen ? t('sdk_studio.hide_palette') : t('sdk_studio.show_palette')}
						aria-expanded={paletteOpen}
						aria-controls="studio-palette-body"
						onclick={togglePalette}
					/>
				</div>
				<div class="panel-body palette-body" id="studio-palette-body" hidden={!paletteOpen}>
					<div class="palette-search">
						<SearchField small label={t('sdk_studio.search_nodes')} bind:value={search} autocomplete="off" />
					</div>
					<p class="palette-hint">{t('sdk_studio.add_hint')}</p>
					{#each CATEGORIES as cat (cat)}
						<div class="palette-cat">
							<button
								type="button"
								class="cat-toggle"
								aria-expanded={!closedCats[cat]}
								aria-controls={`studio-palette-${cat}`}
								onclick={() => (closedCats = { ...closedCats, [cat]: !closedCats[cat] })}
							>
								<Icon name="expand_more" class="cat-chevron" />
								<span>{catLabel(cat)}</span>
							</button>
							<div class="palette-items" id={`studio-palette-${cat}`} hidden={closedCats[cat]}>
								{#each visibleTypes(cat) as type (type)}
									<button
										type="button"
										class="palette-node"
										draggable="true"
										title={NODE_DEFS[type]?.desc}
										ondragstart={(e) => {
											e.dataTransfer?.setData('text/plain', type);
											if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
										}}
										onclick={() => addAtCentre(type)}>{nodeLabel(type, tr)}</button
									>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>

			<NodeCanvas
				bind:this={canvas}
				class="studio-canvas"
				nodes={flow.nodes}
				{wires}
				nodeW={NODE_W}
				nodeH={NODE_H}
				ports={(n) => nodePorts(n.type)}
				wireEnd={(n, port) => wireEnd(n, port)}
				bind:view
				minZoom={MIN_ZOOM}
				maxZoom={MAX_ZOOM}
				wheelZoom={(z, dy) => z * (dy > 0 ? 0.9 : 1.1)}
				wheelAtPointer
				grid={GRID}
				{showGrid}
				snapTo={showGrid ? GRID : null}
				keyStep={GRID}
				bend={0.5}
				bind:selectedNode
				bind:selectedWire
				label={t('sdk_studio.canvas_label')}
				nodeName={(n) => `${n.label || nodeLabel(n.type, tr)}, ${nodeSubtitle(n, tr)}`}
				node={nodeBody}
				accepts={(type) => !!NODE_DEFS[type]}
				ondrop={(type, at) => place(type, at.x, at.y, false)}
				{onconnect}
				{onmovestart}
				{onmove}
				{onmoveend}
			>
				{#if !flow.nodes.length}
					<div class="empty">
						<h2>{t('sdk_studio.empty_title')}</h2>
						<p>{t('sdk_studio.empty_desc')}</p>
						<div class="empty-actions">
							<Button onclick={() => void showTemplates()}>{t('sdk_studio.browse_templates')}</Button>
						</div>
					</div>
				{:else if map}
					<svg class="minimap" viewBox={map.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
						{#each flow.wires as w, i (i)}
							{@const a = byId.get(w.from)}
							{@const b = byId.get(w.to)}
							{#if a && b}
								<line
									class="map-wire"
									x1={a.x + NODE_W}
									y1={a.y + NODE_H / 2}
									x2={b.x}
									y2={b.y + NODE_H / 2}
									vector-effect="non-scaling-stroke"
								/>
							{/if}
						{/each}
						{#each flow.nodes as n (n.id)}
							<rect
								class={['map-node', `is-${categoryOf(n.type)}`]}
								x={n.x}
								y={n.y}
								width={NODE_W}
								height={NODE_H}
							/>
						{/each}
					</svg>
				{/if}
			</NodeCanvas>

			<div class={['panel', 'settings', !settingsOpen && 'is-collapsed']}>
				<div class="panel-head">
					<IconButton
						icon="chevron_right"
						class="panel-toggle"
						label={settingsOpen ? t('sdk_studio.hide_inspector') : t('sdk_studio.show_inspector')}
						aria-expanded={settingsOpen}
						aria-controls="studio-settings-body"
						onclick={toggleSettings}
					/>
					<h2 id="studio-settings-title">{t('sdk_studio.inspector')}</h2>
				</div>
				<div class="panel-body settings-body" id="studio-settings-body" hidden={!settingsOpen}>
					<section class="inspector" aria-labelledby="studio-settings-title">
						{#if node}
							<NodeSettings
								{node}
								{flow}
								onlabel={setLabel}
								onconfig={setConfig}
								oninvalid={(key) =>
									log(t('sdk_studio.log_json_invalid', { field: configLabel(key) }), 'error')}
								onconnect={(port, to) =>
									onconnect({ node: node.id, port, dir: 'out' }, { node: to, port: 'in', dir: 'in' })}
								onremovewire={deleteWire}
								ondelete={() => deleteNode(node.id)}
							/>
						{:else}
							<div class="howto">
								<p>{t('sdk_studio.select_node')}</p>
								<h3>{t('sdk_studio.howto_title')}</h3>
								<ol>
									<li>{t('sdk_studio.howto_add')}</li>
									<li>{t('sdk_studio.howto_connect')}</li>
									<li>{t('sdk_studio.howto_save')}</li>
								</ol>
								<p class="hint">{t('sdk_studio.howto_keys')}</p>
							</div>
						{/if}
					</section>

					<section class={['log', logOpen && 'is-open']} aria-labelledby="studio-log-title">
						<div class="log-head">
							<h2 class="log-heading">
								<button
									type="button"
									class="log-toggle"
									aria-expanded={logOpen}
									aria-controls="studio-log-body"
									onclick={() => setLogOpen(!logOpen, true)}
								>
									<Icon name="expand_more" class="log-chevron" />
									<span id="studio-log-title">{t('sdk_studio.console')}</span>
									{#if !logOpen && last}
										<span class={['log-last', last.level === 'error' && 'is-error']}>{last.text}</span>
									{/if}
								</button>
							</h2>
							<Button size="sm" variant="ghost" onclick={() => (lines = [])}
								>{t('sdk_studio.clear_console')}</Button
							>
						</div>
						<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrolling log must be reachable with the keyboard) -->
						<div
							bind:this={logBody}
							class="log-body"
							id="studio-log-body"
							role="log"
							aria-live="polite"
							aria-labelledby="studio-log-title"
							tabindex="0"
							hidden={!logOpen}
						>
							{#each lines as line (line.id)}
								<div class={['log-line', `is-${line.level}`]}>
									<span class="log-time">{line.time}</span><span class="log-text">{line.text}</span>
								</div>
							{/each}
						</div>
					</section>
				</div>
			</div>
		</div>

		<div class="statusbar">
			<span class="status-item">{t('sdk_studio.nodes')}: <b>{formatNumber(flow.nodes.length)}</b></span>
			<span class="status-item">{t('sdk_studio.wires')}: <b>{formatNumber(flow.wires.length)}</b></span>
			<span class="status-item status-end"><Status tone={deploy} label={deployLabel} /></span>
		</div>
	</main>

	{#if saveDialog}
		<Dialog title={t('sdk_studio.save_flow')} onclose={closeSave}>
			<form
				class="save-form"
				novalidate
				onsubmit={(e) => {
					e.preventDefault();
					void doSave();
				}}
			>
				{#if saveDialog.note}
					<Notice message={saveDialog.note} />
				{/if}
				<Field label={t('sdk_studio.flow_name')}>
					{#snippet children(f)}<Input
							{...f}
							maxlength={100}
							autocomplete="off"
							required
							data-autofocus
							bind:value={saveName}
						/>{/snippet}
				</Field>
				<Field label={t('sdk_studio.flow_desc')} hint={t('sdk_studio.flow_desc_hint')}>
					{#snippet children(f)}<Textarea
							{...f}
							rows={3}
							maxlength={500}
							bind:value={saveDescription}
						/>{/snippet}
				</Field>
				<FormStatus message={saveDialog.status} tone="error" />
				<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
			</form>
			{#snippet footer()}
				<Button onclick={closeSave}>{t('common.cancel')}</Button>
				<Button variant="primary" busy={saving} onclick={() => void doSave()}
					>{t('sdk_studio.save_flow')}</Button
				>
			{/snippet}
		</Dialog>
	{/if}

	{#if templatesOpen}
		<Dialog title={t('sdk_studio.browse_templates')} size="large" onclose={() => (templatesOpen = false)}>
			<p class="dialog-note">{t('sdk_studio.templates_note')}</p>
			{#if templatesError}
				<States
					kind="error"
					message={t('sdk_studio.templates_failed')}
					retryLabel={t('sdk_studio.try_again')}
					onretry={() => void showTemplates()}
				/>
			{:else if templates === null}
				<States kind="loading" message={t('sdk_studio.loading')} />
			{:else if !templates.length}
				<States message={t('sdk_studio.no_templates')} />
			{:else}
				<RowList label={t('sdk_studio.templates')}>
					{#each templates as tpl (tpl.id)}
						<ListRow title={tpl.name} sub={tpl.description} chevron onclick={() => useTemplate(tpl)} />
					{/each}
				</RowList>
			{/if}
		</Dialog>
	{/if}

	{#if openSheet}
		<Sheet title={t('sdk_studio.open_flow')} onclose={() => (openSheet = false)}>
			{#if flowsError}
				<States
					kind="error"
					message={t('sdk_studio.list_failed')}
					retryLabel={t('sdk_studio.try_again')}
					onretry={() => void loadFlows()}
				/>
			{:else if flows === null}
				<States kind="loading" message={t('sdk_studio.loading')} />
			{:else if !flows.length}
				<States message={t('sdk_studio.no_flows')} />
			{:else}
				<ul class="flow-list">
					{#each flows as f (f.id)}
						{@const when = f.updated_at || f.created_at}
						<li class="flow-row">
							<div class="flow-main">
								<Button variant="link" class="flow-open" onclick={() => void openFlow(f.id)}>{f.name}</Button>
								{#if f.description}<span class="flow-desc">{f.description}</span>{/if}
								<span class="flow-meta">
									<Status
										tone={f.status === 'deployed' ? 'good' : 'neutral'}
										label={f.status === 'deployed'
											? t('sdk_studio.status_deployed')
											: t('sdk_studio.status_ready')}
									/>
									<span>{t('sdk_studio.flow_version', { version: formatNumber(f.version ?? 1) })}</span>
									{#if when || f.created_by}
										<span class="changed">
											{#each changedParts(when, f.created_by) as part, i (i)}{#if part === TIME}<Time
														value={when}
													/>{:else if part === USER}<User user={f.created_by} />{:else}{part}{/if}{/each}
										</span>
									{/if}
									<ValueCopy value={f.id} />
								</span>
							</div>
							<div class="flow-actions">
								<Button
									size="sm"
									icon={ICONS.export}
									href={flowExportUrl(f.id)}
									download={bdflowFileName(f.name)}>{t('sdk_studio.export_flow')}</Button
								>
								<Button size="sm" variant="danger-quiet" onclick={() => void removeFlow(f)}
									>{t('sdk_studio.delete_flow')}</Button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
			{#snippet footer()}
				<Button onclick={() => (openSheet = false)}>{t('common.close')}</Button>
			{/snippet}
		</Sheet>
	{/if}
{/if}

<style>
	.denied {
		padding: var(--page-pad);
	}

	/* The page fills the window; the canvas takes what the bars leave */
	.studio {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: var(--bg);
		color: var(--text);
	}

	/* ── Title and toolbar ── */

	.studio-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-4);
		padding: var(--space-2) var(--space-4);
	}
	.studio-back {
		font-size: var(--text-sm);
	}
	.studio-head h1 {
		margin: 0;
		font-size: var(--text-lg);
	}
	.studio-description {
		flex: 1 1 40ch;
		min-width: 0;
		max-width: 120ch;
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.studio-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
		padding: var(--space-2) var(--space-4);
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
	}
	.toolbar-part {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.flow-name {
		max-width: 24ch;
		margin-inline-end: var(--space-2);
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sep {
		width: 1px;
		height: 20px;
		margin: 0 var(--space-1);
		background: var(--rule);
	}
	.zoom {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.zoom-level {
		min-width: 5ch;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.studio :global(.store-notice) {
		margin: 0;
		font-size: var(--text-sm);
	}
	.studio :global(.small-screen) {
		display: none;
	}

	/* ── Workspace ── */

	.workspace {
		display: flex;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.panel {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		min-height: 0;
	}
	.panel-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-1);
		min-height: 40px;
		padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.panel-head h2 {
		margin: 0;
		margin-inline-end: auto;
		font-size: var(--text-base);
	}
	.settings > .panel-head {
		padding-inline: var(--space-1) var(--space-3);
	}
	.panel-body[hidden] {
		display: none;
	}
	/* A side panel's fold button: quiet while the panel is open; the chevron points where the panel goes */
	.panel :global(.panel-toggle[aria-expanded='true']:not(:hover)) {
		background: transparent;
		color: var(--text-muted);
	}
	.panel :global(.panel-toggle .material-icons) {
		transition: transform var(--motion);
	}
	.panel.is-collapsed :global(.panel-toggle .material-icons),
	:global([dir='rtl']) .panel :global(.panel-toggle .material-icons) {
		transform: scaleX(-1);
	}
	:global([dir='rtl']) .panel.is-collapsed :global(.panel-toggle .material-icons) {
		transform: none;
	}
	/* Folded: a strip with the button; the heading stays for screen readers */
	.panel.is-collapsed {
		width: 44px;
		overflow: hidden;
	}
	.panel.is-collapsed > .panel-head {
		justify-content: center;
		padding-inline: 0;
		border-bottom: 0;
	}
	.panel.is-collapsed > .panel-head h2 {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	/* ── Node list ── */

	.palette {
		width: clamp(184px, 12vw, 224px);
		border-inline-end: 1px solid var(--rule);
	}
	.palette-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.palette-search {
		margin: var(--space-2) var(--space-3) 0;
	}
	.palette-hint {
		margin: 0;
		padding: var(--space-1) var(--space-3) var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
	.palette-cat {
		border-top: 1px solid var(--rule);
	}
	.cat-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		min-height: var(--control-h);
		padding: 0 var(--space-2);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: 600;
		text-align: start;
		cursor: pointer;
	}
	.cat-toggle:hover {
		background: var(--hover);
	}
	.cat-toggle :global(.cat-chevron) {
		color: var(--text-muted);
		font-size: 20px;
		transition: transform var(--motion);
	}
	.cat-toggle[aria-expanded='false'] :global(.cat-chevron) {
		transform: rotate(-90deg);
	}
	:global([dir='rtl']) .cat-toggle[aria-expanded='false'] :global(.cat-chevron) {
		transform: rotate(90deg);
	}
	.palette-items {
		padding-bottom: var(--space-2);
	}
	.palette-items[hidden] {
		display: none;
	}
	.palette-node {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 30px;
		padding: 2px var(--space-3);
		padding-inline-start: calc(var(--space-2) + 20px + var(--space-1));
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: start;
		cursor: grab;
	}
	.palette-node:hover {
		background: var(--hover);
	}
	.palette-node:active {
		cursor: grabbing;
	}
	.cat-toggle:focus-visible,
	.palette-node:focus-visible,
	.log-toggle:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}

	/* ── Canvas ── */

	.workspace :global(.studio-canvas) {
		flex: 1;
	}
	.node-body {
		fill: var(--bg-float);
		stroke: var(--border);
		stroke-width: 1;
	}
	.node-body.is-selected {
		stroke: var(--accent);
		stroke-width: 2;
	}
	/* The bar on the start edge says which kind of node it is */
	.node-accent {
		fill: var(--text-muted);
	}
	.node-accent.is-sources {
		fill: var(--accent);
	}
	.node-accent.is-processing {
		fill: var(--warning);
	}
	.node-accent.is-outputs {
		fill: var(--success);
	}
	.node-label {
		fill: var(--text);
		font-family: var(--font);
		font-size: 13px;
		font-weight: 600;
		pointer-events: none;
	}
	.node-type {
		fill: var(--text-muted);
		font-size: 11px;
		pointer-events: none;
	}
	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-4);
		text-align: center;
		pointer-events: none;
	}
	.empty h2 {
		margin: 0;
		font-size: var(--text-md);
	}
	.empty p {
		max-width: 44ch;
		margin: 0;
		color: var(--text-muted);
	}
	.empty-actions {
		margin-top: var(--space-2);
		pointer-events: auto;
	}
	.minimap {
		position: absolute;
		bottom: var(--space-3);
		inset-inline-end: var(--space-3);
		width: 160px;
		height: 100px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg);
		pointer-events: none;
	}
	.map-wire {
		stroke: var(--text-muted);
		stroke-width: 1;
	}
	.map-node {
		fill: var(--text-muted);
	}
	.map-node.is-sources {
		fill: var(--accent);
	}
	.map-node.is-processing {
		fill: var(--warning);
	}
	.map-node.is-outputs {
		fill: var(--success);
	}

	/* ── Node settings and log ── */

	.settings {
		width: clamp(256px, 17vw, 320px);
		border-inline-start: 1px solid var(--rule);
	}
	.settings-body {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.inspector {
		flex: 1;
		min-height: 0;
		padding: var(--space-3);
		overflow-y: auto;
	}
	.howto {
		color: var(--text-muted);
	}
	.howto p {
		margin: 0;
	}
	.howto h3 {
		margin: var(--space-4) 0 var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
		color: var(--text);
		font-size: var(--text-base);
	}
	.howto ol {
		margin: 0;
		padding-inline-start: var(--space-5);
		font-size: var(--text-sm);
	}
	.howto li + li {
		margin-top: var(--space-1);
	}
	.howto .hint {
		margin-top: var(--space-3);
		font-size: var(--text-sm);
	}

	/* Folded, the log is one line with its latest message; open, it takes a third of the panel */
	.log {
		display: flex;
		flex: none;
		flex-direction: column;
		border-top: 1px solid var(--rule);
	}
	.log.is-open {
		height: clamp(160px, 33%, 320px);
	}
	.log-head {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-1);
		padding-inline-end: var(--space-2);
	}
	.log-heading {
		flex: 1;
		min-width: 0;
		margin: 0;
		font-size: var(--text-base);
	}
	.log-toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		width: 100%;
		min-height: 40px;
		padding: 0 var(--space-2);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: 600;
		text-align: start;
		cursor: pointer;
	}
	.log-toggle:hover {
		background: var(--hover);
	}
	.log-toggle :global(.log-chevron) {
		flex: none;
		color: var(--text-muted);
		font-size: 20px;
		transform: rotate(-90deg);
		transition: transform var(--motion);
	}
	:global([dir='rtl']) .log-toggle :global(.log-chevron) {
		transform: rotate(90deg);
	}
	.log.is-open .log-toggle :global(.log-chevron) {
		transform: none;
	}
	.log-last {
		flex: 1;
		min-width: 0;
		margin-inline-start: var(--space-2);
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.log-last.is-error {
		color: var(--danger);
	}
	/* Dark in both themes, like a terminal; every colour passes AA on #111414 */
	.log-body {
		flex: 1;
		padding: var(--space-2);
		overflow-y: auto;
		background: #111414;
		color: #e3e6e6;
		font-family: var(--mono);
		font-size: var(--text-xs);
		line-height: 1.5;
	}
	.log-body[hidden] {
		display: none;
	}
	.log-body:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.log-line {
		display: flex;
		gap: var(--space-2);
	}
	.log-time {
		flex-shrink: 0;
		color: #a3abad;
	}
	.log-text {
		min-width: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.log-line.is-success .log-text {
		color: #72c98c;
	}
	.log-line.is-warn .log-text {
		color: #e3b85a;
	}
	.log-line.is-error .log-text {
		color: #ff8f80;
	}
	.log-line.is-data .log-text {
		color: #a9c7d3;
	}

	/* ── Status line ── */

	.statusbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-4);
		min-height: 32px;
		padding: var(--space-1) var(--space-4);
		border-top: 1px solid var(--rule);
		background: var(--bg-subtle);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.status-item b {
		color: var(--text);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.status-end {
		margin-inline-start: auto;
	}

	/* ── Dialogs ── */

	.save-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.dialog-note {
		margin: 0 0 var(--space-3);
		color: var(--text-muted);
	}
	.flow-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.flow-row {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-2) var(--space-3);
		padding: var(--row-pad-y) 0;
		border-bottom: 1px solid var(--rule);
	}
	.flow-main {
		display: flex;
		flex: 1 1 260px;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-1);
		min-width: 0;
	}
	.flow-main :global(.flow-open) {
		font-weight: 600;
		text-align: start;
		overflow-wrap: anywhere;
	}
	.flow-desc {
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
	.flow-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.flow-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	/* ── Touch ── */

	@media (pointer: coarse) {
		.palette-node,
		.cat-toggle,
		.log-toggle {
			min-height: 44px;
		}
		.studio-back {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}

	/* ── Narrow screens: the panels stack and the page scrolls ── */

	@media (max-width: 899px) {
		.studio {
			height: auto;
			overflow: visible;
		}
		.sep {
			display: none;
		}
		.studio :global(.small-screen) {
			display: block;
			margin: var(--space-3) var(--space-4) 0;
		}
		.studio :global(.store-notice) {
			margin: var(--space-3) var(--space-4) 0;
		}
		.workspace {
			flex-direction: column;
			overflow: visible;
		}
		.palette {
			width: auto;
			max-height: 50vh;
			border-inline-end: 0;
			border-bottom: 1px solid var(--rule);
		}
		.panel.is-collapsed {
			width: auto;
		}
		.panel.is-collapsed > .panel-head {
			justify-content: flex-start;
			padding-inline: var(--space-3) var(--space-2);
			border-bottom: 1px solid var(--rule);
		}
		.panel.is-collapsed > .panel-head h2 {
			position: static;
			width: auto;
			height: auto;
			clip-path: none;
		}
		/* Open panels show a chevron pointing up (fold), folded ones down */
		.panel :global(.panel-toggle .material-icons),
		:global([dir='rtl']) .panel :global(.panel-toggle .material-icons) {
			transform: rotate(90deg);
		}
		.settings :global(.panel-toggle .material-icons),
		:global([dir='rtl']) .settings :global(.panel-toggle .material-icons) {
			transform: rotate(-90deg);
		}
		.panel.is-collapsed :global(.panel-toggle .material-icons),
		:global([dir='rtl']) .panel.is-collapsed :global(.panel-toggle .material-icons) {
			transform: rotate(-90deg);
		}
		.settings.is-collapsed :global(.panel-toggle .material-icons),
		:global([dir='rtl']) .settings.is-collapsed :global(.panel-toggle .material-icons) {
			transform: rotate(90deg);
		}
		/* Stacked, both fold buttons sit at the end of their heading row */
		.settings > .panel-head {
			padding-inline: var(--space-3) var(--space-2);
		}
		.settings > .panel-head :global(.panel-toggle) {
			order: 1;
		}
		.workspace :global(.studio-canvas) {
			flex: none;
			height: 60vh;
		}
		.settings {
			width: auto;
			border-inline-start: 0;
			border-top: 1px solid var(--rule);
		}
		.inspector {
			overflow: visible;
		}
		.minimap {
			display: none;
		}
	}
</style>
