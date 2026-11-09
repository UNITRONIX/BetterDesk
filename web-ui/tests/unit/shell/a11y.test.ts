import { beforeEach, describe, expect, test } from 'vitest';
import {
	DEFAULTS,
	STORAGE_KEY,
	a11y,
	applyToRoot,
	chooseProfile,
	initA11y,
	isDefault,
	load,
	profileSettings,
	resetA11y,
	sanitize,
	setA11y,
	visualFilter
} from '../../../src/lib/shell/a11y.svelte.ts';

const root = document.documentElement;

beforeEach(() => {
	localStorage.clear();
	resetA11y();
});

describe('sanitize (accessibility.js sanitize)', () => {
	test('the same key and defaults as the old panel', () => {
		expect(STORAGE_KEY).toBe('betterdesk_accessibility_v1');
		expect(sanitize({})).toEqual(DEFAULTS);
		expect(sanitize(null)).toEqual(DEFAULTS);
		expect(sanitize('x')).toEqual(DEFAULTS);
	});

	test('numbers are clamped to the old limits', () => {
		const s = sanitize({
			fontScale: 300,
			lineHeight: 0.5,
			letterSpacing: 1,
			wordSpacing: -1,
			saturation: 999
		});
		expect(s).toMatchObject({
			fontScale: 160,
			lineHeight: 1.2,
			letterSpacing: 0.14,
			wordSpacing: 0,
			saturation: 180
		});
		expect(sanitize({ fontScale: '120' }).fontScale).toBe(120);
	});

	test('what is not a number keeps the default; null counts as 0 like Number(null)', () => {
		expect(sanitize({ fontScale: 'big', lineHeight: undefined }).fontScale).toBe(100);
		expect(sanitize({ lineHeight: undefined }).lineHeight).toBe(1.5);
		expect(sanitize({ fontScale: null }).fontScale).toBe(90);
	});

	test('unknown choices fall back; switches are on only when exactly true', () => {
		const s = sanitize({
			contrast: 'neon',
			colorFilter: 'sepia',
			activeProfile: 'hacker',
			underlineLinks: 'true',
			strongFocus: 1,
			readingGuide: true
		});
		expect(s.contrast).toBe('normal');
		expect(s.colorFilter).toBe('none');
		expect(s.activeProfile).toBe('');
		expect(s.underlineLinks).toBe(false);
		expect(s.strongFocus).toBe(false);
		expect(s.readingGuide).toBe(true);
		expect(sanitize({ contrast: 'yellow-black', colorFilter: 'tritanopia' })).toMatchObject({
			contrast: 'yellow-black',
			colorFilter: 'tritanopia'
		});
	});

	test('stored JSON that does not parse gives the defaults', () => {
		localStorage.setItem(STORAGE_KEY, '{oops');
		expect(load()).toEqual(DEFAULTS);
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontScale: 130, contrast: 'high-light' }));
		expect(load()).toMatchObject({ fontScale: 130, contrast: 'high-light' });
	});
});

describe('profiles', () => {
	test('each profile sets what the old one set', () => {
		expect(profileSettings(DEFAULTS, 'lowVision')).toMatchObject({
			activeProfile: 'lowVision',
			fontScale: 130,
			lineHeight: 1.75,
			contrast: 'high-dark',
			underlineLinks: true,
			highlightLinks: true,
			strongFocus: true,
			largeCursor: true
		});
		expect(profileSettings(DEFAULTS, 'dyslexia')).toMatchObject({
			fontScale: 112,
			lineHeight: 1.85,
			letterSpacing: 0.045,
			wordSpacing: 0.09,
			readableFont: true,
			dyslexiaFont: true
		});
		expect(profileSettings(DEFAULTS, 'motionSafe')).toMatchObject({
			reduceMotion: true,
			pauseAnimations: true,
			readingGuide: true,
			strongFocus: true
		});
		expect(profileSettings(DEFAULTS, 'colorAssist')).toMatchObject({
			colorFilter: 'deuteranopia',
			saturation: 125,
			highlightHeadings: true
		});
	});

	test('choosing the active profile again goes back to the defaults and removes the key', () => {
		chooseProfile('lowVision');
		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ activeProfile: 'lowVision' });
		chooseProfile('lowVision');
		expect(a11y.settings).toEqual(DEFAULTS);
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});

	test('changing one control clears the profile', () => {
		chooseProfile('motionSafe');
		setA11y('fontScale', 120);
		expect(a11y.settings.activeProfile).toBe('');
		expect(a11y.settings.reduceMotion).toBe(true);
		expect(a11y.settings.fontScale).toBe(120);
	});
});

describe('applying to <html>', () => {
	test('variables and data attributes as accessibility.js sets them', () => {
		setA11y('fontScale', 130);
		setA11y('letterSpacing', 0.05);
		setA11y('contrast', 'high-dark');
		setA11y('underlineLinks', true);
		setA11y('dyslexiaFont', true);
		expect(root.style.getPropertyValue('--bd-a11y-font-scale')).toBe('1.3');
		expect(root.style.getPropertyValue('--bd-a11y-letter-spacing')).toBe('0.05em');
		expect(root.dataset.a11yActive).toBe('true');
		expect(root.dataset.a11yFontScaled).toBe('true');
		expect(root.dataset.a11yContrast).toBe('high-dark');
		expect(root.dataset.a11yUnderlineLinks).toBe('true');
		expect(root.dataset.a11yDyslexia).toBe('true');
		expect(root.dataset.a11yHideMedia).toBe('false');
	});

	test('colour filter and saturation go into one CSS filter on the root', () => {
		const s = sanitize({ colorFilter: 'protanopia', saturation: 125 });
		expect(visualFilter(s)).toBe('url(#bd-a11y-protanopia) saturate(125%)');
		applyToRoot(s);
		expect(root.dataset.a11yFiltered).toBe('true');
		expect(root.style.getPropertyValue('--bd-a11y-visual-filter')).toBe(
			'url(#bd-a11y-protanopia) saturate(125%)'
		);
		applyToRoot(DEFAULTS);
		expect(root.dataset.a11yFiltered).toBe('false');
		expect(root.style.getPropertyValue('--bd-a11y-visual-filter')).toBe('none');
	});

	test('reset puts everything back', () => {
		chooseProfile('colorAssist');
		resetA11y();
		expect(isDefault(a11y.settings)).toBe(true);
		expect(root.dataset.a11yActive).toBe('false');
	});

	test('start reads what is stored (clamped)', () => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontScale: 999, highlightHeadings: true }));
		initA11y();
		expect(a11y.settings.fontScale).toBe(160);
		expect(root.dataset.a11yHighlightHeadings).toBe('true');
	});
});
