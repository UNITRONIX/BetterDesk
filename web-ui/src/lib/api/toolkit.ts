/**
 * Network tools: every check runs on the server.
 * - /api/network/{ping,tcp,http,resolve} (device.connect): the bare result,
 *   where `success` is the check's answer, not the call's
 * - /api/toolkit/* (signed in; Wake-on-LAN device.connect): { success, data },
 *   and a remote failure (TLS error, send error) is 200 { success: false, error }
 * - /api/system/info, /api/database/stats, /api/docker/containers,
 *   /api/logs/recent, /api/speed-test (metrics.view)
 */

import * as v from 'valibot';
import { api, ApiError, clientMessages, request } from './client.ts';

const OptNum = v.optional(v.nullable(v.number()));
const OptStr = v.optional(v.nullable(v.string()));

/** A toolkit answer's data, checked */
function toolkit<S extends v.GenericSchema>(inner: S) {
	return v.pipe(
		v.looseObject({ success: v.optional(v.boolean()), data: v.optional(v.unknown()) }),
		v.transform((o) => o.data),
		inner
	);
}

async function post<S extends v.GenericSchema>(
	inner: S,
	path: string,
	body: unknown
): Promise<v.InferOutput<S>> {
	const raw = await request(path, { method: 'POST', body });
	if (raw && typeof raw === 'object' && (raw as { success?: unknown }).success === false) {
		const err = (raw as { error?: unknown }).error;
		throw new ApiError(
			typeof err === 'string' && err ? err : clientMessages.failed.replace('{status}', '200'),
			200
		);
	}
	const parsed = v.safeParse(toolkit(inner), raw);
	if (!parsed.success)
		throw new ApiError(clientMessages.invalid, 200, { code: 'invalid_response', data: raw });
	return parsed.output;
}

/* ── Network checks ── */

export const PingResult = v.looseObject({
	host: OptStr,
	success: v.optional(v.boolean()),
	rtt_ms: OptNum,
	error: OptStr
});
export type PingResult = v.InferOutput<typeof PingResult>;
export function ping(host: string) {
	return api(PingResult, '/api/network/ping', { method: 'POST', body: { host } });
}

export const TcpResult = v.looseObject({
	success: v.optional(v.boolean()),
	open: v.optional(v.boolean()),
	connected: v.optional(v.boolean()),
	rtt_ms: OptNum,
	error: OptStr
});
export type TcpResult = v.InferOutput<typeof TcpResult>;
export function tcp(host: string, port: number) {
	return api(TcpResult, '/api/network/tcp', { method: 'POST', body: { host, port } });
}

export const HttpResult = v.looseObject({
	status_code: OptNum,
	rtt_ms: OptNum,
	error: OptStr,
	success: v.optional(v.boolean())
});
export type HttpResult = v.InferOutput<typeof HttpResult>;
export function http(url: string) {
	return api(HttpResult, '/api/network/http', { method: 'POST', body: { url } });
}

const Addresses = v.optional(v.nullable(v.union([v.string(), v.array(v.string())])));
export const ResolveResult = v.pipe(
	v.looseObject({ host: OptStr, addresses: Addresses, address: Addresses, ip: Addresses }),
	v.transform((o) => {
		const a = o.addresses ?? o.address ?? o.ip ?? [];
		return { host: o.host ?? '', addresses: (Array.isArray(a) ? a : [a]).filter(Boolean) };
	})
);
export function resolve(host: string) {
	return api(ResolveResult, '/api/network/resolve', { method: 'POST', body: { host } });
}

export const SslInfo = v.looseObject({
	subject: OptStr,
	issuer: OptStr,
	organization: OptStr,
	validFrom: OptStr,
	validTo: OptStr,
	daysLeft: v.optional(v.nullable(v.union([v.number(), v.string()]))),
	serial: OptStr,
	fingerprint: OptStr,
	altNames: v.optional(v.nullable(v.array(v.string()))),
	protocol: OptStr,
	cipher: v.optional(v.nullable(v.looseObject({ name: OptStr }))),
	authorized: v.optional(v.boolean()),
	chain: v.optional(v.nullable(v.array(v.looseObject({ subject: OptStr, issuer: OptStr }))))
});
export type SslInfo = v.InferOutput<typeof SslInfo>;
export function ssl(host: string, port: number) {
	return post(SslInfo, '/api/toolkit/ssl', { host, port });
}

export const DnsRecords = v.looseObject({
	domain: OptStr,
	dns: v.optional(
		v.looseObject({
			A: v.optional(v.array(v.string())),
			AAAA: v.optional(v.array(v.string())),
			NS: v.optional(v.array(v.string())),
			TXT: v.optional(v.array(v.string())),
			MX: v.optional(v.array(v.looseObject({ exchange: OptStr, priority: OptNum })))
		})
	)
});
export type DnsRecords = v.InferOutput<typeof DnsRecords>;
export function whois(domain: string) {
	return post(DnsRecords, '/api/toolkit/whois', { domain });
}

const WolSent = v.looseObject({ mac: OptStr, broadcast: OptStr });
export function wakeOnLan(mac: string, broadcast: string) {
	return post(WolSent, '/api/toolkit/wol', { mac, broadcast });
}

/* ── Crypto and encoding ── */

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';
export function hash(text: string, algorithm: HashAlgorithm) {
	return post(v.looseObject({ algorithm: OptStr, hash: v.string() }), '/api/toolkit/hash', {
		text,
		algorithm
	});
}

export interface PasswordOptions {
	length: number;
	uppercase: boolean;
	lowercase: boolean;
	digits: boolean;
	symbols: boolean;
}
export const Password = v.looseObject({ password: v.string(), entropy: v.number(), length: OptNum });
export type Password = v.InferOutput<typeof Password>;
export function password(opts: PasswordOptions) {
	return post(Password, '/api/toolkit/password', opts);
}

export const Jwt = v.looseObject({
	header: v.optional(v.unknown()),
	payload: v.optional(v.unknown()),
	expiry: v.optional(v.nullable(v.looseObject({ date: v.unknown(), expired: v.optional(v.boolean()) })))
});
export type Jwt = v.InferOutput<typeof Jwt>;
export function jwtDecode(token: string) {
	return post(Jwt, '/api/toolkit/jwt-decode', { token });
}

export type CodecMode = 'encode' | 'decode';
const Coded = v.looseObject({ result: v.string() });
export function base64(text: string, mode: CodecMode) {
	return post(Coded, '/api/toolkit/base64', { text, mode });
}
export function urlEncode(text: string, mode: CodecMode) {
	return post(Coded, '/api/toolkit/urlencode', { text, mode });
}

/* ── Server ── */

const NumLikeOpt = v.optional(v.nullable(v.union([v.number(), v.string()])));
export const SystemInfo = v.looseObject({
	processes: v.optional(
		v.array(v.looseObject({ name: OptStr, command: OptStr, cpu: NumLikeOpt, mem: NumLikeOpt }))
	),
	disks: v.optional(
		v.array(v.looseObject({ mount: OptStr, name: OptStr, total: NumLikeOpt, used: NumLikeOpt }))
	)
});
export type SystemInfo = v.InferOutput<typeof SystemInfo>;
export function systemInfo() {
	return api(SystemInfo, '/api/system/info');
}

export const DbStats = v.pipe(
	v.looseObject({
		type: OptStr,
		size: v.optional(v.nullable(v.union([v.string(), v.number()]))),
		last_backup: OptStr,
		tables: v.optional(
			v.nullable(
				v.union([
					v.array(v.looseObject({ name: v.string(), count: NumLikeOpt })),
					v.record(v.string(), NumLikeOpt)
				])
			)
		)
	}),
	v.transform((o) => ({
		type: o.type ?? '',
		size: o.size === null || o.size === undefined ? '' : String(o.size),
		last_backup: o.last_backup ?? '',
		tables: Array.isArray(o.tables)
			? o.tables.map((x) => ({ name: x.name, count: Number(x.count) || 0 }))
			: Object.entries(o.tables ?? {}).map(([name, count]) => ({ name, count: Number(count) || 0 }))
	}))
);
export function databaseStats() {
	return api(DbStats, '/api/database/stats');
}

export const Containers = v.looseObject({
	available: v.optional(v.boolean()),
	containers: v.optional(
		v.array(
			v.looseObject({
				name: OptStr,
				names: OptStr,
				image: OptStr,
				state: OptStr,
				status: OptStr,
				ports: OptStr
			})
		)
	)
});
export type Containers = v.InferOutput<typeof Containers>;
export function dockerContainers() {
	return api(Containers, '/api/docker/containers');
}

export type LogSource = 'console' | 'go';
export function recentLogs(source: LogSource, limit: number) {
	return api(v.looseObject({ lines: v.optional(v.array(v.string())) }), '/api/logs/recent', {
		query: { source, limit }
	});
}

/** Download the speed-test payload (binary, so not through api()); resolves the bytes received and the seconds it took */
export async function speedTest(): Promise<{ bytes: number; seconds: number }> {
	const start = performance.now();
	const res = await fetch('/api/speed-test', { credentials: 'same-origin', cache: 'no-store' });
	if (!res.ok) {
		let message = '';
		try {
			const j = (await res.json()) as { error?: unknown };
			message = typeof j.error === 'string' ? j.error : '';
		} catch {
			/* not JSON */
		}
		throw new ApiError(
			res.status === 403
				? clientMessages.permission
				: message || clientMessages.failed.replace('{status}', String(res.status)),
			res.status
		);
	}
	const buf = await res.arrayBuffer();
	return { bytes: buf.byteLength, seconds: (performance.now() - start) / 1000 };
}
