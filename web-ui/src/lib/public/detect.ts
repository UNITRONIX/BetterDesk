/**
 * Which installer fits the visitor's computer (views/downloads-portal.ejs,
 * agent-download.ejs): the system from the user agent, the processor where
 * the agent tells (arm64 or x64), and on the bundle page the portable
 * build for Windows and Linux. That row gets the primary button and the
 * "matches this computer" line. Phones and tablets get no match.
 */

export type DesktopOs = 'windows' | 'macos' | 'linux';

export interface ThisComputer {
	platform: DesktopOs;
	arch?: 'x64' | 'arm64';
	format?: string;
}

export interface InstallerLike {
	platform: string;
	arch?: string;
	format?: string;
}

/** `withFormat`: the bundle page also asks for the portable build on Windows and Linux */
export function detectComputer(userAgent: string, withFormat = false): ThisComputer | null {
	const arm = /arm64|aarch64/i.test(userAgent);
	const arch = arm ? 'arm64' : 'x64';
	const format = withFormat ? { format: 'portable' } : {};
	if (/Windows/i.test(userAgent)) return { platform: 'windows', arch, ...format };
	if (/Mac OS X|Macintosh/i.test(userAgent) && !/iPhone|iPad/i.test(userAgent)) return { platform: 'macos' };
	if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) return { platform: 'linux', arch, ...format };
	return null;
}

/** The first installer that fits, or -1 */
export function matchingIndex(items: readonly InstallerLike[], mine: ThisComputer | null): number {
	if (!mine) return -1;
	return items.findIndex(
		(i) =>
			i.platform === mine.platform &&
			(!mine.arch || i.arch === mine.arch) &&
			(!mine.format || i.format === mine.format)
	);
}

const NAMES: Record<string, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' };

/** "Windows x64, portable" (the format word comes translated) */
export function installerTitle(i: InstallerLike, formatWord: (format: string) => string): string {
	const name = NAMES[i.platform] ?? i.platform;
	const format = i.format ? formatWord(i.format) : '';
	return [name, i.arch].filter(Boolean).join(' ') + (format ? ', ' + format : '');
}

/** Download addresses are this server's paths or http(s) addresses, nothing else */
export function safeDownloadUrl(url: string): string | null {
	if (/^\/(?![/\\])/.test(url)) return url;
	try {
		const u = new URL(url);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
	} catch {
		return null;
	}
}
