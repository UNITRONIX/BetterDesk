import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	DesktopSession,
	PRESENCE_MS,
	canvasPoint,
	cursorCss,
	decodableCodecs,
	keyMessage,
	mouseMask,
	qualityReport,
	wheelStep,
	type StreamState
} from '../../../src/lib/devices-area/cdap/desktop.ts';
import {
	FileSession,
	VideoSession,
	base64Bytes,
	pcmToFloat,
	rms
} from '../../../src/lib/devices-area/cdap/streams.ts';
import type { FileEntry } from '../../../src/lib/devices-area/cdap/model.ts';

/** A WebSocket the test drives: what the page sent, and server messages on demand */
class FakeSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	readyState = 0;
	binaryType = 'blob';
	sent: unknown[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: (() => void) | null = null;
	constructor(
		public url: string,
		public protocols: string[]
	) {}
	send(data: string) {
		this.sent.push(JSON.parse(data));
	}
	close() {
		this.readyState = 3;
	}
	serverOpen() {
		this.readyState = 1;
		this.onopen?.();
	}
	serverSend(msg: unknown) {
		this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) });
	}
	serverClose() {
		this.readyState = 3;
		this.onclose?.();
	}
}

let sockets: FakeSocket[];
const create = (url: string, protocols: string[]) => {
	const s = new FakeSocket(url, protocols);
	sockets.push(s);
	return s as unknown as WebSocket;
};

beforeEach(() => {
	sockets = [];
	vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('desktop protocol', () => {
	test('codecs: video codecs only where they can be decoded, images always', () => {
		expect(decodableCodecs({ videoDecoder: true, mseH264: false })).toEqual([
			'av1',
			'vp9',
			'h264',
			'webp',
			'jpeg'
		]);
		expect(decodableCodecs({ videoDecoder: false, mseH264: true })).toEqual(['h264', 'webp', 'jpeg']);
		expect(decodableCodecs({ videoDecoder: false, mseH264: false })).toEqual(['webp', 'jpeg']);
	});

	test("mouse mask: RustDesk's type in the low bits, the button above", () => {
		expect(mouseMask(1, 0)).toBe(1 | (1 << 3));
		expect(mouseMask(2, 2)).toBe(2 | (2 << 3));
		expect(mouseMask(1, 1)).toBe(1 | (4 << 3));
		expect(mouseMask(0, 0)).toBe(8);
	});

	test('pointer to device pixel through the letterbox of object-fit: contain', () => {
		// A square picture in a wide box: 900 px high, 350 px bars left and right
		const rect = { left: 100, top: 20, width: 1600, height: 900 };
		expect(canvasPoint(100 + 350 + 450, 20 + 450, rect, 1000, 1000)).toEqual({ x: 500, y: 500 });
		expect(canvasPoint(100 + 10, 20 + 10, rect, 1000, 1000)).toEqual({ x: 0, y: 11 });
		expect(canvasPoint(5000, 5000, rect, 1000, 1000)).toEqual({ x: 999, y: 999 });
		expect(canvasPoint(0, 0, { left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual({ x: 0, y: 0 });
	});

	test('wheel: one step per event, Shift scrolls sideways', () => {
		expect(wheelStep(0, 120, false)).toEqual({ deltaX: 0, deltaY: -1 });
		expect(wheelStep(0, -3, false)).toEqual({ deltaX: 0, deltaY: 1 });
		expect(wheelStep(0, 120, true)).toEqual({ deltaX: -1, deltaY: 0 });
		expect(wheelStep(0, 0, false)).toEqual({ deltaX: 0, deltaY: 0 });
	});

	test('keys: letters and digits as keys, other characters as text, shortcuts as keys', () => {
		const k = (key: string, mods: Partial<{ ctrlKey: boolean }> = {}) => ({
			key,
			code: 'X',
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
			...mods
		});
		expect(keyMessage(k('a'), true)).toMatchObject({ input_type: 'keyboard', key: 'a', down: true });
		expect(keyMessage(k('@'), true)).toEqual({ type: 'input', input_type: 'text', text: '@' });
		expect(keyMessage(k('ą'), true)).toMatchObject({ input_type: 'text', text: 'ą' });
		expect(keyMessage(k('c', { ctrlKey: true }), true)).toMatchObject({
			input_type: 'keyboard',
			modifiers: { ctrl: true }
		});
		expect(keyMessage(k('@'), false)).toMatchObject({ input_type: 'keyboard', down: false });
		expect(keyMessage(k('Enter'), true)).toMatchObject({ input_type: 'keyboard', key: 'Enter' });
	});

	test('quality report over the last interval', () => {
		const r = qualityReport(
			's1',
			{ frames: 10, bytes: 0, dropped: 0, time: 0 },
			{ frames: 60, bytes: 10240, dropped: 5, time: 5000 },
			4900
		);
		expect(r).toEqual({
			type: 'quality_report',
			session_id: 's1',
			bandwidth_kb: 2,
			latency_ms: 100,
			frame_loss: 0.091,
			fps: 10
		});
		expect(
			qualityReport(
				's1',
				{ frames: 0, bytes: 0, dropped: 0, time: 5 },
				{ frames: 0, bytes: 0, dropped: 0, time: 5 },
				0
			)
		).toBeNull();
	});

	test('cursor: only clean base64 goes into the CSS value', () => {
		expect(cursorCss({ hidden: true })).toBe('none');
		expect(cursorCss({ data: 'iVBORw0KGgo=', width: 8, height: 8, hotspot_x: 3, hotspot_y: 99 })).toBe(
			'url("data:image/png;base64,iVBORw0KGgo=") 3 7, auto'
		);
		expect(cursorCss({ data: 'x") , url(http://evil', width: 8, height: 8 })).toBeNull();
		expect(cursorCss({ data: 'AAAA', width: 1000, height: 8 })).toBeNull();
		expect(
			cursorCss({ data: 'AAAA', width: 1, height: 1, format: 'rgba' }, () => 'data:image/png;base64,QQ==')
		).toContain('QQ==');
	});
});

describe('desktop session', () => {
	function start(env = { videoDecoder: false, mseH264: false }) {
		const states: [StreamState, string | undefined][] = [];
		const clips: string[] = [];
		const canvas = document.createElement('canvas');
		const s = new DesktopSession({
			url: 'ws://x/api/cdap/devices/d1/desktop',
			canvas,
			env,
			createSocket: create,
			events: { onstate: (st, m) => states.push([st, m]), onclipboard: (t) => clips.push(t) }
		});
		s.open();
		return { s, states, clips, ws: sockets[0]! };
	}

	test('opens with the init message and the codecs, offers codecs once ready', () => {
		const { ws, states } = start({ videoDecoder: false, mseH264: true });
		expect(ws.protocols).toEqual(['cdap-desktop']);
		expect(ws.binaryType).toBe('arraybuffer');
		ws.serverOpen();
		expect(ws.sent[0]).toMatchObject({
			quality: 75,
			fps: 30,
			codecs: ['h264', 'webp', 'jpeg'],
			video_codec: 'auto'
		});
		ws.serverSend({ type: 'ready', session_id: 's9' });
		expect(states.at(-1)![0]).toBe('open');
		expect(ws.sent.at(-1)).toEqual({
			type: 'codec_offer',
			session_id: 's9',
			video: ['h264', 'webp', 'jpeg'],
			audio: ['opus', 'pcm'],
			preferred: 'h264'
		});
	});

	test("the device's clipboard goes to the page, never into the browser's clipboard", () => {
		const write = vi.fn(() => Promise.resolve());
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
		const { ws, clips } = start();
		ws.serverOpen();
		ws.serverSend({ type: 'ready', session_id: 's1' });
		ws.serverSend({ type: 'clipboard_update', format: 'text', data: 'from the device' });
		expect(clips).toEqual(['from the device']);
		expect(write).not.toHaveBeenCalled();
	});

	test('presence ping every 15 s, nothing after the end', () => {
		vi.useFakeTimers();
		const { ws, s, states } = start();
		ws.serverOpen();
		ws.serverSend({ type: 'ready', session_id: 's1' });
		vi.advanceTimersByTime(PRESENCE_MS);
		expect(ws.sent.filter((m) => (m as { type?: string }).type === 'presence_ping')).toHaveLength(1);
		ws.serverSend({ type: 'end' });
		expect(ws.sent.at(-1)).toEqual({ type: 'close' });
		expect(states.at(-1)![0]).toBe('closed');
		const before = ws.sent.length;
		vi.advanceTimersByTime(PRESENCE_MS * 3);
		s.key({ key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, true);
		expect(ws.sent.length).toBe(before);
	});

	test('input only while connected; a socket that never opened is an error', () => {
		const { ws, s, states } = start();
		s.key({ key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, true);
		expect(ws.sent).toEqual([]);
		ws.serverClose();
		expect(states.at(-1)![0]).toBe('error');
	});

	test('monitor list and selection', () => {
		const mons: unknown[] = [];
		const canvas = document.createElement('canvas');
		const s = new DesktopSession({
			url: 'ws://x',
			canvas,
			env: { videoDecoder: false, mseH264: false },
			createSocket: create,
			events: { onstate: () => undefined, onmonitors: (m, a) => mons.push([m, a]) }
		});
		s.open();
		const ws = sockets[0]!;
		ws.serverOpen();
		ws.serverSend({ type: 'ready', session_id: 's2' });
		ws.serverSend({
			type: 'monitor_list',
			monitors: [{ index: 0, name: 'A', width: 10, height: 20, primary: true }, 'junk'],
			active: 0
		});
		expect(mons).toEqual([[[{ index: 0, name: 'A', width: 10, height: 20, primary: true }], 0]]);
		s.selectMonitor(1);
		expect(ws.sent.at(-1)).toEqual({ type: 'monitor_select', session_id: 's2', index: 1 });
	});
});

describe('video, files and audio sessions', () => {
	test('video asks for its stream and offers image codecs once ready', () => {
		const states: StreamState[] = [];
		const v = new VideoSession(
			'ws://x/video',
			'cam1',
			document.createElement('canvas'),
			(s) => states.push(s),
			create
		);
		v.open();
		const ws = sockets[0]!;
		expect(ws.protocols).toEqual(['cdap-video']);
		ws.serverOpen();
		expect(ws.sent[0]).toEqual({ stream_id: 'cam1', quality: 60, fps: 10 });
		ws.serverSend({ type: 'ready', session_id: 'v1' });
		expect(states.at(-1)).toBe('open');
		expect(ws.sent.at(-1)).toMatchObject({ type: 'codec_offer', video: ['jpeg', 'png'] });
		v.close();
		expect(ws.sent.at(-1)).toEqual({ type: 'close' });
	});

	test('files: lists, opens folders, goes up, downloads only what it asked for', () => {
		const lists: [string, FileEntry[]][] = [];
		const downloads: [string, number[]][] = [];
		const errors: string[] = [];
		const f = new FileSession(
			'ws://x/files',
			() => undefined,
			{
				onlist: (p, e) => lists.push([p, e]),
				onloading: () => undefined,
				onerror: (m) => errors.push(m),
				ondownload: (n, b) => downloads.push([n, Array.from(b)])
			},
			'en',
			create
		);
		f.open();
		const ws = sockets[0]!;
		expect(ws.protocols).toEqual(['cdap-filebrowser']);
		ws.serverOpen();
		expect(ws.sent[0]).toEqual({ type: 'file_list', path: '/' });
		ws.serverSend({ type: 'file_list_response', entries: [{ name: 'var', is_dir: true }] });
		expect(lists[0]).toEqual(['/', [{ name: 'var', dir: true, size: null, modified: '' }]]);
		f.enter('var');
		expect(ws.sent.at(-1)).toEqual({ type: 'file_list', path: '/var' });
		f.up();
		expect(ws.sent.at(-1)).toEqual({ type: 'file_list', path: '/' });
		f.download('a.txt');
		const req = ws.sent.at(-1) as { request_id: string; path: string };
		expect(req.path).toBe('/a.txt');
		// An answer to a request the page never made is ignored
		ws.serverSend({ type: 'file_read_response', request_id: 'dl_forged', data: 'aGk=' });
		ws.serverSend({ type: 'file_read_response', request_id: req.request_id, data: 'aGk=' });
		ws.serverSend({ type: 'file_read_response', request_id: req.request_id, data: 'aGk=' });
		expect(downloads).toEqual([['a.txt', [104, 105]]]);
		f.remove('a.txt');
		expect(ws.sent.at(-1)).toEqual({ type: 'file_delete', path: '/a.txt' });
		ws.serverSend({ type: 'file_delete_response', error: 'read-only' });
		expect(errors).toEqual(['read-only']);
		expect(ws.sent.at(-1)).toEqual({ type: 'file_list', path: '/' });
	});

	test('audio data: base64 checked, 16-bit PCM to floats, loudness', () => {
		expect(base64Bytes('aGk=')).toEqual(new Uint8Array([104, 105]));
		expect(base64Bytes('not base64!')).toBeNull();
		const pcm = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f]);
		const [ch] = pcmToFloat(pcm, 1);
		expect(Array.from(ch!)).toEqual([0.5, -0.5, 32767 / 32768]);
		expect(rms(new Float32Array([0.5, -0.5]))).toBe(0.5);
		expect(rms(new Float32Array())).toBe(0);
	});
});
