/**
 * Platform support without a DOM: the feature matrix and the limits per
 * system (fixed data, as the old page had it), the tabs and ?tab=, and the
 * counts per system, version, architecture, codec and feature.
 */

export const TABS = ['matrix', 'distribution', 'protocols', 'limitations'] as const;
export type CpTab = (typeof TABS)[number];

/** ?tab= as a tab; anything else is the feature matrix */
export function tabFrom(value: string | null | undefined): CpTab {
	return TABS.includes(value as CpTab) ? (value as CpTab) : 'matrix';
}

export const PLATFORMS = [
	'windows',
	'linux_x86',
	'linux_arm',
	'macos',
	'android',
	'ios',
	'web',
	'chromeos'
] as const;

export type Support = 'full' | 'partial' | 'none' | 'planned';

/** Which feature works on which system, in the order of PLATFORMS */
export const MATRIX: readonly { feature: string; values: readonly Support[] }[] = [
	{
		feature: 'feat_desktop_client',
		values: ['full', 'full', 'full', 'full', 'planned', 'planned', 'partial', 'partial']
	},
	{
		feature: 'feat_background_agent',
		values: ['full', 'full', 'full', 'partial', 'partial', 'none', 'none', 'partial']
	},
	{
		feature: 'feat_remote_target',
		values: ['full', 'full', 'partial', 'partial', 'partial', 'none', 'partial', 'partial']
	},
	{
		feature: 'feat_screen_capture',
		values: ['full', 'full', 'full', 'partial', 'partial', 'none', 'partial', 'partial']
	},
	{
		feature: 'feat_input_injection',
		values: ['full', 'full', 'full', 'partial', 'partial', 'none', 'partial', 'none']
	},
	{
		feature: 'feat_file_transfer',
		values: ['full', 'full', 'full', 'full', 'partial', 'none', 'partial', 'partial']
	},
	{
		feature: 'feat_clipboard_sync',
		values: ['full', 'full', 'full', 'full', 'partial', 'none', 'partial', 'partial']
	},
	{
		feature: 'feat_audio_streaming',
		values: ['full', 'full', 'partial', 'partial', 'none', 'none', 'partial', 'none']
	},
	{ feature: 'feat_chat', values: ['full', 'full', 'full', 'full', 'full', 'full', 'full', 'full'] },
	{
		feature: 'feat_session_recording',
		values: ['full', 'full', 'full', 'partial', 'none', 'none', 'partial', 'none']
	},
	{
		feature: 'feat_multi_monitor',
		values: ['full', 'full', 'full', 'full', 'partial', 'none', 'partial', 'none']
	},
	{
		feature: 'feat_unattended_access',
		values: ['full', 'full', 'full', 'partial', 'partial', 'none', 'none', 'none']
	},
	{ feature: 'feat_h264', values: ['full', 'full', 'full', 'full', 'full', 'none', 'partial', 'full'] },
	{ feature: 'feat_vp9', values: ['full', 'full', 'full', 'full', 'partial', 'none', 'partial', 'partial'] },
	{
		feature: 'feat_av1',
		values: ['partial', 'partial', 'none', 'partial', 'none', 'none', 'partial', 'none']
	},
	{ feature: 'feat_cdap_agent', values: ['full', 'full', 'full', 'partial', 'none', 'none', 'none', 'none'] }
];

export type Readiness = 'production' | 'testing' | 'planned' | 'limited' | 'experimental';

/** Status tones: ready good, testing waiting, planned neutral, limited and experimental warning */
export const READINESS_TONE: Record<Readiness, 'good' | 'waiting' | 'neutral' | 'warning'> = {
	production: 'good',
	testing: 'waiting',
	planned: 'neutral',
	limited: 'warning',
	experimental: 'warning'
};

export const LIMITATIONS: readonly { platform: string; status: Readiness; items: readonly string[] }[] = [
	{
		platform: 'windows',
		status: 'production',
		items: ['limit_win_uac', 'limit_win_service', 'limit_win_firewall', 'limit_win_virtual_account']
	},
	{
		platform: 'linux',
		status: 'production',
		items: ['limit_linux_wayland', 'limit_linux_pipewire', 'limit_linux_arm', 'limit_linux_unprivileged']
	},
	{
		platform: 'macos',
		status: 'testing',
		items: ['limit_mac_screen', 'limit_mac_signing', 'limit_mac_notarize']
	},
	{
		platform: 'android',
		status: 'planned',
		items: ['limit_android_projection', 'limit_android_accessibility', 'limit_android_battery']
	},
	{
		platform: 'ios',
		status: 'limited',
		items: ['limit_ios_capture', 'limit_ios_input', 'limit_ios_appstore']
	},
	{
		platform: 'web',
		status: 'production',
		items: ['limit_web_https', 'limit_web_codec', 'limit_web_performance']
	},
	{
		platform: 'chromeos',
		status: 'experimental',
		items: ['limit_chrome_crostini', 'limit_chrome_pwa', 'limit_chrome_input']
	}
];

/**
 * Clients report their system in different ways ("windows", "Ubuntu 22.04",
 * "debian 12"); one name per system, so Linux is not split over several rows.
 */
export function platformFamily(key: string): string {
	const k = key.toLowerCase().trim();
	if (!k) return 'unknown';
	if (k.startsWith('win')) return 'windows';
	if (/^(mac|darwin|osx|os x)/.test(k)) return 'macos';
	if (k.startsWith('android')) return 'android';
	if (/^(ios|ipados|iphone|ipad)/.test(k)) return 'ios';
	if (/chrome ?os|cros/.test(k)) return 'chromeos';
	if (
		/^(linux|ubuntu|debian|fedora|centos|rhel|red hat|rocky|alma|arch|manjaro|mint|opensuse|suse|raspbian|pop|elementary|kali|gentoo|alpine|nixos)/.test(
			k
		)
	)
		return 'linux';
	return k;
}

export function mergeFamilies(counts: Record<string, number>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [k, n] of Object.entries(counts)) {
		const f = platformFamily(k);
		out[f] = (out[f] ?? 0) + n;
	}
	return out;
}

export interface CountRow {
	name: string;
	count: number;
	/** Whole percent of the total, 0 when there is no total */
	share: number;
}

/** Most first; equal counts keep the server's order */
export function countRows(counts: Record<string, number>, total: number): CountRow[] {
	return Object.entries(counts)
		.sort((a, b) => b[1] - a[1])
		.map(([name, count]) => ({ name, count, share: total > 0 ? Math.round((count / total) * 100) : 0 }));
}

/** No architecture reported at all: every row is empty or "unknown" */
export const noArchitecture = (rows: CountRow[]) =>
	rows.length > 0 && rows.every((r) => !r.name || r.name === 'unknown');

/** The client versions table shows the eight most common */
export const VERSION_ROWS = 8;
