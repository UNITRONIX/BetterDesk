<!--
  Settings › Appearance: how the console, the sign-in page, the download
  page and the web remote client look for everyone. One form, one save
  (POST /api/settings/branding); the preview beside it shows the choices
  before they are saved. Saved appearances, import and export, and reset
  act right away. Everyone may look; branding.edit may change (the form
  is read-only otherwise, and the parts that only change things are left
  out).

  A few things save at once, as before: a built-in theme, an uploaded
  background picture (the server stores it as that background), fonts
  downloaded or uploaded to the server. An uploaded logo waits for Save.

  Element ids are the old page's, for links and the settings search.
-->
<script lang="ts">
	import {
		applyProfile,
		applyTheme as applyBuiltinTheme,
		createProfile,
		deleteFont,
		deleteProfile,
		duplicateProfile,
		exportBranding,
		getBranding,
		importBranding,
		listBackgrounds,
		listLocalFonts,
		listProfiles,
		listThemes,
		resetBranding,
		saveBranding,
		updateProfile,
		uploadBackground,
		uploadFont,
		uploadLogo,
		type BackgroundImage,
		type BrandingProfile,
		type BuiltinTheme,
		type Readability
	} from '#lib/api/settings.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import { applyTheme, theme } from '#lib/state/theme.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import ColorField from '#lib/ui/ColorField.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import DangerZone from '#lib/ui/DangerZone.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FilePicker from '#lib/ui/FilePicker.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Radio from '#lib/ui/Radio.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Select from '#lib/ui/Select.svelte';
	import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import {
		COLOR_GROUPS,
		DEFAULT_SLIDES,
		LOGO_MAX,
		LOGO_TYPES,
		MAX_SLIDES,
		brandingFromServer,
		brandingPayload,
		fileProblem,
		isHex,
		moveSlide,
		paletteColors,
		type BrandingValues,
		type LogoType,
		type PromoMode,
		type ThemeMode
	} from '../appearance.ts';
	import BackgroundFields from '../BackgroundFields.svelte';
	import { trackDirty } from '../dirty.ts';
	import FontPicker from '../FontPicker.svelte';
	import RangeField from '../RangeField.svelte';
	import SettingsGrid from '../SettingsGrid.svelte';
	import SettingsLayout from '../SettingsLayout.svelte';
	import ThemePreview from '../ThemePreview.svelte';

	const canEdit = can('branding.edit');

	/** Examples in empty fields: names, addresses and code, the same in every language */
	const EX = {
		appName: 'BetterDesk',
		appDescription: 'BetterDesk Server Management',
		logoText: 'insolve',
		logoAccent: 'Core Server',
		logoIcon: 'dns',
		svg: '<svg>…</svg>',
		logoUrl: 'https://example.com/logo.png',
		footer: '© 2026 Example Ltd.',
		slideImage: '/img/login-slides/free.jpg',
		css: '.sidebar { … }'
	} as const;
	const errText = (err: unknown, fallback = t('errors.server_error')) =>
		err instanceof Error && err.message ? err.message : fallback;
	type Line = { message: string; tone: 'neutral' | 'ok' | 'error' };
	const NO_LINE: Line = { message: '', tone: 'neutral' };

	/* ── The form ── */

	let loaded = $state(false);
	let loadError = $state('');
	let readability = $state.raw<Readability>(null);
	/** What the server has now (the form's baseline) */
	let saved: BrandingValues = brandingFromServer({});
	let savedMode = $state<ThemeMode>('system');
	let prevMode: ThemeMode = 'system';

	// Background uploads still running; Save waits for them
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, not shown
	const uploads = new Set<Promise<unknown>>();

	let pendingLogo = $state<File | null>(null);
	let logoFiles = $state<FileList | null>(null);
	let logoPicker = $state<HTMLInputElement | null>(null);
	let logoProblem = $state('');

	const form = createForm<BrandingValues>({
		initial: saved,
		submit: async (v) => {
			await Promise.allSettled([...uploads]);
			let next = v;
			if (pendingLogo) {
				const url = await uploadLogo(pendingLogo);
				next = { ...v, logoUrl: url };
				clearPendingLogo();
			}
			const payload = brandingPayload(next);
			const resp = await saveBranding(payload);
			readability = resp.readability;
			savedMode = next.themeMode;
			saved = next;
			applyToConsole(payload, resp.revision);
			return next;
		},
		savedMessage: t('branding.saved')
	});
	const v = $derived(form.values);
	const dirty = $derived(form.dirty || !!pendingLogo);
	$effect(() => trackDirty(() => dirty));

	function fill(next: BrandingValues) {
		saved = next;
		savedMode = next.themeMode;
		prevMode = next.themeMode;
		form.reset(next);
		cssOpen = !!next.customCss.trim();
	}

	async function load() {
		try {
			const resp = await getBranding();
			fill(brandingFromServer(resp.data));
			readability = resp.readability;
			loaded = true;
			loadError = '';
		} catch (err) {
			loadError = errText(err);
		}
	}

	/** After something saved the appearance on the server (theme, saved appearance, import, reset) */
	async function reloadFromServer(revision?: string | number | null) {
		const resp = await getBranding();
		const next = brandingFromServer(resp.data);
		fill(next);
		readability = resp.readability;
		clearPendingLogo();
		applyToConsole(brandingPayload(next), revision ?? resp.revision);
	}

	/** The sidebar, the tab title, the theme and branding.css follow what was saved */
	function applyToConsole(p: Record<string, unknown>, revision: string | number | null | undefined) {
		const rev = encodeURIComponent(String(revision ?? Date.now()));
		for (const el of document.querySelectorAll<HTMLLinkElement>('link[href*="/css/branding.css"]')) {
			const href = el.getAttribute('href') ?? '';
			el.setAttribute('href', `${href.split('?')[0]}?v=${rev}`);
		}
		const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
		if (icon) icon.setAttribute('href', `${(icon.getAttribute('href') ?? '').split('?')[0]}?v=${rev}`);
		const raw = session.raw;
		const name = String(p.appName || 'BetterDesk');
		session.appName = name;
		if (raw) {
			session.raw = {
				...raw,
				branding: {
					...raw.branding,
					appName: name,
					appDescription: String(p.appDescription ?? ''),
					themeMode: String(p.themeMode ?? 'system'),
					logoType: String(p.logoType ?? 'default'),
					logoIcon: String(p.logoIcon ?? ''),
					logoSvg: String(p.logoSvg ?? ''),
					logoUrl: String(p.logoUrl ?? ''),
					logoText: String(p.logoText ?? ''),
					logoTextAccent: String(p.logoTextAccent ?? ''),
					footerText: String(p.footerText ?? ''),
					showPoweredBy: p.showPoweredBy !== 'false',
					revision: revision ?? raw.branding.revision
				}
			};
		}
		theme.consoleMode = String(p.themeMode ?? 'system');
		applyTheme();
	}

	function revert() {
		clearPendingLogo();
		form.reset(saved);
		prevMode = saved.themeMode;
	}

	/* ── Theme and colours ── */

	/** The palette the console shows for a mode (system follows this device) */
	function lookPalette(mode: ThemeMode | 'light' | 'dark'): Record<string, string> {
		const dark =
			mode === 'dark' ||
			(mode !== 'light' &&
				typeof window.matchMedia === 'function' &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
		return (dark ? theme.palettes.dark : theme.palettes.light) ?? {};
	}

	function usePalette(palette: Record<string, string>) {
		form.values.colors = { ...form.values.colors, ...paletteColors(palette) };
	}

	function onMode(mode: ThemeMode) {
		if (mode === 'light' || mode === 'dark') {
			form.values.glassColor = mode === 'light' ? '#ffffff' : '#161b22';
		} else if (mode === 'custom' && prevMode !== 'custom' && savedMode !== 'custom') {
			// Start the custom colours from what the console looks like now
			usePalette(lookPalette(prevMode));
		}
		prevMode = mode;
	}

	const previewPalette = $derived.by(() => {
		if (v.themeMode !== 'custom') return lookPalette(v.themeMode);
		const out: Record<string, string> = { ...lookPalette('light') };
		for (const [k, c] of Object.entries(v.colors)) if (isHex(c)) out[k] = c.trim();
		return out;
	});

	// Built-in themes: picking one is not a change to the form; Apply saves it at once
	let themes = $state.raw<BuiltinTheme[]>([]);
	let themesFailed = $state(false);
	let themePick = $state('');
	let themeBusy = $state(false);
	let themeSelect = $state<HTMLSelectElement | null>(null);

	async function loadThemes() {
		try {
			themes = await listThemes();
		} catch {
			themesFailed = true;
		}
	}

	async function applyPickedTheme() {
		if (!canEdit) return;
		const picked = themes.find((x) => x.id === themePick);
		if (!picked) {
			form.status = { state: 'error', message: t('settings.appearance.pick_theme_first') };
			themeSelect?.focus();
			return;
		}
		const ok = await confirm({
			title: t('settings.tab_branding'),
			message: t('branding.theme_apply_confirm'),
			confirmLabel: t('settings.appearance.apply_theme')
		});
		if (!ok) return;
		themeBusy = true;
		try {
			await applyBuiltinTheme(picked.id);
			await reloadFromServer();
			form.status = { state: 'saved', message: t('branding.theme_applied') };
		} catch (err) {
			form.status = { state: 'error', message: errText(err) };
		} finally {
			themeBusy = false;
		}
	}

	/* ── Logo ── */

	function clearPendingLogo() {
		pendingLogo = null;
		logoProblem = '';
		if (logoPicker) logoPicker.value = '';
	}

	// Picking a file only remembers it; Save uploads it, so the current logo stays until then
	function onLogoFile() {
		const file = logoFiles?.[0];
		logoProblem = '';
		if (!file) {
			pendingLogo = null;
			return;
		}
		const problem = fileProblem(file, LOGO_TYPES, LOGO_MAX);
		if (problem) {
			logoProblem = t(
				problem === 'size' ? 'branding.logo_image_too_large' : 'branding.logo_image_invalid_type'
			);
			pendingLogo = null;
			if (logoPicker) logoPicker.value = '';
			return;
		}
		pendingLogo = file;
	}

	let pendingLogoUrl = $state('');
	$effect(() => {
		const file = pendingLogo;
		if (!file || !file.type.startsWith('image/')) {
			pendingLogoUrl = '';
			return;
		}
		const url = URL.createObjectURL(file);
		pendingLogoUrl = url;
		return () => URL.revokeObjectURL(url);
	});

	const LOGO_TYPES_LIST: readonly LogoType[] = ['default', 'text', 'icon', 'svg', 'image'];
	const LOGO_LABEL: Record<LogoType, string> = {
		default: 'branding.logo_type_default',
		text: 'branding.logo_type_text',
		icon: 'branding.logo_type_icon',
		svg: 'branding.logo_type_svg',
		image: 'branding.logo_type_image'
	};

	/* ── Fonts ── */

	let fontSource = $state<'google' | 'local' | 'upload'>('google');
	let fontCategory = $state('all');
	let localFonts = $state.raw<{ family: string }[] | null>(null);
	let localError = $state('');
	let fontUploadName = $state('');
	let fontFiles = $state<FileList | null>(null);
	let fontPicker = $state<HTMLInputElement | null>(null);

	async function loadLocalFonts() {
		try {
			localFonts = await listLocalFonts();
			localError = '';
		} catch (err) {
			localError = errText(err);
		}
	}

	async function removeFont(family: string) {
		try {
			await deleteFont(family);
		} catch (err) {
			form.status = { state: 'error', message: errText(err) };
		}
		void loadLocalFonts();
	}

	async function onFontFile() {
		const file = fontFiles?.[0];
		if (!file || !canEdit) return;
		const family = fontUploadName.trim() || file.name.replace(/\.[^.]+$/, '');
		try {
			await uploadFont(file, family);
			form.status = { state: 'saved', message: t('branding.font_upload_success') };
			void loadLocalFonts();
		} catch (err) {
			form.status = { state: 'error', message: errText(err) };
		} finally {
			if (fontPicker) fontPicker.value = '';
		}
	}

	/* ── Backgrounds ── */

	let library = $state.raw<BackgroundImage[] | null>(null);
	let libraryError = $state('');

	async function loadLibrary() {
		try {
			library = await listBackgrounds();
			libraryError = '';
		} catch (err) {
			libraryError = errText(err);
		}
	}

	const TYPE_OF: Record<string, keyof BrandingValues> = {
		bgImageUrl: 'bgType',
		loginBgImageUrl: 'loginBgType',
		agentBgImageUrl: 'agentBgType',
		rdclientBgImageUrl: 'rdclientBgType'
	};

	const csrf = () => session.raw?.csrfToken ?? '';

	/**
	 * Upload a background picture. With a target the server saves it as that
	 * background right away: the form takes the saved appearance as its new
	 * baseline and keeps the person's other unsaved changes.
	 */
	function uploadBg(file: File, target: string, onProgress: (p: number) => void): Promise<unknown> {
		const job = (async () => {
			const r = await uploadBackground(file, target, csrf(), onProgress);
			const typeKey = TYPE_OF[target];
			if (r.data && typeKey) {
				const before = saved;
				const current = $state.snapshot(form.values) as BrandingValues;
				const next = brandingFromServer(r.data);
				fill(next);
				const values = form.values as unknown as Record<string, unknown>;
				for (const key of Object.keys(current) as (keyof BrandingValues)[]) {
					if (key === target || key === typeKey) continue;
					if (JSON.stringify(current[key]) !== JSON.stringify(before[key])) values[key] = current[key];
				}
				applyToConsole(brandingPayload(next), r.revision);
			}
			void loadLibrary();
		})();
		uploads.add(job);
		void job.finally(() => uploads.delete(job)).catch(() => undefined);
		return job;
	}

	function pickLibrary(url: string) {
		form.values.bgImageUrl = url;
		form.values.bgType = 'image';
	}

	const fileName = (url: string) => url.split('/').pop() || url;
	const currentImage = (type: string, url: string) =>
		type === 'image' && url ? t('settings.appearance.current_image', { name: fileName(url) }) : '';

	/* ── Sign-in page slides ── */

	function addSlide() {
		if (form.values.loginSlides.length >= MAX_SLIDES) return;
		form.values.loginSlides = [
			...form.values.loginSlides,
			{ id: `slide-${Date.now().toString(36)}`, slideKey: '', imageUrl: '', title: '', body: '', overlay: 45 }
		];
	}

	function restoreSlides() {
		form.values.loginSlides = DEFAULT_SLIDES.map((x) => ({ ...x }));
	}

	function move(i: number, by: -1 | 1) {
		form.values.loginSlides = moveSlide($state.snapshot(form.values.loginSlides), i, by);
		const to = i + by;
		queueMicrotask(() => {
			const btn = document.getElementById(
				`login-slide-${to}-${by < 0 ? 'up' : 'down'}`
			) as HTMLButtonElement | null;
			const other = document.getElementById(`login-slide-${to}-${by < 0 ? 'down' : 'up'}`);
			(btn && !btn.disabled ? btn : other)?.focus();
		});
	}

	function removeSlide(i: number) {
		if (form.values.loginSlides.length <= 1) return;
		form.values.loginSlides = form.values.loginSlides.filter((_x, j) => j !== i);
	}

	async function onSlideFile(i: number, input: HTMLInputElement) {
		const file = input.files?.[0];
		if (!file) return;
		try {
			const r = await uploadBackground(file, '', csrf());
			const slide = form.values.loginSlides[i];
			if (slide) slide.imageUrl = r.url;
		} catch (err) {
			form.status = { state: 'error', message: errText(err) };
		} finally {
			input.value = '';
		}
	}

	const PROMO: { value: PromoMode; label: string }[] = [
		{ value: 'classic', label: 'branding.login_promo_classic' },
		{ value: 'single', label: 'branding.login_promo_single' },
		{ value: 'slides', label: 'branding.login_promo_slides' }
	];

	/* ── Custom CSS ── */

	let cssOpen = $state(false);

	/* ── Saved appearances ── */

	let profiles = $state.raw<BrandingProfile[]>([]);
	let profileId = $state('');
	let profileStatus = $state<Line>(NO_LINE);
	let profileBusy = $state(false);

	async function loadProfiles(selected = '') {
		try {
			profiles = await listProfiles();
			const active = profiles.find((p) => p.is_active);
			profileId = selected || (active ? String(active.id) : '');
		} catch (err) {
			profileStatus = { message: errText(err), tone: 'error' };
		}
	}

	async function runProfile(fn: () => Promise<void>, ok: string) {
		profileStatus = NO_LINE;
		profileBusy = true;
		try {
			await fn();
			profileStatus = { message: ok, tone: 'ok' };
		} catch (err) {
			profileStatus = { message: errText(err), tone: 'error' };
		} finally {
			profileBusy = false;
		}
	}

	function needProfile(): boolean {
		if (profileId) return true;
		profileStatus = { message: t('branding.profile_select_first'), tone: 'error' };
		return false;
	}

	function applySelected() {
		if (!needProfile()) return;
		void runProfile(async () => {
			const r = await applyProfile(profileId);
			if (r.data) {
				const next = brandingFromServer(r.data);
				fill(next);
				clearPendingLogo();
				applyToConsole(brandingPayload(next), r.revision);
			} else {
				await reloadFromServer(r.revision);
			}
			await loadProfiles(profileId);
		}, t('branding.profile_applied'));
	}

	async function newProfile() {
		const name = await prompt({
			title: t('settings.tab_branding'),
			label: t('branding.profile_name_prompt'),
			confirmLabel: t('actions.save')
		});
		if (!name?.trim()) return;
		void runProfile(async () => {
			await createProfile(name.trim(), brandingPayload($state.snapshot(form.values) as BrandingValues));
			await loadProfiles();
		}, t('branding.profile_created'));
	}

	function saveIntoProfile() {
		if (!needProfile()) return;
		void runProfile(
			() =>
				updateProfile(profileId, brandingPayload($state.snapshot(form.values) as BrandingValues)).then(
					() => undefined
				),
			t('branding.profile_updated')
		);
	}

	function duplicateSelected() {
		if (!needProfile()) return;
		void runProfile(async () => {
			const p = profiles.find((x) => String(x.id) === profileId);
			const copyName = p ? `${p.name ?? ''} (${t('branding.profile_duplicate')})` : '';
			const id = await duplicateProfile(profileId, copyName);
			await loadProfiles(id ?? '');
		}, t('branding.profile_duplicated'));
	}

	async function deleteSelected() {
		if (!needProfile()) return;
		const ok = await confirm({
			title: t('settings.tab_branding'),
			message: t('branding.profile_delete_confirm'),
			confirmLabel: t('branding.profile_delete'),
			danger: true
		});
		if (!ok) return;
		void runProfile(async () => {
			await deleteProfile(profileId);
			await loadProfiles();
		}, t('branding.profile_deleted'));
	}

	const profileOptions = $derived([
		{ value: '', label: t('branding.profile_none') },
		...profiles.map((p) => ({
			value: String(p.id),
			label: p.is_active ? `${p.name ?? ''} (${t('branding.profile_active')})` : (p.name ?? '')
		}))
	]);

	/* ── Import and export ── */

	let ieStatus = $state<Line>(NO_LINE);
	let importFiles = $state<FileList | null>(null);
	let importPicker = $state<HTMLInputElement | null>(null);

	async function exportNow() {
		try {
			const preset = await exportBranding();
			const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'betterdesk-theme.json';
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			ieStatus = { message: t('branding.exported'), tone: 'ok' };
		} catch (err) {
			ieStatus = { message: errText(err), tone: 'error' };
		}
	}

	async function importNow() {
		const file = importFiles?.[0];
		if (!file) return;
		try {
			const preset: unknown = JSON.parse(await file.text());
			await importBranding(preset);
			await reloadFromServer();
			ieStatus = { message: t('branding.imported'), tone: 'ok' };
		} catch (err) {
			ieStatus = { message: errText(err, t('branding.import_error')), tone: 'error' };
		} finally {
			if (importPicker) importPicker.value = '';
		}
	}

	/* ── Reset ── */

	let resetting = $state(false);

	async function resetAll() {
		const ok = await confirm({
			title: t('settings.appearance.reset_title'),
			message: t('branding.reset_confirm'),
			confirmLabel: t('settings.appearance.reset_button'),
			danger: true
		});
		if (!ok) return;
		resetting = true;
		try {
			await resetBranding();
			await reloadFromServer();
			form.status = { state: 'saved', message: t('branding.reset_success') };
		} catch (err) {
			form.status = { state: 'error', message: errText(err) };
		} finally {
			resetting = false;
		}
	}

	/* ── Readability ── */

	const readIssues = $derived(readability?.issues ?? []);
	const readText = $derived(
		readIssues
			.slice(0, 3)
			.map((issue) => {
				if (issue.messageKey) {
					const tr = t(issue.messageKey, issue.messageParams ?? undefined);
					if (tr !== issue.messageKey) return tr;
				}
				return issue.message ?? '';
			})
			.filter(Boolean)
			.join(' ')
	);

	/* ── Start ── */

	$effect(() => {
		void load();
		void loadThemes();
		void loadLocalFonts();
		void loadLibrary();
		if (canEdit) void loadProfiles();
	});

	const toc = $derived([
		{ id: 'branding-theme', label: t('theme.title') },
		...(v.themeMode === 'custom'
			? [{ id: 'branding-custom-colors', label: t('settings.appearance.custom_colors') }]
			: []),
		{ id: 'branding-identity', label: t('settings.appearance.identity') },
		{ id: 'branding-fonts', label: t('branding.typography_title') },
		{ id: 'branding-background', label: t('settings.appearance.console_background') },
		{ id: 'branding-login', label: t('branding.login_title') },
		{ id: 'branding-agent', label: t('branding.agent_title') },
		{ id: 'branding-rdclient', label: t('settings.appearance.rdclient') },
		{ id: 'branding-footer', label: t('branding.footer_title') },
		{ id: 'branding-css', label: t('branding.custom_css_title') },
		...(canEdit
			? [
					{ id: 'branding-profiles', label: t('settings.appearance.profiles') },
					{ id: 'branding-import-export', label: t('branding.import_export_title') }
				]
			: [])
	]);

	const FONT_CATEGORIES = $derived([
		{ value: 'all', label: t('branding.font_cat_all') },
		{ value: 'sans-serif', label: tf('settings.appearance.font_cat_sans', 'Sans-serif') },
		{ value: 'serif', label: tf('settings.appearance.font_cat_serif', 'Serif') },
		{ value: 'monospace', label: tf('settings.appearance.font_cat_mono', 'Monospace') },
		{ value: 'display', label: tf('settings.appearance.font_cat_display', 'Display') }
	]);
</script>

{#snippet side()}
	<section class="section" aria-labelledby="branding-preview-title" data-search-skip>
		<h2 id="branding-preview-title">{t('settings.side.preview_title')}</h2>
		<p class="section-note">{t('settings.side.preview_note')}</p>
		<ThemePreview
			palette={previewPalette}
			mode={v.themeMode}
			name={v.appName}
			description={v.appDescription}
			logoType={v.logoType}
			logoSrc={pendingLogoUrl || v.logoUrl}
			fontHeading={v.fontHeading}
			fontBody={v.fontBody}
		/>
	</section>
{/snippet}

{#snippet bgLibrary()}
	<div class="form-group">
		<span class="form-label" id="bg-image-library-label">{t('desktop.wp_images')}</span>
		<div
			class="background-library"
			id="bg-image-library"
			role="group"
			aria-labelledby="bg-image-library-label"
		>
			{#if libraryError}
				<p class="state is-error">{libraryError}</p>
			{:else if !library}
				<States kind="loading" />
			{:else if !library.length}
				<p class="state">{t('desktop.wp_unavailable')}</p>
			{:else}
				{#each library as item (item.url)}
					{@const url = item.url ?? ''}
					<button
						type="button"
						class={['library-item', v.bgImageUrl === url && 'active']}
						aria-pressed={v.bgImageUrl === url}
						onclick={() => pickLibrary(url)}
					>
						<img class="library-thumb" src={url} alt="" loading="lazy" />
						<span class="library-name">{item.name || fileName(url)}</span>
					</button>
				{/each}
			{/if}
		</div>
		{#if currentImage(v.bgType, v.bgImageUrl)}<p class="form-hint" id="bg-file-name">
				{currentImage(v.bgType, v.bgImageUrl)}
			</p>{/if}
	</div>
{/snippet}

<SettingsLayout {toc} {side} sideLabelledby="branding-preview-title" sticky>
	{#if !canEdit}<Notice message={t('settings.appearance.read_only')} />{/if}
	{#if readText}
		<Notice
			tone={readIssues.some((i) => i.severity === 'error') ? 'danger' : 'warning'}
			id="branding-readability-alert"
			title={t('branding.readability_check')}
			message={readText}
		/>
	{/if}
	{#if loadError}<States kind="error" message={loadError} onretry={() => void load()} />{/if}

	<form id={form.id} class="branding-form" onsubmit={form.onsubmit} novalidate aria-busy={!loaded}>
		<fieldset class="settings-fieldset" disabled={!canEdit}>
			<legend class="sr-only">{t('settings.tab_branding')}</legend>
			<SettingsGrid>
				{#snippet start()}
					<section class="section form-column" id="branding-theme" aria-labelledby="branding-theme-title">
						<h2 id="branding-theme-title">{t('theme.title')}</h2>
						<p class="section-note">{t('settings.appearance.theme_note')}</p>
						<div id="theme-mode-selector">
							<ChoiceList
								name="theme-mode"
								labelledby="branding-theme-title"
								bind:value={form.values.themeMode}
								onchange={(mode, checked) => checked && onMode(mode)}
								choices={[
									{
										value: 'system',
										title: t('theme.auto'),
										description: t('settings.appearance.mode_system')
									},
									{
										value: 'light',
										title: t('theme.light'),
										description: t('settings.appearance.mode_light')
									},
									{ value: 'dark', title: t('theme.dark'), description: t('settings.appearance.mode_dark') },
									{
										value: 'custom',
										title: t('theme.custom'),
										description: t('settings.appearance.mode_custom'),
										controls: 'branding-custom-colors'
									}
								]}
							/>
						</div>
						<p class="field-effect">{t('settings.appearance.save_effect')}</p>
						<div class="form-group" id="branding-builtin-themes">
							<label class="form-label" for="branding-theme-select">{t('branding.builtin_themes')}</label>
							<div class="inline-controls">
								<Select
									id="branding-theme-select"
									bind:element={themeSelect}
									bind:value={themePick}
									disabled={themesFailed}
									describedby="branding-theme-select-hint branding-theme-select-effect"
									options={[
										{ value: '', label: t('settings.appearance.pick_theme') },
										...themes.map((x) => ({ value: x.id, label: x.name || x.id }))
									]}
								/>
								<Button id="branding-theme-apply" busy={themeBusy} onclick={() => void applyPickedTheme()}
									>{t('settings.appearance.apply_theme')}</Button
								>
							</div>
							<p class="form-hint" id="branding-theme-select-hint">{t('settings.appearance.builtin_hint')}</p>
							<p class="field-effect" id="branding-theme-select-effect">
								{t('settings.appearance.builtin_effect')}
							</p>
						</div>
					</section>

					<ShowWhen id="branding-custom-colors" when={v.themeMode === 'custom'}>
						<section class="section form-column" aria-labelledby="branding-colors-title">
							<h2 id="branding-colors-title">{t('settings.appearance.custom_colors')}</h2>
							<p class="section-note">{t('settings.appearance.custom_colors_note')}</p>
							<div class="inline-controls">
								<Button size="sm" onclick={() => usePalette(lookPalette('light'))}
									>{t('settings.appearance.start_light')}</Button
								>
								<Button size="sm" onclick={() => usePalette(lookPalette('dark'))}
									>{t('settings.appearance.start_dark')}</Button
								>
							</div>
							{#each COLOR_GROUPS as group (group.legend)}
								<fieldset class="color-group">
									<legend>{t(group.legend)}</legend>
									{#each group.colors as [key, labelKey] (key)}
										<Field id="color-{key}" label={t(`settings.appearance.${labelKey}`)}>
											{#snippet children(f)}
												<ColorField
													id={f.id}
													describedby={f.describedby}
													label={t(`settings.appearance.${labelKey}`)}
													bind:value={form.values.colors[key]}
												/>
											{/snippet}
										</Field>
									{/each}
								</fieldset>
							{/each}
						</section>
					</ShowWhen>

					<section
						class="section form-column"
						id="branding-identity"
						aria-labelledby="branding-identity-title"
					>
						<h2 id="branding-identity-title">{t('settings.appearance.identity')}</h2>
						<p class="section-note">{t('branding.identity_desc')}</p>
						<Field id="brand-name" label={t('branding.app_name')}>
							{#snippet children(f)}<Input
									{...f}
									maxlength={50}
									placeholder={EX.appName}
									bind:value={form.values.appName}
								/>{/snippet}
						</Field>
						<Field id="brand-description" label={t('branding.app_description')}>
							{#snippet children(f)}<Input
									{...f}
									maxlength={100}
									placeholder={EX.appDescription}
									bind:value={form.values.appDescription}
								/>{/snippet}
						</Field>
						<fieldset class="form-group radio-set">
							<legend class="form-label">{t('branding.logo_title')}</legend>
							<p class="form-hint">{t('branding.logo_desc')}</p>
							<div class="radio-row">
								{#each LOGO_TYPES_LIST as kind (kind)}
									<Radio
										name="logo-type"
										value={kind}
										bind:group={form.values.logoType}
										label={t(LOGO_LABEL[kind])}
										aria-controls={kind === 'default' ? undefined : `logo-${kind}-panel`}
									/>
								{/each}
							</div>
						</fieldset>
						<ShowWhen id="logo-text-panel" when={v.logoType === 'text'}>
							<Field id="logo-text-input" label={t('branding.logo_text')} hint={t('branding.logo_text_hint')}>
								{#snippet children(f)}<Input
										{...f}
										maxlength={30}
										placeholder={EX.logoText}
										bind:value={form.values.logoText}
									/>{/snippet}
							</Field>
							<Field
								id="logo-text-accent"
								label={t('branding.logo_text_accent')}
								hint={t('branding.logo_text_accent_hint')}
							>
								{#snippet children(f)}<Input
										{...f}
										maxlength={30}
										placeholder={EX.logoAccent}
										bind:value={form.values.logoTextAccent}
									/>{/snippet}
							</Field>
						</ShowWhen>
						<ShowWhen id="logo-icon-panel" when={v.logoType === 'icon'}>
							<Field
								id="logo-icon-name"
								label={t('branding.logo_icon_name')}
								hint={t('branding.logo_icon_hint')}
								width="medium"
							>
								{#snippet children(f)}<Input
										{...f}
										maxlength={50}
										placeholder={EX.logoIcon}
										bind:value={form.values.logoIcon}
									/>{/snippet}
							</Field>
						</ShowWhen>
						<ShowWhen id="logo-svg-panel" when={v.logoType === 'svg'}>
							<Field
								id="logo-svg-input"
								label={t('branding.logo_svg_code')}
								hint={t('branding.logo_svg_hint')}
							>
								{#snippet children(f)}<Textarea
										{...f}
										class="mono"
										rows={6}
										placeholder={EX.svg}
										bind:value={form.values.logoSvg}
									/>{/snippet}
							</Field>
						</ShowWhen>
						<ShowWhen id="logo-image-panel" when={v.logoType === 'image'}>
							<div class="form-group">
								<label class="form-label" for="logo-image-file">{t('branding.logo_image_upload')}</label>
								<FilePicker
									id="logo-image-file"
									accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
									bind:files={logoFiles}
									bind:element={logoPicker}
									describedby="logo-image-file-hint logo-file-name"
									onchange={onLogoFile}
								/>
								<p class="form-hint" id="logo-image-file-hint">{t('branding.logo_image_hint')}</p>
								<p class={['field-effect', logoProblem && 'is-error']} id="logo-file-name">
									{logoProblem ||
										(pendingLogo
											? t('settings.appearance.logo_pending', { name: pendingLogo.name })
											: t('settings.appearance.logo_upload_effect'))}
								</p>
							</div>
							<Field
								id="logo-image-url"
								label={t('branding.logo_image_url')}
								hint={t('branding.logo_image_url_hint')}
							>
								{#snippet children(f)}<Input
										{...f}
										placeholder={EX.logoUrl}
										bind:value={form.values.logoUrl}
									/>{/snippet}
							</Field>
						</ShowWhen>
					</section>

					<section class="section form-column" id="branding-fonts" aria-labelledby="branding-fonts-title">
						<h2 id="branding-fonts-title">{t('branding.typography_title')}</h2>
						<p class="section-note">{t('branding.typography_desc')}</p>
						<FontPicker
							slot="heading"
							bind:value={form.values.fontHeading}
							google={fontSource === 'google'}
							category={fontCategory === 'all' ? '' : fontCategory}
							{canEdit}
							disabled={!canEdit}
							ondownload={() => void loadLocalFonts()}
						/>
						<FontPicker
							slot="body"
							bind:value={form.values.fontBody}
							google={fontSource === 'google'}
							category={fontCategory === 'all' ? '' : fontCategory}
							{canEdit}
							disabled={!canEdit}
							ondownload={() => void loadLocalFonts()}
						/>
						<div class="form-group" id="font-source">
							<span class="form-label" id="font-source-label">{t('settings.appearance.font_source')}</span>
							<SegmentedFilter
								label={t('settings.appearance.font_source')}
								bind:value={fontSource}
								options={[
									{ value: 'google', label: t('branding.font_google') },
									{ value: 'local', label: t('branding.font_local') },
									{ value: 'upload', label: t('branding.font_upload') }
								]}
							/>
						</div>
						{#if fontSource === 'google'}
							<div id="font-source-google">
								<SegmentedFilter
									label={t('settings.appearance.font_category')}
									bind:value={fontCategory}
									options={FONT_CATEGORIES}
								/>
							</div>
						{:else if fontSource === 'local'}
							<div id="font-source-local">
								{#if localError}
									<p class="state is-error">{localError}</p>
								{:else if localFonts && !localFonts.length}
									<RowList><ListRow empty title={t('branding.font_local_empty')} /></RowList>
								{:else if localFonts}
									<RowList label={t('branding.font_local')}>
										{#each localFonts as font (font.family)}
											<ListRow title={font.family}>
												{#snippet actions()}
													{#if canEdit}
														<Button
															size="sm"
															variant="danger-quiet"
															onclick={() => void removeFont(font.family)}>{t('branding.font_delete')}</Button
														>
													{/if}
												{/snippet}
											</ListRow>
										{/each}
									</RowList>
								{/if}
							</div>
						{:else}
							<div id="font-source-upload" class="font-upload">
								<Field id="font-upload-name" label={t('branding.font_upload_name')}>
									{#snippet children(f)}<Input {...f} maxlength={80} bind:value={fontUploadName} />{/snippet}
								</Field>
								<div class="form-group">
									<label class="form-label" for="font-upload-file">{t('branding.font_upload_choose')}</label>
									<FilePicker
										id="font-upload-file"
										accept=".woff2,.ttf,font/woff2,font/ttf"
										bind:files={fontFiles}
										bind:element={fontPicker}
										describedby="font-upload-file-effect"
										onchange={() => void onFontFile()}
									/>
									<p class="field-effect" id="font-upload-file-effect">
										{t('settings.appearance.font_upload_effect')}
									</p>
								</div>
							</div>
						{/if}
						<CountLine class="font-local-info">
							<strong id="font-local-count">{localFonts?.length ?? 0}</strong>
							{t('branding.font_downloaded_count')}
						</CountLine>
					</section>

					<section class="section form-column" id="branding-footer" aria-labelledby="branding-footer-title">
						<h2 id="branding-footer-title">{t('branding.footer_title')}</h2>
						<p class="section-note">{t('branding.footer_desc')}</p>
						<Field id="footer-text" label={t('branding.footer_text')} hint={t('branding.footer_text_hint')}>
							{#snippet children(f)}<Input
									{...f}
									maxlength={200}
									placeholder={EX.footer}
									bind:value={form.values.footerText}
								/>{/snippet}
						</Field>
						<Checkbox
							id="show-powered"
							label={t('branding.show_powered')}
							hint={t('branding.show_powered_hint')}
							bind:checked={form.values.showPoweredBy}
						/>
					</section>
				{/snippet}

				{#snippet end()}
					<section
						class="section form-column"
						id="branding-background"
						aria-labelledby="branding-background-title"
					>
						<h2 id="branding-background-title">{t('settings.appearance.console_background')}</h2>
						<p class="section-note">{t('branding.background_desc')}</p>
						<BackgroundFields
							prefix="bg"
							types={['none', 'color', 'gradient', 'image']}
							bind:type={form.values.bgType}
							bind:color={form.values.bgColor}
							bind:gradient={form.values.bgGradient}
							bind:imageUrl={form.values.bgImageUrl}
							bind:size={form.values.bgSize}
							showSize
							gradientHint
							gradientPlaceholder="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
							imagePlaceholder="https://example.com/wallpaper.jpg"
							target="bgImageUrl"
							upload={uploadBg}
							library={bgLibrary}
							effects={['bg-effects-group', 'bg-overlay-group']}
						>
							<ShowWhen id="bg-effects-group" when={v.bgType !== 'none'}>
								<RangeField
									id="bg-blur"
									label={t('branding.bg_blur')}
									unit="px"
									min={0}
									max={30}
									bind:value={form.values.bgBlur}
								/>
							</ShowWhen>
							<ShowWhen id="bg-overlay-group" when={v.bgType !== 'none'}>
								<RangeField
									id="bg-overlay"
									label={t('branding.bg_overlay')}
									unit="%"
									min={0}
									max={90}
									step={5}
									hint={t('branding.bg_overlay_hint')}
									bind:value={form.values.bgOverlay}
								/>
							</ShowWhen>
						</BackgroundFields>
						<fieldset class="settings-subgroup">
							<legend>{t('branding.glass_title')}</legend>
							<p class="form-hint">{t('branding.glass_desc')}</p>
							<Checkbox
								id="glass-enabled"
								label={t('branding.glass_enabled')}
								bind:checked={form.values.glassEnabled}
								{...showWhenControl('glass-fields', v.glassEnabled)}
							/>
							<ShowWhen id="glass-fields" when={v.glassEnabled}>
								<Field
									id="glass-color"
									label={t('branding.glass_color')}
									hint={t('branding.glass_color_hint')}
								>
									{#snippet children(f)}
										<ColorField
											id={f.id}
											describedby={f.describedby}
											label={t('branding.glass_color')}
											bind:value={form.values.glassColor}
										/>
									{/snippet}
								</Field>
								<RangeField
									id="glass-blur"
									label={t('branding.glass_blur')}
									unit="px"
									min={0}
									max={40}
									bind:value={form.values.glassBlur}
								/>
								<RangeField
									id="glass-opacity"
									label={t('branding.glass_opacity')}
									unit="%"
									min={0}
									max={100}
									step={5}
									bind:value={form.values.glassOpacity}
								/>
							</ShowWhen>
						</fieldset>
					</section>

					<section class="section form-column" id="branding-login" aria-labelledby="branding-login-title">
						<h2 id="branding-login-title">{t('branding.login_title')}</h2>
						<p class="section-note">{t('branding.login_desc')}</p>
						<Field id="login-title" label={t('branding.login_heading')}>
							{#snippet children(f)}<Input
									{...f}
									maxlength={80}
									placeholder={t('branding.login_heading_placeholder')}
									bind:value={form.values.loginTitle}
								/>{/snippet}
						</Field>
						<Field id="login-subtitle" label={t('branding.login_subheading')}>
							{#snippet children(f)}<Input
									{...f}
									maxlength={160}
									placeholder={t('branding.login_subheading_placeholder')}
									bind:value={form.values.loginSubtitle}
								/>{/snippet}
						</Field>
						<fieldset class="form-group radio-set" id="login-promo-mode-selector">
							<legend class="form-label">{t('branding.login_promo_mode')}</legend>
							<p class="form-hint">{t('branding.login_promo_mode_hint')}</p>
							<div class="radio-row">
								{#each PROMO as mode (mode.value)}
									<Radio
										name="login-promo-mode"
										value={mode.value}
										bind:group={form.values.loginPromoMode}
										label={t(mode.label)}
										aria-controls={mode.value === 'slides' ? 'login-slides-panel' : 'login-bg-config'}
									/>
								{/each}
							</div>
						</fieldset>
						<ShowWhen id="login-slides-panel" class="settings-subgroup" when={v.loginPromoMode === 'slides'}>
							<h3>{t('branding.login_slides_title')}</h3>
							<p class="form-hint">{t('branding.login_slides_desc')}</p>
							<ol class="slides" id="login-slides-list">
								{#each form.values.loginSlides as slide, i (slide.id)}
									{@const p = `login-slide-${i}`}
									<li class="slide">
										<div class="slide-head">
											<h4>{t('settings.appearance.slide_n', { n: i + 1 })}</h4>
											<div class="inline-controls">
												<Button size="sm" id="{p}-up" disabled={i === 0} onclick={() => move(i, -1)}
													>{t('branding.login_slide_move_up')}</Button
												>
												<Button
													size="sm"
													id="{p}-down"
													disabled={i >= form.values.loginSlides.length - 1}
													onclick={() => move(i, 1)}>{t('branding.login_slide_move_down')}</Button
												>
												<Button
													size="sm"
													variant="danger-quiet"
													disabled={form.values.loginSlides.length <= 1}
													onclick={() => removeSlide(i)}>{t('branding.login_slides_remove')}</Button
												>
											</div>
										</div>
										<div class="form-group">
											<label class="form-label" for="{p}-file">{t('branding.login_slide_image')}</label>
											<FilePicker
												id="{p}-file"
												accept="image/png,image/jpeg,image/webp,image/gif"
												onchange={(e) => void onSlideFile(i, e.currentTarget)}
											/>
											<label class="sr-only" for="{p}-url">{t('branding.bg_image_url')}</label>
											<Input id="{p}-url" placeholder={EX.slideImage} bind:value={slide.imageUrl} />
										</div>
										<Field id="{p}-title" label={t('branding.login_slide_title')}>
											{#snippet children(f)}
												<Input
													{...f}
													maxlength={120}
													placeholder={slide.slideKey ? t(`login_promo.slides.${slide.slideKey}.title`) : ''}
													bind:value={slide.title}
												/>
											{/snippet}
										</Field>
										<Field id="{p}-body" label={t('branding.login_slide_body')}>
											{#snippet children(f)}
												<Textarea
													{...f}
													rows={2}
													maxlength={400}
													placeholder={slide.slideKey ? t(`login_promo.slides.${slide.slideKey}.body`) : ''}
													bind:value={slide.body}
												/>
											{/snippet}
										</Field>
										<RangeField
											id="{p}-overlay"
											label={t('branding.bg_overlay')}
											unit="%"
											min={0}
											max={90}
											step={5}
											bind:value={slide.overlay}
										/>
									</li>
								{/each}
							</ol>
							<div class="inline-controls">
								<Button
									icon="add"
									id="login-slides-add"
									disabled={v.loginSlides.length >= MAX_SLIDES}
									onclick={addSlide}>{t('branding.login_slides_add')}</Button
								>
								<Button id="login-slides-restore" onclick={restoreSlides}
									>{t('branding.login_slides_restore')}</Button
								>
							</div>
							{#if v.loginSlides.length >= MAX_SLIDES}<p class="form-hint" id="login-slides-max-hint">
									{t('branding.login_slides_max')}
								</p>{/if}
						</ShowWhen>
						<ShowWhen id="login-bg-config" class="settings-subgroup" when={v.loginPromoMode !== 'slides'}>
							<h3>{t('settings.appearance.login_background')}</h3>
							<BackgroundFields
								prefix="login-bg"
								types={['inherit', 'color', 'gradient', 'image']}
								bind:type={form.values.loginBgType}
								bind:color={form.values.loginBgColor}
								bind:gradient={form.values.loginBgGradient}
								bind:imageUrl={form.values.loginBgImageUrl}
								gradientPlaceholder="linear-gradient(135deg, #1e293b 0%, #0f172a 100%)"
								imagePlaceholder="https://example.com/login-bg.jpg"
								target="loginBgImageUrl"
								upload={uploadBg}
								fileNote={currentImage(v.loginBgType, v.loginBgImageUrl)}
								effects={['login-bg-overlay-group']}
							>
								<ShowWhen
									id="login-bg-overlay-group"
									when={v.loginBgType !== 'inherit' && v.loginBgType !== 'none'}
								>
									<RangeField
										id="login-bg-overlay"
										label={t('branding.bg_overlay')}
										unit="%"
										min={0}
										max={90}
										step={5}
										bind:value={form.values.loginBgOverlay}
									/>
								</ShowWhen>
							</BackgroundFields>
						</ShowWhen>
					</section>

					<section class="section form-column" id="branding-agent" aria-labelledby="branding-agent-title">
						<h2 id="branding-agent-title">{t('branding.agent_title')}</h2>
						<p class="section-note">{t('branding.agent_desc')}</p>
						<BackgroundFields
							prefix="agent-bg"
							types={['none', 'color', 'gradient', 'image']}
							bind:type={form.values.agentBgType}
							bind:color={form.values.agentBgColor}
							bind:gradient={form.values.agentBgGradient}
							bind:imageUrl={form.values.agentBgImageUrl}
							gradientPlaceholder="linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)"
							imagePlaceholder="https://example.com/agent-bg.jpg"
							target="agentBgImageUrl"
							upload={uploadBg}
							fileNote={currentImage(v.agentBgType, v.agentBgImageUrl)}
						/>
						<Checkbox
							id="agent-show-powered"
							label={t('branding.agent_show_powered')}
							hint={t('branding.agent_show_powered_hint')}
							bind:checked={form.values.agentShowPoweredBy}
						/>
					</section>

					<section
						class="section form-column"
						id="branding-rdclient"
						aria-labelledby="branding-rdclient-title"
					>
						<h2 id="branding-rdclient-title">{t('settings.appearance.rdclient')}</h2>
						<p class="section-note">{t('remote_dashboard.subtitle')}</p>
						<BackgroundFields
							prefix="rdclient-bg"
							types={['inherit', 'none', 'color', 'gradient', 'image']}
							bind:type={form.values.rdclientBgType}
							bind:color={form.values.rdclientBgColor}
							bind:gradient={form.values.rdclientBgGradient}
							bind:imageUrl={form.values.rdclientBgImageUrl}
							bind:size={form.values.rdclientBgSize}
							showSize
							gradientPlaceholder="linear-gradient(135deg, #0d1117 0%, #172554 100%)"
							imagePlaceholder="https://example.com/rdclient-bg.jpg"
							target="rdclientBgImageUrl"
							upload={uploadBg}
							fileNote={currentImage(v.rdclientBgType, v.rdclientBgImageUrl)}
							effects={['rdclient-bg-overlay-group']}
						>
							<ShowWhen
								id="rdclient-bg-overlay-group"
								when={v.rdclientBgType !== 'inherit' && v.rdclientBgType !== 'none'}
							>
								<RangeField
									id="rdclient-bg-overlay"
									label={t('branding.bg_overlay')}
									unit="%"
									min={0}
									max={90}
									step={5}
									hint={t('branding.bg_overlay_hint')}
									bind:value={form.values.rdclientBgOverlay}
								/>
							</ShowWhen>
						</BackgroundFields>
					</section>

					<div class="section form-column" id="branding-css">
						<Disclosure title={t('branding.custom_css_title')} bind:open={cssOpen}>
							<div class="disclosure-body">
								<p class="section-note">{t('branding.custom_css_desc')}</p>
								<Field
									id="custom-css"
									label={t('branding.custom_css_title')}
									hint={t('branding.custom_css_hint')}
								>
									{#snippet children(f)}
										<Textarea
											{...f}
											class="mono"
											rows={10}
											spellcheck={false}
											placeholder={EX.css}
											bind:value={form.values.customCss}
										/>
									{/snippet}
								</Field>
							</div>
						</Disclosure>
					</div>
				{/snippet}
			</SettingsGrid>
		</fieldset>
		{#if canEdit}
			<SaveBar {form} {dirty} label={t('settings.appearance.save')}>
				<Button id="branding-revert-btn" disabled={!dirty} onclick={revert}
					>{t('branding.revert_changes')}</Button
				>
			</SaveBar>
		{/if}
	</form>

	{#if canEdit}
		<SettingsGrid>
			{#snippet start()}
				<section class="section form-column" id="branding-profiles" aria-labelledby="branding-profiles-title">
					<h2 id="branding-profiles-title">{t('settings.appearance.profiles')}</h2>
					<p class="section-note">{t('settings.appearance.profiles_note')}</p>
					<div class="form-group">
						<label class="form-label" for="branding-profile-select">{t('branding.profiles_label')}</label>
						<div class="inline-controls">
							<Select
								id="branding-profile-select"
								bind:value={profileId}
								options={profileOptions}
								describedby="branding-profile-effect"
							/>
							<Button id="branding-profile-apply-btn" busy={profileBusy} onclick={applySelected}
								>{t('branding.profile_apply')}</Button
							>
							<MenuButton label={t('settings.appearance.profile_more')}>
								<MenuItem icon="add" onselect={() => void newProfile()}>{t('branding.profile_new')}</MenuItem>
								<MenuItem icon="save" onselect={saveIntoProfile}>{t('branding.profile_save')}</MenuItem>
								<MenuItem icon="duplicate" onselect={duplicateSelected}
									>{t('branding.profile_duplicate')}</MenuItem
								>
								<MenuDivider />
								<MenuItem icon="delete" danger onselect={() => void deleteSelected()}
									>{t('branding.profile_delete')}</MenuItem
								>
							</MenuButton>
						</div>
						<p class="field-effect" id="branding-profile-effect">{t('settings.appearance.profile_effect')}</p>
						<FormStatus message={profileStatus.message} tone={profileStatus.tone} class="line-status" />
					</div>
				</section>
			{/snippet}
			{#snippet end()}
				<section class="section form-column" id="branding-import-export" aria-labelledby="branding-ie-title">
					<h2 id="branding-ie-title">{t('branding.import_export_title')}</h2>
					<p class="section-note">{t('branding.import_export_desc')}</p>
					<p class="line">
						<Button icon="export" id="branding-export-btn" onclick={() => void exportNow()}
							>{t('branding.export_theme')}</Button
						>
					</p>
					<div class="form-group">
						<label class="form-label" for="branding-import-input">{t('branding.import_theme')}</label>
						<FilePicker
							id="branding-import-input"
							accept=".json"
							bind:files={importFiles}
							bind:element={importPicker}
							describedby="branding-import-effect"
							onchange={() => void importNow()}
						/>
						<p class="field-effect" id="branding-import-effect">{t('settings.appearance.import_effect')}</p>
					</div>
					<FormStatus message={ieStatus.message} tone={ieStatus.tone} class="line-status" />
				</section>
			{/snippet}
		</SettingsGrid>

		<DangerZone
			title={t('settings.appearance.reset_title')}
			rows={[
				{
					title: t('branding.reset_defaults'),
					consequence: t('settings.appearance.reset_desc'),
					action: t('settings.appearance.reset_button'),
					onclick: () => void resetAll(),
					busy: resetting
				}
			]}
		/>
	{/if}
</SettingsLayout>

<style>
	.branding-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.settings-fieldset {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.settings-fieldset:disabled :global(.choice),
	.settings-fieldset:disabled :global(.checkbox-row),
	.settings-fieldset:disabled :global(.check-field) {
		cursor: default;
	}
	.form-column {
		max-width: var(--measure);
	}
	.form-column > :global(.form-group),
	.form-column > :global(.check-field),
	.form-column > :global(.show-when) {
		margin: 0;
	}
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
		margin: 0;
	}
	.radio-set {
		padding: 0;
		border: 0;
	}
	.radio-set > legend {
		padding: 0;
	}
	.form-label {
		font-weight: 600;
	}
	.form-hint,
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.field-effect.is-error {
		color: var(--danger);
	}
	.radio-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-5);
	}
	.inline-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.inline-controls > :global(.form-select) {
		flex: 1 1 220px;
		width: auto;
	}
	.color-group {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: var(--space-3) var(--space-5);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.color-group > legend {
		grid-column: 1 / -1;
		margin-bottom: var(--space-2);
		padding: 0;
		font-weight: 600;
	}
	.color-group > :global(.form-group) {
		margin: 0;
	}
	.form-column > :global(.show-when.settings-subgroup) {
		gap: var(--space-3);
	}
	.settings-subgroup {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.settings-subgroup > legend {
		margin-bottom: var(--space-2);
		padding: 0;
		font-weight: 600;
	}
	h3 {
		margin: 0;
		font-size: var(--text-md);
	}
	h4 {
		margin: 0;
		margin-inline-end: auto;
		font-size: var(--text-base, 1rem);
	}
	.background-library {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: var(--space-2);
	}
	.library-item {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: start;
		cursor: pointer;
	}
	.library-item:hover {
		border-color: var(--border);
	}
	.library-item.active {
		border-color: var(--accent);
		outline: 1px solid var(--accent);
	}
	.library-item:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.library-thumb {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 10;
		border-radius: 2px;
		background: var(--bg-subtle);
		object-fit: cover;
	}
	.library-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.slides {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.slide {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4) 0;
		border-bottom: 1px solid var(--rule);
	}
	.slide > :global(.form-group) {
		margin: 0;
	}
	.slide-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.font-upload {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.font-upload > :global(.form-group) {
		margin: 0;
	}
	.disclosure-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) 0 var(--space-2);
	}
	.disclosure-body > :global(.form-group) {
		margin: 0;
	}
	.line {
		margin: 0;
	}
	.state {
		margin: 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
	.form-column :global(.line-status:empty) {
		display: none;
	}
</style>
