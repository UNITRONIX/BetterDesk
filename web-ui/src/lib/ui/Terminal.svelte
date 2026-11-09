<!--
  Terminal (components.css "Terminal"): xterm in a box that is dark in both
  themes, a status line above it and a Reconnect button once the session
  has ended. xterm and its CSS load when the first terminal mounts, so pages
  without one don't download it.

  The connection is either `connect` (a TerminalConnect from terminal.ts) or
  `url` plus `adapter` (socketConnect builds the TerminalConnect). See
  terminal.ts for the three adapters the console uses.

  Keyboard: the terminal is one Tab stop. Inside it every key goes to the
  shell, Tab and Escape too. Escape then Tab (or Shift+Tab) moves focus on;
  the hint under the box says so. Shift+Escape is not taken by the shell, so
  it reaches a sheet around the terminal and closes it. A plain Escape
  doesn't leave the box, so a sheet stays open while an editor in the shell
  uses it.

  Exported: reconnect(), disconnect(), clear(), focus().
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import type { Terminal as XTerm, IDisposable } from '@xterm/xterm';
	import type { FitAddon } from '@xterm/addon-fit';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from './Button.svelte';
	import Status from './Status.svelte';
	import {
		socketConnect,
		type SocketAdapter,
		type TerminalConnect,
		type TerminalConnection,
		type TerminalSession,
		type TerminalState
	} from './terminal.ts';

	interface Props {
		/** Accessible name of the terminal region ("Shell on the console host") */
		label: string;
		connect?: TerminalConnect;
		/** A same-origin path, a ws(s) URL, or a function that finds one */
		url?: string | (() => Promise<string>);
		adapter?: SocketAdapter;
		/** Treat \n as \r\n (devices that send bare newlines) */
		convertEol?: boolean;
		/** Focus the terminal as soon as the session is open */
		focusOnOpen?: boolean;
		/** Replaces the keyboard hint under the terminal */
		hint?: string;
		onstatechange?: (state: TerminalState) => void;
	}

	let {
		label,
		connect,
		url,
		adapter,
		convertEol = false,
		focusOnOpen = false,
		hint,
		onstatechange
	}: Props = $props();

	// The colours of .terminal-box; ANSI red and yellow lightened to stay
	// above 4.5:1 on that background
	const THEME = {
		background: '#111414',
		foreground: '#e3e6e6',
		cursor: '#e3e6e6',
		red: '#ff8a80',
		brightRed: '#ffb4ab',
		yellow: '#f0d264',
		brightYellow: '#ffe08a'
	};

	const hintId = $props.id();

	let host = $state<HTMLDivElement | null>(null);
	let phase = $state<TerminalState>('loading');
	let message = $state('');

	let term: XTerm | null = null;
	let fit: FitAddon | null = null;
	let conn: TerminalConnection | null = null;
	// Bumped for every new connection; callbacks of an older one are ignored
	let gen = 0;
	let focusWhenOpen = false;

	function setState(next: TerminalState, text = '') {
		phase = next;
		message = text;
		onstatechange?.(next);
	}

	const words = $derived({
		loading: tf('server_mgmt.term_connecting', 'Connecting…'),
		connecting: tf('server_mgmt.term_connecting', 'Connecting…'),
		open: tf('server_mgmt.term_connected', 'Connected'),
		closed: tf('server_mgmt.term_disconnected', 'Disconnected'),
		error: tf('server_mgmt.term_error', 'Lost the connection to the terminal.')
	});
	const tones = {
		loading: 'waiting',
		connecting: 'waiting',
		open: 'good',
		closed: 'neutral',
		error: 'danger'
	};
	const ended = $derived(phase === 'closed' || phase === 'error');

	function session(g: number): TerminalSession {
		const live = () => (g === gen ? term : null);
		return {
			write: (data) => live()?.write(data),
			writeln: (text) => live()?.writeln(text),
			clear: () => live()?.clear(),
			focus: () => live()?.focus(),
			get cols() {
				return term?.cols ?? 80;
			},
			get rows() {
				return term?.rows ?? 24;
			},
			status(next, text) {
				if (g !== gen) return;
				setState(next, text);
				if (next === 'open' && (focusOnOpen || focusWhenOpen)) term?.focus();
				if (next !== 'connecting') focusWhenOpen = false;
			}
		};
	}

	async function start() {
		if (!term) return;
		conn?.close();
		conn = null;
		const g = ++gen;
		setState('connecting');
		const open = connect ?? (url && adapter ? socketConnect(url, adapter) : null);
		if (!open) {
			setState('error');
			return;
		}
		try {
			const c = await open(session(g));
			if (g !== gen) c.close();
			else conn = c;
		} catch (err) {
			if (g === gen) setState('error', err instanceof Error ? err.message : '');
		}
	}

	/** Ends the session and starts a new one; focus goes into the terminal */
	export function reconnect() {
		focusWhenOpen = true;
		term?.focus();
		void start();
	}

	export function disconnect() {
		gen++;
		conn?.close();
		conn = null;
		setState('closed');
	}

	export function clear() {
		term?.clear();
	}

	export function focus() {
		term?.focus();
	}

	onMount(() => {
		const el = host;
		if (!el) return;
		let disposed = false;
		const cleanups: (() => void)[] = [];

		// Escape belongs to the shell: don't let it close a sheet around us
		const onkeydown = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !e.shiftKey) e.stopPropagation();
		};
		el.addEventListener('keydown', onkeydown);
		cleanups.push(() => el.removeEventListener('keydown', onkeydown));

		void (async () => {
			let Terminal: typeof XTerm;
			let Fit: typeof FitAddon;
			try {
				const [xterm, addon] = await Promise.all([
					import('@xterm/xterm'),
					import('@xterm/addon-fit'),
					import('@xterm/xterm/css/xterm.css')
				]);
				Terminal = xterm.Terminal;
				Fit = addon.FitAddon;
			} catch {
				if (!disposed) setState('error', tf('server_mgmt.term_lib_failed', 'Could not load the terminal.'));
				return;
			}
			if (disposed) return;

			const t = new Terminal({
				cursorBlink: true,
				fontFamily: getComputedStyle(el).fontFamily || 'monospace',
				fontSize: 13,
				scrollback: 5000,
				convertEol,
				theme: THEME
			});
			const f = new Fit();
			t.loadAddon(f);

			// Escape then Tab leaves the terminal; Shift+Escape goes to the page
			let escape = false;
			t.attachCustomKeyEventHandler((e) => {
				if (e.type !== 'keydown') return true;
				if (e.key === 'Escape' && e.shiftKey) return false;
				if (e.key === 'Tab' && escape) {
					escape = false;
					return false;
				}
				escape = e.key === 'Escape';
				return true;
			});

			t.open(el);
			term = t;
			fit = f;
			try {
				f.fit();
			} catch {
				/* not laid out yet; the observer fits it later */
			}

			const subs: IDisposable[] = [
				t.onData((data) => conn?.input(data)),
				t.onResize(({ cols, rows }) => conn?.resize(cols, rows))
			];
			cleanups.push(() => subs.forEach((s) => s.dispose()));

			if (typeof ResizeObserver === 'function') {
				const ro = new ResizeObserver(() => {
					try {
						fit?.fit();
					} catch {
						/* hidden */
					}
				});
				ro.observe(el);
				cleanups.push(() => ro.disconnect());
			}

			void start();
		})();

		return () => {
			disposed = true;
			gen++;
			conn?.close();
			conn = null;
			cleanups.forEach((c) => c());
			term?.dispose();
			term = null;
			fit = null;
		};
	});
</script>

<div class="terminal">
	<div class="terminal-bar">
		<p class="terminal-status" role="status">
			<Status tone={tones[phase]} label={message || words[phase]} />
		</p>
		{#if ended}
			<Button size="sm" icon="refresh" onclick={reconnect}>{tf('remote.reconnect', 'Reconnect')}</Button>
		{/if}
	</div>
	<div bind:this={host} class="terminal-box" role="region" aria-label={label} aria-describedby={hintId}></div>
	<p id={hintId} class="terminal-hint">
		{hint ??
			tf(
				'server_mgmt.term_keyboard',
				'Inside the terminal, Tab goes to the shell; press Esc and then Tab to move on.'
			)}
	</p>
</div>

<style>
	/* The terminal takes the height its container gives it (a sheet's body, a
	   page area of a set height), at least 360px for the box. The box needs a
	   set height: with an automatic one, every fit adds rows, the box grows by
	   them and the next fit adds more. */
	.terminal {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		height: 100%;
	}
	.terminal-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		min-height: var(--control-h-sm);
	}
	.terminal-status {
		margin: 0;
		margin-inline-end: auto;
		min-width: 0;
	}
	/* Status lines can be a sentence ("Connected as root on Linux.") */
	.terminal-status :global(.status) {
		white-space: normal;
	}
	/* Dark in both themes, like a real terminal */
	.terminal-box {
		flex: 1 1 auto;
		height: 360px;
		min-height: 360px;
		overflow: hidden;
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: #111414;
		color: #e3e6e6;
		font-family: var(--mono);
		font-size: var(--text-sm);
	}
	.terminal-box:focus-within {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.terminal-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
