/**
 * Remote viewer preferences per console account, in this browser
 * (localStorage "betterdesk_remote_prefs_<user id>", the key the old
 * viewer used, so choices carry over). Port of public/js/remoteViewerPrefs.js.
 */

export type Quality = 'Best' | 'Balanced' | 'Low';
export type ScaleMode = 'fit' | 'fill' | '1:1' | 'stretch';
export type FpsMode = '30' | '60' | 'adaptive';
export type KeyboardMode = 'Auto' | 'Legacy' | 'Map';
export type QualityPreset = 'best' | 'balanced' | 'speed';

export interface ViewerPrefs {
	quality: Quality;
	scale: ScaleMode;
	codec: string;
	fpsMode: FpsMode;
	adaptiveQuality: boolean;
	backgroundFps: number;
	keyboardMode: KeyboardMode;
}

export const BACKGROUND_FPS = 1;

export const DEFAULT_PREFS: Readonly<ViewerPrefs> = Object.freeze({
	quality: 'Best',
	scale: 'fit',
	codec: 'Auto',
	fpsMode: 'adaptive',
	adaptiveQuality: true,
	backgroundFps: BACKGROUND_FPS,
	keyboardMode: 'Auto'
});

export const QUALITIES: readonly Quality[] = ['Best', 'Balanced', 'Low'];
export const SCALES: readonly ScaleMode[] = ['fit', 'fill', '1:1', 'stretch'];
export const FPS_MODES: readonly FpsMode[] = ['30', '60', 'adaptive'];
export const KEYBOARD_MODES: readonly KeyboardMode[] = ['Auto', 'Legacy', 'Map'];
export const CODECS: readonly string[] = ['Auto', 'VP9', 'AV1', 'H264', 'VP8', 'H265'];

const QUALITY_TO_PRESET: Record<Quality, QualityPreset> = {
	Best: 'best',
	Balanced: 'balanced',
	Low: 'speed'
};
const PRESET_FPS: Record<string, number> = { best: 60, balanced: 30, quality: 30, speed: 60 };

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
	return typeof v === 'string' && (list as readonly string[]).includes(v);
}

export function sanitizePrefs(raw: unknown): ViewerPrefs {
	const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const clean: ViewerPrefs = { ...DEFAULT_PREFS };
	if (oneOf(QUALITIES, s.quality)) clean.quality = s.quality;
	if (oneOf(SCALES, s.scale)) clean.scale = s.scale;
	if (typeof s.codec === 'string' && s.codec.length <= 16) clean.codec = s.codec;
	if (oneOf(FPS_MODES, s.fpsMode)) clean.fpsMode = s.fpsMode;
	if (typeof s.adaptiveQuality === 'boolean') clean.adaptiveQuality = s.adaptiveQuality;
	const bg = Number(s.backgroundFps);
	if (Number.isFinite(bg) && bg >= 1 && bg <= 5) clean.backgroundFps = Math.round(bg);
	if (oneOf(KEYBOARD_MODES, s.keyboardMode)) clean.keyboardMode = s.keyboardMode;
	return clean;
}

export function prefsKey(userId: string | number | null | undefined): string {
	return 'betterdesk_remote_prefs_' + (userId != null ? String(userId) : 'anonymous');
}

export function loadPrefs(userId: string | number | null | undefined): ViewerPrefs {
	try {
		const raw = localStorage.getItem(prefsKey(userId));
		return raw ? sanitizePrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
	} catch {
		return { ...DEFAULT_PREFS };
	}
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Saved after 400 ms, so a run of menu clicks writes once */
export function savePrefs(userId: string | number | null | undefined, prefs: ViewerPrefs): ViewerPrefs {
	const clean = sanitizePrefs(prefs);
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			localStorage.setItem(prefsKey(userId), JSON.stringify(clean));
		} catch {
			/* storage blocked */
		}
	}, 400);
	return clean;
}

export function presetForQuality(quality: string): QualityPreset {
	return QUALITY_TO_PRESET[quality as Quality] ?? 'balanced';
}

export function fpsForMode(mode: string, quality: string): number {
	if (mode === '60' || mode === 'adaptive') return 60;
	if (mode === '30') return 30;
	return PRESET_FPS[presetForQuality(quality)] ?? 30;
}
