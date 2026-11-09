import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Terminal from '../../../src/lib/ui/Terminal.svelte';
import { meshAdapter, shellAdapter, socketUrl, type TerminalSession } from '../../../src/lib/ui/terminal.ts';

type KeyHandler = (e: KeyboardEvent) => boolean;

const xt = vi.hoisted(() => ({
	instances: [] as {
		options: Record<string, unknown>;
		written: string[];
		emitData: (d: string) => void;
		emitResize: (cols: number, rows: number) => void;
		keyHandler: KeyHandler | null;
		textarea: HTMLTextAreaElement;
		disposed: boolean;
	}[],
	fits: 0
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));
vi.mock('@xterm/xterm', () => {
	class Terminal {
		cols = 80;
		rows = 24;
		options: Record<string, unknown>;
		written: string[] = [];
		keyHandler: KeyHandler | null = null;
		textarea = document.createElement('textarea');
		disposed = false;
		private dataCb: ((d: string) => void) | null = null;
		private resizeCb: ((s: { cols: number; rows: number }) => void) | null = null;
		constructor(options: Record<string, unknown>) {
			this.options = options;
			xt.instances.push(this);
		}
		loadAddon() {}
		open(el: HTMLElement) {
			this.textarea.className = 'xterm-helper-textarea';
			el.append(this.textarea);
		}
		write(d: string | Uint8Array) {
			this.written.push(typeof d === 'string' ? d : new TextDecoder().decode(d));
		}
		writeln(s: string) {
			this.written.push(s + '\r\n');
		}
		clear() {
			this.written = [];
		}
		focus() {
			this.textarea.focus();
		}
		onData(cb: (d: string) => void) {
			this.dataCb = cb;
			return { dispose: () => (this.dataCb = null) };
		}
		onResize(cb: (s: { cols: number; rows: number }) => void) {
			this.resizeCb = cb;
			return { dispose: () => (this.resizeCb = null) };
		}
		emitData(d: string) {
			this.dataCb?.(d);
		}
		emitResize(cols: number, rows: number) {
			this.cols = cols;
			this.rows = rows;
			this.resizeCb?.({ cols, rows });
		}
		attachCustomKeyEventHandler(h: KeyHandler) {
			this.keyHandler = h;
		}
		dispose() {
			this.disposed = true;
		}
	}
	return { Terminal };
});
vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {
			xt.fits++;
		}
	}
}));

class FakeSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 3;
	readyState = 0;
	binaryType = 'blob';
	sent: unknown[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((e: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(
		public url: string,
		public protocols?: string | string[]
	) {
		sockets.push(this);
	}
	send(d: unknown) {
		this.sent.push(d);
	}
	close() {
		if (this.readyState === 3) return;
		this.readyState = 3;
		this.onclose?.();
		flushSync();
	}
	// test helpers
	accept() {
		this.readyState = 1;
		this.onopen?.();
		flushSync();
	}
	receive(data: unknown) {
		const plain =
			data !== null && typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype;
		this.onmessage?.({ data: plain ? JSON.stringify(data) : data });
		flushSync();
	}
	sentJson() {
		return this.sent.map((s) => JSON.parse(String(s)));
	}
}
let sockets: FakeSocket[] = [];

beforeEach(() => {
	sockets = [];
	xt.instances.length = 0;
	vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

const term = () => xt.instances.at(-1)!;
const status = () => screen.getByRole('status');

async function openShell() {
	const user = userEvent.setup();
	const view = render(Terminal, {
		label: 'Shell',
		url: '/ws/server-management/terminal',
		adapter: shellAdapter()
	});
	await waitFor(() => expect(sockets).toHaveLength(1));
	return { user, view, socket: sockets[0]! };
}

describe('Terminal', () => {
	test('loads xterm on mount, connects to the socket and sends the size', async () => {
		const { socket } = await openShell();
		expect(xt.instances).toHaveLength(1);
		expect(term().options).toMatchObject({ convertEol: false, theme: { background: '#111414' } });
		expect(socket.url).toBe(`ws://${location.host}/ws/server-management/terminal`);
		expect(status()).toHaveTextContent('Connecting…');
		socket.accept();
		expect(socket.sentJson()).toEqual([{ type: 'init', cols: 80, rows: 24 }]);
		expect(screen.getByRole('region', { name: 'Shell' })).toContainElement(term().textarea);
	});

	test('shows the ready message, writes output and sends what the user types', async () => {
		const { socket } = await openShell();
		socket.accept();
		socket.receive({ type: 'ready', user: 'root', platform: 'linux', pty_available: true });
		expect(status()).toHaveTextContent('Connected as root on linux.');
		socket.receive({ type: 'output', data: 'hello\r\n' });
		expect(term().written).toContain('hello\r\n');

		term().emitData('ls\r');
		term().emitResize(100, 30);
		expect(socket.sentJson().slice(1)).toEqual([
			{ type: 'input', data: 'ls\r' },
			{ type: 'resize', cols: 100, rows: 30 }
		]);
	});

	test('a closed socket shows Disconnected and Reconnect opens a new one', async () => {
		const { user, socket } = await openShell();
		socket.accept();
		socket.receive({ type: 'ready', user: 'root', platform: 'linux', pty_available: true });
		expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();

		socket.close();
		expect(status()).toHaveTextContent('Disconnected');
		// Input after the end goes nowhere
		term().emitData('x');
		expect(socket.sentJson().map((m) => m.type)).toEqual(['init']);

		await user.click(screen.getByRole('button', { name: 'Reconnect' }));
		await waitFor(() => expect(sockets).toHaveLength(2));
		expect(status()).toHaveTextContent('Connecting…');
		expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
		// Focus went into the terminal, not to the page
		expect(term().textarea).toHaveFocus();
		const next = sockets[1]!;
		next.accept();
		next.receive({ type: 'ready', user: 'root', platform: 'linux', pty_available: true });
		// The old socket's late messages don't reach the screen
		socket.receive({ type: 'output', data: 'stale' });
		expect(term().written).not.toContain('stale');
		term().emitData('y');
		expect(next.sentJson().at(-1)).toEqual({ type: 'input', data: 'y' });
	});

	test('a socket that never opens is an error, not a plain disconnect', async () => {
		const { socket } = await openShell();
		socket.close();
		expect(status()).toHaveTextContent('Lost the connection to the terminal.');
		expect(status().querySelector('.status')).toHaveClass('is-danger');
		expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
	});

	test('a shell that ends right away says why', async () => {
		const { socket } = await openShell();
		socket.accept();
		socket.receive({
			type: 'ready',
			user: 'node',
			platform: 'linux',
			shell: '/bin/bash',
			pty_available: true
		});
		socket.receive({ type: 'output', data: 'execvp(3) failed.: No such file or directory' });
		socket.receive({ type: 'end', code: 1 });
		expect(status()).toHaveTextContent("the shell /bin/bash isn't installed");
		expect(socket.readyState).toBe(3);
	});

	test('unmounting closes the socket and disposes xterm', async () => {
		const { view, socket } = await openShell();
		socket.accept();
		view.unmount();
		expect(socket.readyState).toBe(3);
		expect(socket.sentJson().at(-1)).toEqual({ type: 'close' });
		expect(term().disposed).toBe(true);
	});

	test('a connect function works without a socket', async () => {
		const input = vi.fn();
		let session: TerminalSession | null = null;
		render(Terminal, {
			label: 'Custom',
			connect: (s: TerminalSession) => {
				session = s;
				return { input, resize: () => {}, close: () => {} };
			}
		});
		await waitFor(() => expect(session).not.toBeNull());
		flushSync(() => session!.status('open'));
		session!.write('ok');
		expect(status()).toHaveTextContent('Connected');
		expect(term().written).toEqual(['ok']);
		term().emitData('a');
		expect(input).toHaveBeenCalledWith('a');

		// After a reconnect the old session can no longer write or change the status
		const old = session!;
		flushSync(() => old.status('closed'));
		await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
		await waitFor(() => expect(session).not.toBe(old));
		old.write('stale');
		flushSync(() => old.status('error', 'stale'));
		expect(term().written).not.toContain('stale');
		expect(status()).toHaveTextContent('Connecting…');
	});

	test('keyboard: Escape stays in the shell, Escape then Tab leaves, Shift+Escape reaches the page', async () => {
		const { socket } = await openShell();
		socket.accept();
		const handler = term().keyHandler!;
		const key = (k: string, shiftKey = false) => new KeyboardEvent('keydown', { key: k, shiftKey });
		expect(handler(key('Tab'))).toBe(true);
		expect(handler(key('Escape'))).toBe(true);
		expect(handler(key('Tab'))).toBe(false);
		expect(handler(key('Tab'))).toBe(true);
		expect(handler(key('Escape', true))).toBe(false);

		const onDocument = vi.fn();
		document.addEventListener('keydown', onDocument);
		term().textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onDocument).not.toHaveBeenCalled();
		term().textarea.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', shiftKey: true, bubbles: true })
		);
		expect(onDocument).toHaveBeenCalledTimes(1);
		document.removeEventListener('keydown', onDocument);
		expect(screen.getByText(/press Esc and then Tab/)).toHaveAttribute(
			'id',
			screen.getByRole('region', { name: 'Shell' }).getAttribute('aria-describedby')
		);
	});
});

describe('terminal adapters', () => {
	test('socketUrl turns paths and http URLs into socket URLs', () => {
		expect(socketUrl('/ws/x')).toBe(`ws://${location.host}/ws/x`);
		expect(socketUrl('https://h.example/relay')).toBe('wss://h.example/relay');
		expect(socketUrl('http://h.example/relay')).toBe('ws://h.example/relay');
	});

	test('mesh: answers the relay with the protocol, then sends binary input and the size', async () => {
		render(Terminal, { label: 'Mesh', url: async () => '/meshrelay.ashx?id=1', adapter: meshAdapter() });
		await waitFor(() => expect(sockets).toHaveLength(1));
		const socket = sockets[0]!;
		expect(socket.binaryType).toBe('arraybuffer');
		socket.accept();
		term().emitData('a');
		expect(socket.sent).toHaveLength(1); // input before the agent is there is still sent as bytes
		socket.receive('c');
		expect(socket.sent[1]).toBe('1');
		expect(JSON.parse(String(socket.sent[2]))).toEqual({
			ctrlChannel: '102938',
			type: 'termsize',
			cols: 80,
			rows: 24
		});
		expect(status()).toHaveTextContent('Connected.');
		socket.receive(new TextEncoder().encode('prompt$ ').buffer);
		expect(term().written).toContain('prompt$ ');
		term().emitData('ls');
		expect(new TextDecoder().decode(socket.sent.at(-1) as Uint8Array)).toBe('ls');
	});
});
