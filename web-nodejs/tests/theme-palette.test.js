/**
 * Theme palette resolution for UX 3.5 light/dark/custom
 */
const {
    resolveThemeColors,
    normalizeThemeMode,
    hexToMutedRgba,
    BUILTIN_THEME_PALETTES,
    getThemePalettes
} = require('../services/brandingService');

describe('UX 3.5 theme palettes', () => {
    test('exposes the canonical palettes without shared mutable state', () => {
        const palettes = getThemePalettes();
        expect(palettes).toEqual({
            dark: expect.objectContaining({ bgPrimary: '#141616' }),
            light: expect.objectContaining({ bgPrimary: '#ffffff' })
        });
        palettes.dark.bgPrimary = '#000000';
        expect(BUILTIN_THEME_PALETTES.dark.bgPrimary).toBe('#141616');
    });

    test('normalizeThemeMode maps auto → dark and rejects junk', () => {
        expect(normalizeThemeMode('auto')).toBe('dark');
        expect(normalizeThemeMode('light')).toBe('light');
        expect(normalizeThemeMode('custom')).toBe('custom');
        expect(normalizeThemeMode('system')).toBe('system');
        expect(normalizeThemeMode('nope')).toBe('dark');
    });

    test('light mode ignores stale dark DB colors', () => {
        const colors = resolveThemeColors({
            themeMode: 'light',
            colors: {
                bgPrimary: '#0d1117',
                textPrimary: '#e6edf3'
            }
        });
        expect(colors.bgPrimary).toBe(BUILTIN_THEME_PALETTES.light.bgPrimary);
        expect(colors.textPrimary).toBe(BUILTIN_THEME_PALETTES.light.textPrimary);
        expect(colors.accentBlue).toBe('#1b62cf');
    });

    test('dark mode uses built-in dark palette', () => {
        const colors = resolveThemeColors({ themeMode: 'dark', colors: {} });
        expect(colors.bgPrimary).toBe('#141616');
        expect(colors.textPrimary).toBe('#e4e7e7');
    });

    test('system mode uses light as the base palette', () => {
        const colors = resolveThemeColors({ themeMode: 'system', colors: { bgPrimary: '#112233' } });
        expect(colors.bgPrimary).toBe(BUILTIN_THEME_PALETTES.light.bgPrimary);
    });

    test('custom mode keeps operator colors over dark defaults', () => {
        const colors = resolveThemeColors({
            themeMode: 'custom',
            colors: { bgPrimary: '#112233', textPrimary: '#abcdef' }
        });
        expect(colors.bgPrimary).toBe('#112233');
        expect(colors.textPrimary).toBe('#abcdef');
        expect(colors.bgSecondary).toBe(BUILTIN_THEME_PALETTES.dark.bgSecondary);
    });
});

describe('hexToMutedRgba', () => {
    test('converts solid accent hex to translucent rgba (branding.css + theme preview)', () => {
        expect(hexToMutedRgba('#58a6ff')).toBe('rgba(88, 166, 255, 0.15)');
        expect(hexToMutedRgba('#0969da')).toBe('rgba(9, 105, 218, 0.15)');
        expect(hexToMutedRgba('58a6ff')).toBe('rgba(88, 166, 255, 0.15)');
    });

    test('accepts custom alpha and rejects invalid hex', () => {
        expect(hexToMutedRgba('#58a6ff', 0.1)).toBe('rgba(88, 166, 255, 0.1)');
        expect(hexToMutedRgba('#fff')).toBeNull();
        expect(hexToMutedRgba('not-a-color')).toBeNull();
        expect(hexToMutedRgba(null)).toBeNull();
    });

    // The console's theme switch (web-ui src/lib/state/theme.svelte.ts) writes palette values to the page as they are,
    // so muted colours must already be translucent tints, never solid hex.
    test('built-in muted palette keys are translucent tints', () => {
        for (const mode of ['dark', 'light']) {
            for (const [key, value] of Object.entries(BUILTIN_THEME_PALETTES[mode])) {
                if (!key.endsWith('Muted')) continue;
                const m = /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0?\.\d+)\)$/.exec(value);
                const alpha = m ? Number(m[1]) : NaN;
                expect([mode, key, alpha >= 0.12 && alpha <= 0.18]).toEqual([mode, key, true]);
            }
        }
        expect(BUILTIN_THEME_PALETTES.dark.accentBlueMuted).toBe(hexToMutedRgba(BUILTIN_THEME_PALETTES.dark.accentBlue));
        expect(BUILTIN_THEME_PALETTES.light.accentBlueMuted).toBe(hexToMutedRgba(BUILTIN_THEME_PALETTES.light.accentBlue));
    });
});

// WCAG relative luminance and contrast ratio of two #rrggbb colours
function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

describe('field border contrast', () => {
    const fs = require('fs');
    const path = require('path');
    const themesDir = path.join(__dirname, '..', 'themes');
    const palettes = [
        ['built-in dark', BUILTIN_THEME_PALETTES.dark],
        ['built-in light', BUILTIN_THEME_PALETTES.light],
        ...fs.readdirSync(themesDir).filter((f) => f.endsWith('.json')).map((f) => [
            'preset ' + f,
            JSON.parse(fs.readFileSync(path.join(themesDir, f), 'utf8')).branding.colors
        ])
    ];
    // Fields and controls sit on the page, sections, hover rows and floating surfaces
    const surfaces = ['bgPrimary', 'bgSecondary', 'bgTertiary', 'bgElevated'];

    test.each(palettes)('%s: borderPrimary reaches 3:1 on every surface', (_name, colors) => {
        const ratios = Object.fromEntries(surfaces.map((s) =>
            [s, Math.floor(contrast(colors.borderPrimary, colors[s]) * 100) / 100]));
        const below = Object.entries(ratios).filter(([, r]) => r < 3);
        expect({ border: colors.borderPrimary, below }).toEqual({ border: colors.borderPrimary, below: [] });
    });

    test('contrast() matches known WCAG values', () => {
        expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    });
});

describe('generateThemeCss in system mode', () => {
    test('emits light colours and switches to dark under prefers-color-scheme', () => {
        const service = require('../services/brandingService');
        // Defaults (no DB loaded) use the system mode
        const css = service.generateThemeCss();
        expect(css).toContain('--bg-primary: ' + service.BUILTIN_THEME_PALETTES.light.bgPrimary);
        expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--bg-primary: #141616/);
        expect(css).toContain('color-scheme: light dark');
    });
});
