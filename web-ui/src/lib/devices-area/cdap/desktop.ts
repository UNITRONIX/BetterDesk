/**
 * The desktop of an IoT device (/api/cdap/devices/:id/desktop, subprotocol
 * cdap-desktop), as cdap-desktop.js spoke it.
 *
 * Out: the init message (size, quality 75, 30 fps, pixel ratio, the codecs
 * this browser decodes), presence_ping every 15 s (the gateway drops a
 * session after 30 s without one), quality_report every 5 s once ready,
 * codec_offer on ready, keyframe_request when a decoder needs an IDR,
 * monitor_select, input (mouse as a RustDesk mask, wheel, keyboard, text),
 * clipboard_set on paste, close.
 * In: binary frames (JPEG or WebP, or a 1-byte keyframe flag plus an H.264,
 * VP9 or AV1 access unit, following the last desktop_meta), and JSON ready,
 * frame (base64, older agents), desktop_meta, cursor_update,
 * clipboard_update, codec_answer, monitor_list, quality_adjust, error, end.
 *
 * The device's clipboard is never written into the operator's clipboard on
 * its own (BUGS.md U5): `onclipboard` hands the text to the page, which
 * offers a Copy button.
 *
 * Video codecs decode with WebCodecs where the browser has it (a secure
 * context). Elsewhere H.264 can still decode through Media Source
 * Extensions with the remote viewer's own self-hosted helpers
 * (/js/vendor/jmuxer.min.js and /js/rdclient/video.js), loaded only then.
 */

export type StreamState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface Monitor {
	index: number;
	name: string;
	width: number;
	height: number;
	primary: boolean;
}

export interface DesktopEvents {
	onstate(state: StreamState, message?: string): void;
	onmonitors?(monitors: Monitor[], active: number): void;
	onclipboard?(text: string): void;
	oncursor?(css: string): void;
}

export interface CodecEnv {
	/** WebCodecs VideoDecoder in a secure context */
	videoDecoder: boolean;
	/** H.264 through MSE (the helpers are loaded) */
	mseH264: boolean;
}

export const QUALITY_MS = 5000;
export const PRESENCE_MS = 15000;
const CURSOR_CACHE = 50;
const DEFAULT_CODEC: Record<string, string> = {
	h264: 'avc1.42E01E',
	vp9: 'vp09.00.10.08',
	av1: 'av01.0.04M.08'
};

/** The codecs to advertise, image codecs always last so a stream works everywhere */
export function decodableCodecs(env: CodecEnv): string[] {
	const list: string[] = [];
	if (env.videoDecoder) list.push('av1', 'vp9', 'h264');
	else if (env.mseH264) list.push('h264');
	list.push('webp', 'jpeg');
	return list;
}

export function isVideoCodec(fmt: string): boolean {
	return fmt === 'h264' || fmt === 'vp9' || fmt === 'av1';
}

/* ── Input ── */

export const MOUSE = { move: 0, down: 1, up: 2, wheel: 3 } as const;

/** RustDesk's mask: the event type in the low 3 bits, the button above them */
export function mouseMask(type: number, button: number): number {
	const bits = button === 0 ? 1 : button === 2 ? 2 : button === 1 ? 4 : 0;
	return type | (bits << 3);
}

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/**
 * The device pixel under the pointer. The canvas is drawn with object-fit:
 * contain, so the picture may sit in a letterbox; points outside it go to
 * the nearest edge.
 */
export function canvasPoint(
	clientX: number,
	clientY: number,
	rect: Rect,
	width: number,
	height: number
): { x: number; y: number } {
	if (!(rect.width > 0 && rect.height > 0 && width > 0 && height > 0)) return { x: 0, y: 0 };
	const scale = Math.min(rect.width / width, rect.height / height);
	const offX = (rect.width - width * scale) / 2;
	const offY = (rect.height - height * scale) / 2;
	const x = Math.round((clientX - rect.left - offX) / scale);
	const y = Math.round((clientY - rect.top - offY) / scale);
	return { x: Math.min(width - 1, Math.max(0, x)), y: Math.min(height - 1, Math.max(0, y)) };
}

/** One wheel step: -1, 0 or 1 per axis; Shift turns a vertical wheel sideways */
export function wheelStep(dx: number, dy: number, shift: boolean): { deltaX: number; deltaY: number } {
	let x = dx;
	let y = dy;
	if (shift && y !== 0 && x === 0) {
		x = y;
		y = 0;
	}
	if (Math.abs(x) > Math.abs(y)) return { deltaX: x > 0 ? -1 : 1, deltaY: 0 };
	if (y !== 0) return { deltaX: 0, deltaY: y > 0 ? -1 : 1 };
	return { deltaX: 0, deltaY: 0 };
}

export interface KeyLike {
	key: string;
	code: string;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
}

/**
 * What a key sends: a printable character that is not an ASCII letter or
 * digit goes as text on keydown (the device's layout puts it in; "ą", "@",
 * "€"), everything else as a key with its modifiers.
 */
export function keyMessage(e: KeyLike, down: boolean): Record<string, unknown> {
	if (down && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
		const cc = e.key.charCodeAt(0);
		const printable = cc >= 0x20 && cc !== 0x7f;
		const alnum = (cc >= 0x30 && cc <= 0x39) || (cc >= 0x41 && cc <= 0x5a) || (cc >= 0x61 && cc <= 0x7a);
		if (printable && !alnum) return { type: 'input', input_type: 'text', text: e.key };
	}
	return {
		type: 'input',
		input_type: 'keyboard',
		key: e.key,
		code: e.code,
		modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
		down
	};
}

/* ── Quality ── */

export interface Counters {
	frames: number;
	bytes: number;
	dropped: number;
	time: number;
}

export function qualityReport(
	sessionId: string,
	prev: Counters,
	now: Counters,
	lastFrameAt: number
): Record<string, unknown> | null {
	const elapsed = (now.time - prev.time) / 1000;
	if (elapsed <= 0) return null;
	const frames = now.frames - prev.frames;
	const dropped = now.dropped - prev.dropped;
	return {
		type: 'quality_report',
		session_id: sessionId,
		bandwidth_kb: Math.round(((now.bytes - prev.bytes) / 1024 / elapsed) * 10) / 10,
		latency_ms: lastFrameAt > 0 ? Math.max(0, now.time - lastFrameAt) : 0,
		frame_loss: frames > 0 ? Math.round((dropped / (frames + dropped)) * 1000) / 1000 : 0,
		fps: Math.round(frames / elapsed)
	};
}

/* ── Cursor ── */

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * A CSS cursor from the device's cursor image. The image data goes into a
 * url() only after it passed a strict base64 check, so it can't end the
 * value or point somewhere else.
 */
export function cursorCss(
	msg: Record<string, unknown>,
	rgbaToPng?: (data: string, w: number, h: number) => string | null
): string | null {
	if (msg.hidden === true) return 'none';
	const data = typeof msg.data === 'string' ? msg.data : '';
	const w = Number(msg.width);
	const h = Number(msg.height);
	if (!data || !(w > 0 && h > 0) || w > 256 || h > 256 || !BASE64.test(data)) return null;
	const hx = Math.min(w - 1, Math.max(0, Math.round(Number(msg.hotspot_x) || 0)));
	const hy = Math.min(h - 1, Math.max(0, Math.round(Number(msg.hotspot_y) || 0)));
	const format = msg.format === 'rgba' ? 'rgba' : 'png';
	let url: string | null = `data:image/png;base64,${data}`;
	if (format === 'rgba') url = rgbaToPng ? rgbaToPng(data, w, h) : null;
	if (!url) return null;
	return `url("${url}") ${hx} ${hy}, auto`;
}

function rgbaToPng(data: string, w: number, h: number): string | null {
	try {
		const raw = atob(data);
		if (raw.length !== w * h * 4) return null;
		const bytes = new Uint8ClampedArray(raw.length);
		for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		c.getContext('2d')?.putImageData(new ImageData(bytes, w, h), 0, 0);
		return c.toDataURL('image/png');
	} catch {
		return null;
	}
}

/* ── MSE helpers (the remote viewer's own files) ── */

interface RDVideoLike {
	initialized: boolean;
	onFrame:
		| ((
				frame: CanvasImageSource & {
					close?: () => void;
					displayWidth?: number;
					displayHeight?: number;
					_source?: CanvasImageSource;
				}
		  ) => void)
		| null;
	onError: ((err: unknown) => void) | null;
	init(codec: string): Promise<void>;
	decode(chunk: { data: Uint8Array; key: boolean; codec: string }): void;
	close(): void;
}
type RDVideoCtor = new () => RDVideoLike;

let mseLoad: Promise<boolean> | null = null;

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = src;
		s.async = false;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error(src));
		document.head.appendChild(s);
	});
}

/** Whether this browser can only decode H.264 through MSE, and the helpers loaded */
export function loadMseH264(): Promise<boolean> {
	if (mseLoad) return mseLoad;
	const w = window as unknown as { RDVideo?: RDVideoCtor; MediaSource?: typeof MediaSource };
	const supported =
		typeof w.MediaSource !== 'undefined' &&
		typeof MediaSource.isTypeSupported === 'function' &&
		MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
	if (!supported) return (mseLoad = Promise.resolve(false));
	if (w.RDVideo) return (mseLoad = Promise.resolve(true));
	mseLoad = loadScript('/js/vendor/jmuxer.min.js')
		.then(() => loadScript('/js/rdclient/video.js'))
		.then(() => typeof (window as unknown as { RDVideo?: RDVideoCtor }).RDVideo === 'function')
		.catch(() => false);
	return mseLoad;
}

export function hasVideoDecoder(): boolean {
	return (
		typeof window !== 'undefined' && window.isSecureContext && typeof window.VideoDecoder !== 'undefined'
	);
}

/* ── The session ── */

export interface DesktopOptions {
	url: string;
	canvas: HTMLCanvasElement;
	events: DesktopEvents;
	env: CodecEnv;
	/** For tests */
	createSocket?: (url: string, protocols: string[]) => WebSocket;
}

export class DesktopSession {
	#ws: WebSocket | null = null;
	#o: DesktopOptions;
	#ctx: CanvasRenderingContext2D | null;
	#sessionId = '';
	#connected = false;
	#closed = false;
	#format = 'jpeg';
	#codecString = '';
	#decoder: VideoDecoder | null = null;
	#decoderFormat = '';
	#mse: RDVideoLike | null = null;
	#gotKey = false;
	#keyAsked = false;
	#busy = false;
	#counters: Counters = { frames: 0, bytes: 0, dropped: 0, time: 0 };
	#prev: Counters = { frames: 0, bytes: 0, dropped: 0, time: 0 };
	#lastFrameAt = 0;
	#quality: ReturnType<typeof setInterval> | null = null;
	#presence: ReturnType<typeof setInterval> | null = null;
	#cursors = new Map<string, string>();
	#img: HTMLImageElement | null = null;

	constructor(o: DesktopOptions) {
		this.#o = o;
		this.#ctx = o.canvas.getContext('2d');
	}

	get connected(): boolean {
		return this.#connected;
	}

	open(): void {
		const create = this.#o.createSocket ?? ((u: string, p: string[]) => new WebSocket(u, p));
		this.#o.events.onstate('connecting');
		let ws: WebSocket;
		try {
			ws = create(this.#o.url, ['cdap-desktop']);
		} catch {
			this.#o.events.onstate('error');
			return;
		}
		ws.binaryType = 'arraybuffer';
		this.#ws = ws;
		ws.onopen = () => {
			const rect = this.#o.canvas.getBoundingClientRect();
			this.#send({
				width: (typeof screen !== 'undefined' && screen.width) || 1920,
				height: (typeof screen !== 'undefined' && screen.height) || 1080,
				quality: 75,
				fps: 30,
				device_pixel_ratio: window.devicePixelRatio || 1,
				client_css_width: Math.round(rect.width || 0),
				client_css_height: Math.round(rect.height || 0),
				webcodecs: this.#o.env.videoDecoder,
				codecs: decodableCodecs(this.#o.env),
				video_codec: 'auto'
			});
			this.#presence = setInterval(() => this.#send({ type: 'presence_ping', ts: Date.now() }), PRESENCE_MS);
		};
		ws.onmessage = (e: MessageEvent) => {
			if (e.data instanceof ArrayBuffer) {
				this.#binary(e.data);
				return;
			}
			if (typeof e.data !== 'string') return;
			let msg: unknown;
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg && typeof msg === 'object') this.#message(msg as Record<string, unknown>);
		};
		ws.onerror = () => {
			if (!this.#connected) this.#o.events.onstate('error');
		};
		ws.onclose = () => this.#ended(this.#connected ? 'closed' : 'error');
	}

	close(reason?: string): void {
		if (this.#closed) return;
		const ws = this.#ws;
		if (ws && ws.readyState === WebSocket.OPEN) {
			this.#send(reason ? { type: 'close', reason } : { type: 'close' });
			try {
				ws.close(reason === 'tab_closed' ? 1001 : 1000, reason ?? 'client_close');
			} catch {
				/* closed already */
			}
		}
		this.#ended('closed');
	}

	mouse(e: { clientX: number; clientY: number; button: number }, type: number): void {
		if (!this.#connected) return;
		const c = this.#o.canvas;
		const p = canvasPoint(e.clientX, e.clientY, c.getBoundingClientRect(), c.width, c.height);
		this.#send({ type: 'input', input_type: 'mouse', x: p.x, y: p.y, button: mouseMask(type, e.button) });
	}

	wheel(e: { clientX: number; clientY: number; deltaX: number; deltaY: number; shiftKey: boolean }): boolean {
		if (!this.#connected) return false;
		const step = wheelStep(e.deltaX, e.deltaY, e.shiftKey);
		if (!step.deltaX && !step.deltaY) return false;
		const c = this.#o.canvas;
		const p = canvasPoint(e.clientX, e.clientY, c.getBoundingClientRect(), c.width, c.height);
		this.#send({ type: 'input', input_type: 'mouse', x: p.x, y: p.y, ...step, button: MOUSE.wheel });
		return true;
	}

	key(e: KeyLike, down: boolean): void {
		if (!this.#connected) return;
		this.#send(keyMessage(e, down));
	}

	/** Text the operator pasted into the desktop */
	paste(text: string): void {
		if (!this.#connected || !text) return;
		this.#send({ type: 'clipboard_set', format: 'text', data: text });
	}

	selectMonitor(index: number): void {
		if (!this.#connected || !this.#sessionId) return;
		this.#send({ type: 'monitor_select', session_id: this.#sessionId, index });
	}

	#send(payload: unknown): void {
		const ws = this.#ws;
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
	}

	#message(msg: Record<string, unknown>): void {
		switch (msg.type) {
			case 'ready': {
				this.#sessionId = typeof msg.session_id === 'string' ? msg.session_id : '';
				this.#connected = true;
				this.#o.events.onstate('open');
				this.#prev = { ...this.#counters, time: Date.now() };
				this.#quality = setInterval(() => this.#report(), QUALITY_MS);
				const video = decodableCodecs(this.#o.env);
				this.#send({
					type: 'codec_offer',
					session_id: this.#sessionId,
					video,
					audio: ['opus', 'pcm'],
					preferred: video[0] ?? 'jpeg'
				});
				break;
			}
			case 'frame':
				this.#base64Frame(msg);
				break;
			case 'desktop_meta': {
				const w = Number(msg.width);
				const h = Number(msg.height);
				if (w > 0 && h > 0) this.#resize(w, h);
				const fmt = String(msg.format || 'jpeg').toLowerCase();
				const codec = typeof msg.codec_string === 'string' ? msg.codec_string : '';
				if (fmt !== this.#format) {
					this.#format = fmt;
					this.#codecString = codec;
					this.#closeDecoder();
					this.#gotKey = false;
				} else if (codec) this.#codecString = codec;
				break;
			}
			case 'cursor_update': {
				const id =
					typeof msg.cursor_id === 'string' || typeof msg.cursor_id === 'number' ? String(msg.cursor_id) : '';
				const cached = id ? this.#cursors.get(id) : undefined;
				const css = msg.hidden === true ? 'none' : (cached ?? cursorCss(msg, rgbaToPng) ?? 'default');
				if (id && !cached && css !== 'default' && css !== 'none') {
					this.#cursors.set(id, css);
					if (this.#cursors.size > CURSOR_CACHE) {
						const oldest = this.#cursors.keys().next().value;
						if (oldest !== undefined) this.#cursors.delete(oldest);
					}
				}
				this.#o.events.oncursor?.(css);
				break;
			}
			case 'clipboard_update':
				if (msg.format === 'text' && typeof msg.data === 'string' && msg.data)
					this.#o.events.onclipboard?.(msg.data);
				break;
			case 'monitor_list': {
				const list = Array.isArray(msg.monitors) ? msg.monitors : [];
				const monitors: Monitor[] = list
					.filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
					.map((m) => ({
						index: Math.round(Number(m.index) || 0),
						name: typeof m.name === 'string' ? m.name : '',
						width: Math.round(Number(m.width) || 0),
						height: Math.round(Number(m.height) || 0),
						primary: m.primary === true
					}));
				this.#o.events.onmonitors?.(monitors, typeof msg.active === 'number' ? msg.active : 0);
				break;
			}
			case 'error':
				this.#o.events.onstate(
					this.#connected ? 'open' : 'error',
					typeof msg.error === 'string' ? msg.error : undefined
				);
				break;
			case 'end':
				this.close();
				break;
			default:
				// codec_answer, quality_adjust: nothing to do
				break;
		}
	}

	#resize(w: number, h: number): void {
		const c = this.#o.canvas;
		if (c.width !== w || c.height !== h) {
			c.width = w;
			c.height = h;
		}
	}

	#draw(src: CanvasImageSource, w: number, h: number): void {
		if (w > 0 && h > 0) this.#resize(w, h);
		this.#ctx?.drawImage(src, 0, 0, this.#o.canvas.width, this.#o.canvas.height);
	}

	#binary(buf: ArrayBuffer): void {
		this.#counters.frames++;
		this.#counters.bytes += buf.byteLength;
		this.#lastFrameAt = Date.now();
		if (isVideoCodec(this.#format)) {
			this.#video(buf);
			return;
		}
		// A decode still running: drop this frame rather than paint old ones late
		if (this.#busy) {
			this.#counters.dropped++;
			return;
		}
		this.#busy = true;
		const blob = new Blob([buf], { type: this.#format === 'webp' ? 'image/webp' : 'image/jpeg' });
		createImageBitmap(blob)
			.then((bmp) => {
				this.#draw(bmp, bmp.width, bmp.height);
				bmp.close();
			})
			.catch(() => this.#counters.dropped++)
			.finally(() => (this.#busy = false));
	}

	#base64Frame(msg: Record<string, unknown>): void {
		const data = typeof msg.data === 'string' ? msg.data : '';
		if (!data || !BASE64.test(data)) return;
		const fmt = msg.format === 'png' || msg.format === 'webp' ? msg.format : 'jpeg';
		this.#counters.frames++;
		this.#counters.bytes += data.length * 0.75;
		this.#lastFrameAt = Date.now();
		const w = Number(msg.width);
		const h = Number(msg.height);
		const img = (this.#img ??= new Image());
		img.onload = () => this.#draw(img, w, h);
		img.onerror = () => this.#counters.dropped++;
		img.src = `data:image/${fmt};base64,${data}`;
	}

	#askKeyframe(): void {
		if (this.#keyAsked || !this.#sessionId) return;
		this.#keyAsked = true;
		this.#send({ type: 'keyframe_request', session_id: this.#sessionId });
	}

	#video(buf: ArrayBuffer): void {
		const bytes = new Uint8Array(buf);
		if (bytes.length < 2) return;
		const key = ((bytes[0] ?? 0) & 0x01) === 1;
		const payload = bytes.subarray(1);
		// A decoder starts from a keyframe: skip deltas until one arrives
		if (!this.#gotKey) {
			if (!key) {
				this.#counters.dropped++;
				this.#askKeyframe();
				return;
			}
			this.#gotKey = true;
			this.#keyAsked = false;
		}
		if (!this.#o.env.videoDecoder) {
			if (this.#format === 'h264' && this.#o.env.mseH264) this.#mseDecode(payload, key);
			else this.#counters.dropped++;
			return;
		}
		const dec = this.#ensureDecoder();
		if (!dec) {
			this.#counters.dropped++;
			return;
		}
		try {
			dec.decode(
				new EncodedVideoChunk({
					type: key ? 'key' : 'delta',
					timestamp: (this.#counters.frames * 1_000_000) / 30,
					data: payload
				})
			);
		} catch {
			this.#counters.dropped++;
			this.#closeDecoder();
			this.#gotKey = false;
		}
	}

	#ensureDecoder(): VideoDecoder | null {
		if (this.#decoder && this.#decoderFormat === this.#format) return this.#decoder;
		this.#closeDecoder();
		const codec = this.#codecString || DEFAULT_CODEC[this.#format];
		if (!codec) return null;
		try {
			const dec = new VideoDecoder({
				output: (frame) => {
					try {
						this.#draw(frame, frame.displayWidth, frame.displayHeight);
					} catch {
						this.#counters.dropped++;
					} finally {
						frame.close();
					}
				},
				error: () => {
					this.#closeDecoder();
					this.#gotKey = false;
					this.#askKeyframe();
				}
			});
			dec.configure({ codec, optimizeForLatency: true });
			this.#decoder = dec;
			this.#decoderFormat = this.#format;
			return dec;
		} catch {
			return null;
		}
	}

	#mseDecode(payload: Uint8Array, key: boolean): void {
		const Ctor = (window as unknown as { RDVideo?: RDVideoCtor }).RDVideo;
		if (!Ctor) {
			this.#counters.dropped++;
			return;
		}
		if (!this.#mse) {
			const v = new Ctor();
			v.onFrame = (frame) => {
				try {
					this.#draw(frame._source ?? frame, frame.displayWidth ?? 0, frame.displayHeight ?? 0);
				} catch {
					this.#counters.dropped++;
				} finally {
					try {
						frame.close?.();
					} catch {
						/* gone */
					}
				}
			};
			v.onError = () => {
				this.#gotKey = false;
				this.#askKeyframe();
			};
			v.init('h264').catch(() => (this.#mse = null));
			this.#mse = v;
		}
		try {
			this.#mse.decode({ data: payload, key, codec: 'h264' });
		} catch {
			this.#counters.dropped++;
		}
	}

	#closeDecoder(): void {
		if (this.#decoder) {
			try {
				if (this.#decoder.state !== 'closed') this.#decoder.close();
			} catch {
				/* closed */
			}
			this.#decoder = null;
			this.#decoderFormat = '';
		}
		if (this.#mse) {
			try {
				this.#mse.close();
			} catch {
				/* closed */
			}
			this.#mse = null;
		}
	}

	#report(): void {
		if (!this.#connected || !this.#sessionId) return;
		const now = { ...this.#counters, time: Date.now() };
		const r = qualityReport(this.#sessionId, this.#prev, now, this.#lastFrameAt);
		if (r) this.#send(r);
		this.#prev = now;
	}

	#ended(state: 'closed' | 'error'): void {
		if (this.#closed) return;
		this.#closed = true;
		this.#connected = false;
		if (this.#quality) clearInterval(this.#quality);
		if (this.#presence) clearInterval(this.#presence);
		this.#quality = this.#presence = null;
		this.#closeDecoder();
		const ws = this.#ws;
		this.#ws = null;
		if (ws) {
			ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
			if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) {
				try {
					ws.close();
				} catch {
					/* closed */
				}
			}
		}
		this.#o.events.oncursor?.('default');
		this.#o.events.onstate(state);
	}
}
