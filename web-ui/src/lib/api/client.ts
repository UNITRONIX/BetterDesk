/**
 * The one way the console talks to the server.
 *
 * - Same-origin paths only.
 * - The CSRF token goes on every request that changes something.
 * - Responses are checked against a schema at the boundary (valibot); a
 *   response that doesn't match is an error, not undefined behaviour later.
 * - 401: the session is gone; go to the login page with a return path.
 * - 403: a plain sentence ("You don't have permission ..."), with the
 *   permission key kept on the error.
 * - Reads (GET) are retried twice on network errors and 502/503/504;
 *   writes never are.
 */

import * as v from 'valibot';

export class ApiError extends Error {
	readonly status: number;
	readonly code: string | null;
	readonly permission: string | null;
	readonly data: unknown;
	constructor(
		message: string,
		status: number,
		opts: { code?: string | null; permission?: string | null; data?: unknown } = {}
	) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = opts.code ?? null;
		this.permission = opts.permission ?? null;
		this.data = opts.data;
	}
	get isPermission(): boolean {
		return this.status === 403;
	}
	get isNetwork(): boolean {
		return this.status === 0;
	}
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
	method?: Method;
	/** JSON body (objects) or FormData for uploads */
	body?: unknown;
	query?: Record<string, string | number | boolean | null | undefined>;
	signal?: AbortSignal;
	/** Don't redirect to the login page on 401 (the login page itself) */
	allowAnonymous?: boolean;
	headers?: Record<string, string>;
}

/** Messages the client itself writes; set from the strings once they load. */
export const clientMessages = {
	permission: "You don't have permission to do this. Ask an administrator.",
	network: 'Could not reach the server. Check your connection and try again.',
	invalid: 'The server sent an answer the console did not expect.',
	failed: 'Request failed (HTTP {status})'
};

let csrfToken = '';
export function setCsrfToken(token: string): void {
	csrfToken = token;
}

type UnauthorizedHandler = (code: string | null) => void;
let onUnauthorized: UnauthorizedHandler = (code) => {
	const here = location.pathname + location.search;
	const qs = new URLSearchParams({ expired: '1', return: here });
	if (code) qs.set('reason', code);
	location.assign('/login?' + qs.toString());
};
export function setUnauthorizedHandler(fn: UnauthorizedHandler): void {
	onUnauthorized = fn;
}

const RETRY_STATUS = new Set([0, 502, 503, 504]);

function safePath(path: string, query?: RequestOptions['query']): string {
	if (!path.startsWith('/') || path.startsWith('//') || /[\0\\]/.test(path)) {
		throw new ApiError('Invalid API path', 0);
	}
	const url = new URL(path, location.origin);
	if (url.origin !== location.origin) throw new ApiError('Invalid API path', 0);
	if (query) {
		for (const [k, val] of Object.entries(query)) {
			if (val !== undefined && val !== null && val !== '') url.searchParams.set(k, String(val));
		}
	}
	return url.pathname + url.search;
}

function errorMessage(
	status: number,
	data: unknown
): { message: string; code: string | null; permission: string | null } {
	const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
	let message =
		obj && typeof obj.error === 'string'
			? obj.error
			: obj && typeof obj.message === 'string'
				? obj.message
				: '';
	const code = obj && typeof obj.code === 'string' ? obj.code : null;
	let permission: string | null = null;
	if (status === 403 && (!message || /^Permission denied\b/i.test(message))) {
		const m = message.match(/^Permission denied:\s*(.+)$/i);
		permission = m?.[1]?.trim() ?? null;
		message = clientMessages.permission;
	}
	if (!message) message = clientMessages.failed.replace('{status}', String(status));
	return { message, code, permission };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Raw request: returns parsed JSON (or text) of a 2xx response, throws ApiError otherwise. */
export async function request(path: string, opts: RequestOptions = {}): Promise<unknown> {
	const method = opts.method ?? 'GET';
	const url = safePath(path, opts.query);
	const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
	let body: BodyInit | undefined;
	if (method !== 'GET') {
		if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
		if (opts.body instanceof FormData) body = opts.body;
		else if (opts.body !== undefined) {
			headers['Content-Type'] = 'application/json';
			body = JSON.stringify(opts.body);
		} else if (method !== 'DELETE') {
			// Express rejects POST/PUT/PATCH to /api without a JSON content type
			headers['Content-Type'] = 'application/json';
			body = '{}';
		}
	}
	const attempts = method === 'GET' ? 3 : 1;
	let last: ApiError | null = null;
	for (let i = 0; i < attempts; i++) {
		if (i > 0) await sleep(300 * 2 ** (i - 1));
		let res: Response;
		try {
			res = await fetch(url, {
				method,
				headers,
				body,
				credentials: 'same-origin',
				signal: opts.signal ?? null
			});
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') throw err;
			last = new ApiError(clientMessages.network, 0);
			continue;
		}
		// Some /api routers answer a missing session with a redirect to the
		// login page (BUGS.md A1); fetch follows it and gets HTML with 200.
		if (res.redirected && new URL(res.url).pathname === '/login') {
			last = new ApiError(clientMessages.network, 401, { code: 'session_required' });
			if (!opts.allowAnonymous) onUnauthorized('session_required');
			throw last;
		}
		const type = res.headers.get('content-type') ?? '';
		let data: unknown;
		try {
			data = type.includes('application/json') ? await res.json() : await res.text();
		} catch {
			data = null;
		}
		if (res.ok) return data;
		const { message, code, permission } = errorMessage(res.status, data);
		last = new ApiError(message, res.status, { code, permission, data });
		if (res.status === 401 && !opts.allowAnonymous) {
			onUnauthorized(code);
			throw last;
		}
		if (!RETRY_STATUS.has(res.status)) throw last;
	}
	throw last ?? new ApiError(clientMessages.network, 0);
}

/** Request and check the response against a schema. */
export async function api<S extends v.GenericSchema>(
	schema: S,
	path: string,
	opts: RequestOptions = {}
): Promise<v.InferOutput<S>> {
	const data = await request(path, opts);
	const parsed = v.safeParse(schema, data);
	if (!parsed.success) {
		const where = parsed.issues[0] ? v.getDotPath(parsed.issues[0]) : '';
		console.error('Unexpected response', method(opts), path, where, parsed.issues[0]?.message);
		throw new ApiError(clientMessages.invalid, 200, { code: 'invalid_response', data });
	}
	return parsed.output;
}

function method(opts: RequestOptions): string {
	return opts.method ?? 'GET';
}

/** `{ success: true, ... }` responses that carry nothing else the UI reads */
export const Ok = v.looseObject({ success: v.optional(v.boolean()) });

/**
 * Many endpoints answer `{ success: true, data: X }`. Unwrap X and check it.
 */
export function wrapped<S extends v.GenericSchema>(inner: S): v.GenericSchema<unknown, v.InferOutput<S>> {
	return v.pipe(
		v.looseObject({ success: v.optional(v.boolean()), data: inner }),
		v.transform((o) => o.data as v.InferOutput<S>)
	);
}

/** A value the server writes as a number or a numeric string */
export const NumLike = v.pipe(
	v.union([v.number(), v.pipe(v.string(), v.transform(Number))]),
	v.check((n) => Number.isFinite(n))
);
/** Text the server may send as null or a number */
export const Text = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()]))),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);
/** SQLite booleans: true/false, 1/0, "1"/"0" */
export const BoolLike = v.pipe(
	v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()]))),
	v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
);
