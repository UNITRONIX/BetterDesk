/**
 * The IoT device's video, audio and file sockets, as cdap-video.js,
 * cdap-audio.js and cdap-filebrowser.js spoke them. The desktop has its own
 * module (desktop.ts); the terminal is the Terminal component with
 * cdapAdapter() from ui/terminal.ts.
 *
 *   video  /api/cdap/devices/:id/video  cdap-video
 *     out: { stream_id, quality: 60, fps: 10 }, codec_offer on ready,
 *          quality_report every 5 s, close
 *     in:  ready, frame { data (base64), format, width, height }, error, end
 *   audio  /api/cdap/devices/:id/audio  cdap-audio
 *     out: { codec: 'opus', sample_rate: 48000, channels: 1, direction: 'receive' }, close
 *     in:  ready, audio_frame { data (base64), codec }, error, end
 *     (the page only listens; the microphone is never asked for)
 *   files  /api/cdap/devices/:id/files  cdap-filebrowser
 *     out: file_list { path }, file_read { path, request_id },
 *          file_write { path, data (base64) }, file_delete { path }, close
 *     in:  ready, file_list_response { entries }, file_read_response
 *          { request_id, data, error }, file_write_response and
 *          file_delete_response { error }, error, end
 */

import { socketUrl } from '#lib/ui/terminal.ts';
import { qualityReport, type Counters, type StreamState, QUALITY_MS } from './desktop.ts';
import { joinPath, parentPath, readEntries, type FileEntry } from './model.ts';

export type { StreamState };

export type SocketFactory = (url: string, protocols: string[]) => WebSocket;
const defaultFactory: SocketFactory = (u, p) => new WebSocket(u, p);

export function cdapSocketPath(
	deviceId: string,
	channel: 'terminal' | 'desktop' | 'video' | 'files' | 'audio'
): string {
	return `/api/cdap/devices/${encodeURIComponent(deviceId)}/${channel}`;
}

export function cdapSocketUrl(deviceId: string, channel: Parameters<typeof cdapSocketPath>[1]): string {
	return socketUrl(cdapSocketPath(deviceId, channel));
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function parse(data: unknown): Record<string, unknown> | null {
	if (typeof data !== 'string') return null;
	try {
		const m: unknown = JSON.parse(data);
		return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** A socket with an open message, a message handler and one end */
abstract class Channel {
	protected ws: WebSocket | null = null;
	protected done = false;
	protected opened = false;
	constructor(
		protected url: string,
		protected protocol: string,
		protected onstate: (s: StreamState, message?: string) => void,
		protected create: SocketFactory = defaultFactory
	) {}

	open(): void {
		this.onstate('connecting');
		let ws: WebSocket;
		try {
			ws = this.create(this.url, [this.protocol]);
		} catch {
			this.end('error');
			return;
		}
		this.ws = ws;
		ws.onopen = () => {
			this.opened = true;
			this.hello();
		};
		ws.onmessage = (e: MessageEvent) => {
			const m = parse(e.data);
			if (m) this.message(m);
		};
		ws.onclose = () => this.end(this.isReady() ? 'closed' : 'error');
	}

	send(payload: unknown): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
	}

	close(): void {
		if (this.done) return;
		this.send({ type: 'close' });
		this.end('closed');
	}

	protected end(state: 'closed' | 'error', message?: string): void {
		if (this.done) return;
		this.done = true;
		this.stop();
		const ws = this.ws;
		this.ws = null;
		if (ws) {
			ws.onopen = ws.onmessage = ws.onclose = null;
			if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
				try {
					ws.close();
				} catch {
					/* closed */
				}
			}
		}
		this.onstate(state, message);
	}

	protected abstract hello(): void;
	protected abstract message(m: Record<string, unknown>): void;
	protected abstract isReady(): boolean;
	protected stop(): void {}
}

/* ── Video ── */

export class VideoSession extends Channel {
	#ctx: CanvasRenderingContext2D | null;
	#sessionId = '';
	#ready = false;
	#img: HTMLImageElement | null = null;
	#counters: Counters = { frames: 0, bytes: 0, dropped: 0, time: 0 };
	#prev: Counters = { frames: 0, bytes: 0, dropped: 0, time: 0 };
	#lastFrameAt = 0;
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		url: string,
		private widgetId: string,
		private canvas: HTMLCanvasElement,
		onstate: (s: StreamState, message?: string) => void,
		create?: SocketFactory
	) {
		super(url, 'cdap-video', onstate, create);
		this.#ctx = canvas.getContext('2d');
	}

	protected isReady(): boolean {
		return this.#ready;
	}

	protected hello(): void {
		this.send({ stream_id: this.widgetId, quality: 60, fps: 10 });
	}

	protected message(m: Record<string, unknown>): void {
		if (m.type === 'ready') {
			this.#sessionId = typeof m.session_id === 'string' ? m.session_id : '';
			this.#ready = true;
			this.onstate('open');
			this.#prev = { ...this.#counters, time: Date.now() };
			this.#timer = setInterval(() => {
				const now = { ...this.#counters, time: Date.now() };
				const r = qualityReport(this.#sessionId, this.#prev, now, this.#lastFrameAt);
				if (r && this.#sessionId) this.send(r);
				this.#prev = now;
			}, QUALITY_MS);
			this.send({
				type: 'codec_offer',
				session_id: this.#sessionId,
				video: ['jpeg', 'png'],
				audio: [],
				preferred: 'jpeg'
			});
		} else if (m.type === 'frame') {
			const data = typeof m.data === 'string' ? m.data : '';
			if (!data || !BASE64.test(data)) return;
			const fmt = m.format === 'png' || m.format === 'webp' ? m.format : 'jpeg';
			this.#counters.frames++;
			this.#counters.bytes += data.length * 0.75;
			this.#lastFrameAt = Date.now();
			const w = Number(m.width);
			const h = Number(m.height);
			if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
				this.canvas.width = w;
				this.canvas.height = h;
			}
			const img = (this.#img ??= new Image());
			img.onload = () => this.#ctx?.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
			img.onerror = () => this.#counters.dropped++;
			img.src = `data:image/${fmt};base64,${data}`;
		} else if (m.type === 'error') {
			if (!this.#ready) this.end('error', typeof m.error === 'string' ? m.error : undefined);
		} else if (m.type === 'end') {
			this.close();
		}
	}

	protected override stop(): void {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}
}

/* ── Audio ── */

export function base64Bytes(data: string): Uint8Array | null {
	if (!BASE64.test(data)) return null;
	try {
		const raw = atob(data);
		const out = new Uint8Array(raw.length);
		for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

/** 16-bit signed little-endian PCM, interleaved, to one float array per channel */
export function pcmToFloat(bytes: Uint8Array, channels: number): Float32Array[] {
	const frames = Math.floor(bytes.length / 2 / channels);
	const out = Array.from({ length: channels }, () => new Float32Array(Math.max(0, frames)));
	out.forEach((samples, ch) => {
		for (let i = 0; i < frames; i++) {
			const idx = (i * channels + ch) * 2;
			const s = (bytes[idx] ?? 0) | ((bytes[idx + 1] ?? 0) << 8);
			samples[i] = (s > 32767 ? s - 65536 : s) / 32768;
		}
	});
	return out;
}

/** Root mean square of the samples, 0..1 */
export function rms(samples: Float32Array): number {
	if (!samples.length) return 0;
	let sum = 0;
	for (const v of samples) sum += v * v;
	return Math.sqrt(sum / samples.length);
}

export const AUDIO = { codec: 'opus', sampleRate: 48000, channels: 1 } as const;

export class AudioSession extends Channel {
	#ready = false;
	#ctx: AudioContext | null = null;
	#gain: GainNode | null = null;
	#muted = false;
	/** The loudness of the last frame, 0..1 */
	level = 0;

	constructor(url: string, onstate: (s: StreamState, message?: string) => void, create?: SocketFactory) {
		super(url, 'cdap-audio', onstate, create);
	}

	/** Called from the Connect click, so the browser lets the sound play */
	override open(): void {
		try {
			this.#ctx = new AudioContext({ sampleRate: AUDIO.sampleRate });
			this.#gain = this.#ctx.createGain();
			this.#gain.connect(this.#ctx.destination);
			void this.#ctx.resume().catch(() => undefined);
		} catch {
			this.#ctx = null;
		}
		super.open();
	}

	get muted(): boolean {
		return this.#muted;
	}

	setMuted(m: boolean): void {
		this.#muted = m;
		if (this.#gain) this.#gain.gain.value = m ? 0 : 1;
	}

	protected isReady(): boolean {
		return this.#ready;
	}

	protected hello(): void {
		this.send({
			codec: AUDIO.codec,
			sample_rate: AUDIO.sampleRate,
			channels: AUDIO.channels,
			direction: 'receive'
		});
	}

	protected message(m: Record<string, unknown>): void {
		if (m.type === 'ready') {
			this.#ready = true;
			this.onstate('open');
		} else if (m.type === 'audio_frame') {
			const bytes = typeof m.data === 'string' ? base64Bytes(m.data) : null;
			if (!bytes || !this.#ctx) return;
			if (m.codec === 'pcm') this.#pcm(bytes);
			else {
				const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
				this.#ctx
					.decodeAudioData(buf)
					.then((ab) => this.#play(ab))
					.catch(() => this.#pcm(bytes));
			}
		} else if (m.type === 'error') {
			if (!this.#ready) this.end('error', typeof m.error === 'string' ? m.error : undefined);
		} else if (m.type === 'end') {
			this.close();
		}
	}

	#pcm(bytes: Uint8Array): void {
		const ctx = this.#ctx;
		if (!ctx) return;
		const chans = pcmToFloat(bytes, AUDIO.channels);
		const first = chans[0];
		const n = first?.length ?? 0;
		if (!first || !n) return;
		const ab = ctx.createBuffer(AUDIO.channels, n, AUDIO.sampleRate);
		chans.forEach((c, i) => ab.copyToChannel(c as Float32Array<ArrayBuffer>, i));
		this.level = rms(first);
		this.#play(ab);
	}

	#play(ab: AudioBuffer): void {
		if (!this.#ctx || !this.#gain || this.#muted) return;
		const src = this.#ctx.createBufferSource();
		src.buffer = ab;
		src.connect(this.#gain);
		src.start();
	}

	protected override stop(): void {
		this.level = 0;
		if (this.#ctx && this.#ctx.state !== 'closed') void this.#ctx.close().catch(() => undefined);
		this.#ctx = null;
		this.#gain = null;
	}
}

/* ── Files ── */

export interface FileEvents {
	onlist(path: string, entries: FileEntry[]): void;
	onloading(path: string): void;
	onerror(message: string): void;
	ondownload(name: string, bytes: Uint8Array): void;
}

export class FileSession extends Channel {
	path = '/';
	#ready = false;
	#pending = new Map<string, string>();
	#seq = 0;

	constructor(
		url: string,
		onstate: (s: StreamState, message?: string) => void,
		private events: FileEvents,
		private locale?: string,
		create?: SocketFactory
	) {
		super(url, 'cdap-filebrowser', onstate, create);
	}

	protected isReady(): boolean {
		return this.#ready;
	}

	protected hello(): void {
		// The gateway takes requests as soon as the socket is open
		this.#ready = true;
		this.onstate('open');
		this.list('/');
	}

	list(path: string): void {
		if (!this.#ready) return;
		this.path = path || '/';
		this.events.onloading(this.path);
		this.send({ type: 'file_list', path: this.path });
	}

	/** Open a folder in the current one */
	enter(name: string): void {
		this.list(joinPath(this.path, name));
	}

	up(): void {
		this.list(parentPath(this.path));
	}

	download(name: string): void {
		const id = `dl_${Date.now()}_${++this.#seq}`;
		this.#pending.set(id, name);
		this.send({ type: 'file_read', path: joinPath(this.path, name), request_id: id });
	}

	upload(name: string, base64: string): void {
		this.send({ type: 'file_write', path: joinPath(this.path, name), data: base64 });
	}

	remove(name: string): void {
		this.send({ type: 'file_delete', path: joinPath(this.path, name) });
	}

	protected message(m: Record<string, unknown>): void {
		switch (m.type) {
			case 'ready':
				break;
			case 'file_list_response':
				this.events.onlist(this.path, readEntries(m.entries, this.locale));
				break;
			case 'file_read_response': {
				const id = typeof m.request_id === 'string' ? m.request_id : '';
				const name = this.#pending.get(id);
				if (name === undefined) return;
				this.#pending.delete(id);
				if (typeof m.error === 'string' && m.error) this.events.onerror(m.error);
				else if (typeof m.data === 'string') {
					const bytes = base64Bytes(m.data);
					if (bytes) this.events.ondownload(name, bytes);
				}
				break;
			}
			case 'file_write_response':
			case 'file_delete_response':
				if (typeof m.error === 'string' && m.error) this.events.onerror(m.error);
				this.list(this.path);
				break;
			case 'error':
				this.events.onerror(typeof m.error === 'string' ? m.error : '');
				break;
			case 'end':
				this.close();
				break;
		}
	}
}
