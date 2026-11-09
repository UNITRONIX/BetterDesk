/**
 * Server management (routes/server-management.routes.js): the machine that
 * runs the console, its files and BetterDesk's system services. Every call
 * needs server.config. The terminal is a WebSocket
 * (/ws/server-management/terminal, ui/terminal.ts shellAdapter).
 *
 * These routes answer `{ success: true, ...fields }` without a data
 * envelope; errors are `{ success: false, error }` with 400 or 500.
 */

import * as v from 'valibot';
import { api, Ok } from './client.ts';

/* Fields that are always there in the output, whatever the server leaves out */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null ? '' : String(s)))
);
const Bool = v.pipe(
	v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), false),
	v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
);

const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), null),
	v.transform((n) => (n === null || n === undefined || n === '' ? null : Number(n))),
	v.transform((n) => (n === null || Number.isFinite(n) ? n : null))
);

const Strings = v.pipe(
	v.optional(v.nullable(v.array(v.unknown())), []),
	v.transform((a) => (a ?? []).filter((x): x is string => typeof x === 'string'))
);

/* ── Info and resources ── */

export const ServerInfo = v.looseObject({
	platform: Str,
	arch: Str,
	nodeVersion: Str,
	pid: Num,
	ptyAvailable: Bool,
	fileRoots: Strings,
	/** Folders where files can be changed; null when the server does not say */
	mutableFileRoots: v.optional(v.nullable(v.array(v.string())), null),
	/** The BetterDesk (Go) server; null when it did not answer */
	server: v.optional(
		v.nullable(
			v.looseObject({
				running: Bool,
				uptimeSeconds: Num,
				version: v.optional(v.nullable(v.string()), null)
			})
		),
		null
	)
});
export type ServerInfo = v.InferOutput<typeof ServerInfo>;

export function getServerInfo(signal?: AbortSignal) {
	return api(ServerInfo, '/api/server-management/info', { signal });
}

const Sample = v.looseObject({ ts: v.number(), cpu: Num, mem: Num });
export type Sample = v.InferOutput<typeof Sample>;

const Disk = v.looseObject({ mount: Str, fs: Str, size: Num, total: Num, used: Num });
export type Disk = v.InferOutput<typeof Disk>;

export const Snapshot = v.looseObject({
	cpu: Num,
	mem: v.optional(v.looseObject({ total: Num, used: Num, percent: Num }), {}),
	load: v.optional(v.array(v.union([v.number(), v.string()])), []),
	uptime: Num,
	nodeUptime: Num,
	cpuCount: Num,
	cpuModel: Str,
	platform: Str,
	arch: Str,
	hostname: Str,
	release: Str,
	osVersion: Str,
	nodeVersion: Str,
	disks: v.optional(v.array(Disk), []),
	history: v.optional(v.array(Sample), [])
});
export type Snapshot = v.InferOutput<typeof Snapshot>;

export async function getResources(signal?: AbortSignal): Promise<Snapshot> {
	const out = await api(v.looseObject({ snapshot: Snapshot }), '/api/server-management/resources', {
		signal
	});
	return out.snapshot;
}

/** One of the two BetterDesk servers in GET /api/server/status */
const ServerPart = v.optional(
	v.nullable(v.looseObject({ status: v.optional(v.string()), online: v.optional(v.boolean()) })),
	null
);
export type ServerPart = v.InferOutput<typeof ServerPart>;

const ServerStatus = v.pipe(
	v.looseObject({
		data: v.optional(v.looseObject({ hbbs: ServerPart, hbbr: ServerPart })),
		hbbs: ServerPart,
		hbbr: ServerPart
	}),
	v.transform((o) => ({ hbbs: o.data?.hbbs ?? o.hbbs, hbbr: o.data?.hbbr ?? o.hbbr }))
);

/** Whether the ID server (hbbs) and the relay server (hbbr) run */
export function getServerStatus(signal?: AbortSignal) {
	return api(ServerStatus, '/api/server/status', { signal });
}

/* ── Files ── */

export const FileEntry = v.looseObject({
	name: Str,
	path: Str,
	type: v.optional(v.picklist(['dir', 'file', 'symlink'])),
	isDirectory: Bool,
	isSymlink: Bool,
	size: Num,
	mtime: v.optional(v.unknown()),
	mode: Num
});
export type FileEntry = v.InferOutput<typeof FileEntry>;

const Listing = v.pipe(
	v.looseObject({
		cwd: Str,
		path: Str,
		entries: v.optional(v.array(FileEntry)),
		items: v.optional(v.array(FileEntry))
	}),
	v.transform((o) => ({ cwd: o.cwd || o.path, entries: o.entries ?? o.items ?? [] }))
);
export type Listing = v.InferOutput<typeof Listing>;

const enc = encodeURIComponent;

export function listFiles(path: string, signal?: AbortSignal) {
	return api(Listing, '/api/server-management/files', { query: { path }, signal });
}

export const FileContent = v.looseObject({
	path: Str,
	size: Num,
	isBinary: Bool,
	binary: Bool,
	truncated: Bool,
	content: Str
});
export type FileContent = v.InferOutput<typeof FileContent>;

export function readFile(path: string) {
	return api(FileContent, '/api/server-management/files/read', { query: { path } });
}

export function writeFile(path: string, content: string) {
	return api(Ok, '/api/server-management/files/write', { method: 'POST', body: { path, content } });
}

export function makeFolder(path: string) {
	return api(Ok, '/api/server-management/files/mkdir', { method: 'POST', body: { path } });
}

export function renamePath(from: string, to: string) {
	return api(Ok, '/api/server-management/files/rename', { method: 'POST', body: { from, to } });
}

export function deletePath(path: string) {
	return api(Ok, '/api/server-management/files/delete', { method: 'POST', body: { path } });
}

/* ── Services ── */

export const Service = v.looseObject({
	name: Str,
	description: Str,
	state: Str,
	status: Str,
	sub: Str
});
export type Service = v.InferOutput<typeof Service>;

const ServiceList = v.looseObject({ platform: Str, services: v.optional(v.array(Service), []) });

export function listServices(signal?: AbortSignal) {
	return api(ServiceList, '/api/server-management/services', { signal });
}

export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable';

const ActionResult = v.looseObject({ exitCode: v.optional(v.nullable(v.number())) });

export function controlService(name: string, action: ServiceAction) {
	return api(ActionResult, `/api/server-management/services/${enc(name)}/${action}`, { method: 'POST' });
}
