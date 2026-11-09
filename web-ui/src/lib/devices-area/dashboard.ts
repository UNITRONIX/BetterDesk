/**
 * The overview's rules without a DOM: what the server status means, what
 * goes into "Needs attention", the device share, the port list, the text
 * that "Copy all" and the Windows install script copy, and reading the
 * support agent's pairing QR code.
 */

import type { ClientConfig, DeviceStats, ServerStatus } from '#lib/api/dashboard.ts';

export type PartState = 'running' | 'stopped' | 'unknown';

/** One server process from /api/server/status */
export function partState(part: { status?: string | null; online?: boolean | null } | null): PartState {
	if (part?.status === 'running' || part?.online === true) return 'running';
	if (part?.status === 'stopped' || part?.online === false) return 'stopped';
	return 'unknown';
}

/** Status tones (GUIDE section 10): a stopped ID or relay server is a failure here */
export function partTone(state: PartState | 'checking'): 'good' | 'danger' | 'neutral' | 'waiting' {
	if (state === 'running') return 'good';
	if (state === 'stopped') return 'danger';
	if (state === 'checking') return 'waiting';
	return 'neutral';
}

export function partLabelKey(state: PartState | 'checking'): string {
	if (state === 'running') return 'status.running';
	if (state === 'stopped') return 'status.stopped';
	if (state === 'checking') return 'status.checking';
	return 'status.unknown';
}

/**
 * The server line in "Needs attention": null while both servers run (the
 * line is not shown), otherwise the sentence that says which part is down
 * and what that means. A failed status request gives "Unknown".
 */
export function serverProblem(status: ServerStatus | null): string | null {
	if (!status) return 'status.unknown';
	const signal = partState(status.hbbs) === 'running';
	const relay = partState(status.hbbr) === 'running';
	if (signal && relay) return null;
	if (!signal && !relay) return 'dashboard.status_both_down';
	if (!relay) return 'dashboard.status_relay_down';
	return 'dashboard.status_signal_down';
}

/** Online, offline and banned as parts of the whole. Banned devices are also offline; offline here means offline and not banned. */
export function deviceParts(stats: DeviceStats): { online: number; offline: number; banned: number } {
	const banned = stats.banned;
	return { online: stats.online, offline: Math.max(0, stats.offline - banned), banned };
}

/** The ports in the order the old overview listed them; null when the server didn't say */
export function portList(status: ServerStatus | null): { key: string; value: string | null }[] {
	const s = status;
	return [
		{ key: 'dashboard.port_signal', value: s ? (s.signal_port ?? s.hbbs_port) : null },
		{ key: 'dashboard.port_nat', value: s?.nat_port ?? null },
		{ key: 'dashboard.port_ws_signal', value: s?.ws_signal_port ?? null },
		{ key: 'dashboard.port_api', value: s?.api_port ?? null },
		{ key: 'dashboard.port_relay', value: s ? (s.relay_port ?? s.hbbr_port) : null },
		{ key: 'dashboard.port_ws_relay', value: s?.ws_relay_port ?? null },
		{ key: 'dashboard.port_console', value: s?.console_port ?? null },
		{ key: 'dashboard.port_client_api', value: s?.client_api_port ?? null }
	];
}

/** "Copy all": one line per value, labelled, as the old overview copied them */
export function configText(config: ClientConfig, label: (key: string) => string): string {
	return [
		`${label('dashboard.config_server_id')}: ${config.server_id || '-'}`,
		`${label('dashboard.config_relay_server')}: ${config.relay_server || '-'}`,
		`${label('dashboard.config_api_server')}: ${config.api_url || '-'}`,
		`${label('dashboard.config_key')}: ${config.public_key || '-'}`
	].join('\n');
}

/** A value inside a single-quoted PowerShell string */
const psQuote = (s: string) => s.replace(/'/g, "''");

/**
 * The PowerShell snippet for Intune or PSADT: it hands RustDesk the same
 * values as the deploy string. Values are quoted for PowerShell, so a quote
 * in a host name can't end the string.
 */
export function intuneScript(config: ClientConfig | null): string {
	const host = config?.server_id || config?.client_server_host || 'YOUR_SERVER_HOST';
	const apiUrl = config?.api_url || `http://${host}:21114`;
	const publicKey = config?.public_key || 'YOUR_PUBLIC_KEY';
	return `# Run elevated after RustDesk MSI (PSADT post-install / Intune Win32)
$RustDesk = Join-Path $env:ProgramFiles 'RustDesk\\rustdesk.exe'
$ServerHost = '${psQuote(host)}'
$PublicKey = '${psQuote(publicKey)}'
$ApiUrl = '${psQuote(apiUrl)}'

$json = @{
    host = $ServerHost
    relay = $ServerHost
    api = $ApiUrl
    key = $PublicKey
} | ConvertTo-Json -Compress
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd('=')
$CfgString = -join ($b64[-1..-($b64.Length)] -join '')

Start-Process -FilePath $RustDesk -ArgumentList @('--config', $CfgString) -Wait -NoNewWindow
# Optional unattended password:
# Start-Process -FilePath $RustDesk -ArgumentList @('--password', 'YourPermanentPassword') -Wait -NoNewWindow`;
}

/**
 * The QR code a BetterDesk support agent shows: JSON
 * { type: 'betterdesk-agent-pairing', version: 1, device_id, server? }.
 * A code for another server (its host differs from this console's) is
 * refused. Returns the device ID, or null for anything else.
 */
export function readPairingCode(raw: string, consoleHost: string): string | null {
	let payload: unknown;
	try {
		payload = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!payload || typeof payload !== 'object') return null;
	const p = payload as Record<string, unknown>;
	if (p.type !== 'betterdesk-agent-pairing' || p.version !== 1) return null;
	if (typeof p.device_id !== 'string' || !p.device_id.trim()) return null;
	if (p.server !== undefined && p.server !== null && p.server !== '') {
		if (typeof p.server !== 'string') return null;
		try {
			if (new URL(p.server).host !== consoleHost) return null;
		} catch {
			return null;
		}
	}
	return p.device_id.trim();
}

/* ── The address typed into "Client server address", for this tab only ── */

export const CLIENT_HOST_KEY = 'bd_client_config_host';

export function readClientHost(): string {
	try {
		return sessionStorage.getItem(CLIENT_HOST_KEY) ?? '';
	} catch {
		return '';
	}
}

export function writeClientHost(host: string): void {
	try {
		if (host) sessionStorage.setItem(CLIENT_HOST_KEY, host);
		else sessionStorage.removeItem(CLIENT_HOST_KEY);
	} catch {
		/* storage blocked: the value lasts until the page is left */
	}
}
