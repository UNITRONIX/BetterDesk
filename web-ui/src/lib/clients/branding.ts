/**
 * Client app branding without a DOM: the accent colour checks, the text
 * colour that reads on it, the logo file checks and what the save sends.
 * Tested in tests/unit/clients/branding.test.ts.
 */

import type { BrandingInput, BrandingLogo } from '#lib/api/clientBranding.ts';

export const DEFAULT_ACCENT = '#4f6ef7';
export const MAX_LOGO = 512 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(value: string): boolean {
	return HEX.test(value.trim());
}

/** #abc → #aabbcc, lower case */
export function expandHex(value: string): string {
	const c = value.trim().toLowerCase();
	return c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
}

/** Relative luminance of a #rrggbb colour (WCAG) */
export function luminance(hex: string): number {
	const n = parseInt(hex.slice(1), 16);
	const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

/** The preview button: the accent (or the default while the field is not a colour) and black or white text, whichever reads better */
export function buttonColors(accent: string): { background: string; text: string } {
	const background = isHex(accent) ? expandHex(accent) : DEFAULT_ACCENT;
	const l = luminance(background);
	const onWhite = 1.05 / (l + 0.05);
	const onBlack = (l + 0.05) / 0.05;
	return { background, text: onBlack >= onWhite ? '#000000' : '#ffffff' };
}

export type LogoProblem = 'too_large' | 'invalid' | null;

/** A picked logo file: 512 KiB at most, PNG, JPEG or WebP */
export function checkLogo(file: { size: number; type: string }): LogoProblem {
	if (file.size <= 0 || file.size > MAX_LOGO) return 'too_large';
	if (!LOGO_TYPES.includes(file.type.toLowerCase())) return 'invalid';
	return null;
}

/** A data: URL from FileReader into what the server stores */
export function logoFromDataUrl(dataUrl: string, type: string): { mime: string; data_base64: string } {
	const comma = dataUrl.indexOf(',');
	const mime = type.toLowerCase() === 'image/jpg' ? 'image/jpeg' : type.toLowerCase();
	return { mime, data_base64: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl };
}

/** What an <img> shows for a logo: its data, or its URL when it is on this server */
export function logoSrc(logo: Partial<BrandingLogo> | null | undefined): string {
	if (!logo) return '';
	if (logo.data_base64 && logo.mime && /^image\/(png|jpeg|webp)$/.test(logo.mime))
		return `data:${logo.mime};base64,${logo.data_base64}`;
	const url = logo.url ?? '';
	// Same-origin paths only: the console's CSP allows images from itself and data: URLs
	return url.startsWith('/') && !url.startsWith('//') ? url : '';
}

export interface BrandingValues {
	company_name: string;
	support_contact: string;
	phone: string;
	email: string;
	website: string;
	accent_color: string;
	logo: Partial<BrandingLogo> | null;
	clearLogo: boolean;
}

/** The save's body: trimmed text, and the logo as it is now (kept, new or removed) */
export function brandingPayload(v: BrandingValues): BrandingInput {
	const out: BrandingInput = {
		company_name: v.company_name.trim(),
		phone: v.phone.trim(),
		email: v.email.trim(),
		website: v.website.trim(),
		support_contact: v.support_contact.trim(),
		accent_color: v.accent_color.trim()
	};
	if (v.clearLogo) out.clear_logo = true;
	else if (v.logo && (v.logo.data_base64 || v.logo.url)) {
		out.logo = {
			mime: v.logo.mime ?? '',
			...(v.logo.data_base64 ? { data_base64: v.logo.data_base64 } : {}),
			...(v.logo.url ? { url: v.logo.url } : {})
		};
	}
	return out;
}

/** "Last saved" from the revision (milliseconds since 1970), or null when it never was */
export function savedAt(revision: string): Date | null {
	const ms = Number(revision);
	return Number.isFinite(ms) && ms > 1e12 ? new Date(ms) : null;
}
