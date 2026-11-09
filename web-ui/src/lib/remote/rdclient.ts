/**
 * The remote desktop client: the protocol, video, audio, input, clipboard
 * and file transfer code of the old console (public/js/rdclient, about
 * 16,700 lines of classic scripts that set globals), kept unchanged in
 * web-ui/static/rdclient and loaded here in the order the old viewer
 * layout used. This module is the typed edge around it: it sets the
 * globals those scripts read, loads them once, and hands out clients.
 *
 * The dev-only mock device (/dev/mock-remote.js) loads only when the
 * viewer's data says the server has it on (BD_DEV_MOCK_REMOTE=1 and
 * ?mock=1); without the flag Express answers 404 for the script and the
 * viewer data has no mock.
 */

import { asset } from '$app/paths';
import { version } from '$app/env';
import { t } from '#lib/i18n/i18n.svelte.ts';
import { installCapabilities } from './capabilities.ts';
import type { ViewerCapabilities } from './access.ts';
import type { Transport } from './states.ts';

/** Load order of public/js/rdclient (views/layouts/viewer.ejs): later scripts use earlier globals */
export const RDCLIENT_SCRIPTS = [
	'vendor/protobuf.min.js',
	'generated/protos-static.js',
	'vendor/nacl.min.js',
	'vendor/nacl-util.min.js',
	'vendor/jmuxer.min.js',
	'connection.js',
	'connection-params.js',
	'punchhole-response.js',
	'crypto.js',
	'protocol.js',
	'video.js',
	'audio.js',
	'renderer.js',
	'keyboard-scancode.js',
	'keyboard-encoder.js',
	'input.js',
	'touch.js',
	'file-connection.js',
	'local-files.js',
	'desktop-dnd.js',
	'compress.js',
	'clipboard.js',
	'cliprdr.js',
	'filetransfer.js',
	'file-modal.js',
	'client.js',
	'cdap-audio.js',
	'cdap-filetransfer.js',
	'cdap-adapter.js',
	'betterviewer.js',
	'mesh-files.js',
	'mesh-adapter.js',
	'remote-target.js'
] as const;

export const MOCK_SCRIPT = '/dev/mock-remote.js';

/* ── The client's surface (RDClient; CDAPSession, MeshSession, RemoteTargetSession and the mock copy it) ── */

export interface Monitor {
	idx: number;
	name: string;
	width: number;
	height: number;
	primary: boolean;
	current: boolean;
}

export interface VirtualDisplaySupport {
	supported: boolean;
	impl?: string;
	rustdeskDisplays?: number[];
	amyuniCount?: number;
}

export interface WindowsSessions {
	sessions: { sid: number; name: string }[];
	currentSid: number;
}

export interface ClientStats {
	video?: { codec?: string; currentCodec?: string };
	renderer?: { fps?: number; remoteWidth?: number; remoteHeight?: number };
}

export interface RemoteClient {
	readonly state?: string;
	readonly _state?: string;
	viewOnly?: boolean;
	renderer: { resize(): void };
	video?: { onAutoplayBlocked?: (() => void) | null; retryPlay?(): void };
	audio?: { audioCtx?: AudioContext | null };
	input?: {
		sendMessage?(msg: unknown): void;
		_handleKeyDown?(e: KeyboardEvent): void;
		_handleKeyUp?(e: KeyboardEvent): void;
		resetKeyboard?(): void;
	};
	fileTransfer?: unknown;
	on(event: string, fn: (...args: never[]) => void): unknown;
	connect(): Promise<unknown>;
	disconnect(): void;
	authenticate(password: string): unknown;
	submit2FA(code: string): void;
	sendChat(text: string): void;
	sendCtrlAltDel(): void;
	sendLockScreen(): void;
	sendRestartRemoteDevice(): void;
	sendRefreshScreen(): void;
	sendClipboard(text: string): void;
	sendText?(text: string): boolean | undefined;
	resetKeyboard?(): void;
	setBlockInput(on: boolean): void;
	setQualityPreset(preset: string): void;
	setFpsMode?(mode: string): void;
	setKeyboardMode?(mode: string): void;
	setScaleMode(mode: string): void;
	setCodec(codec: string): void;
	setShowRemoteCursor(on: boolean): void;
	setLockAfterSession(on: boolean): void;
	setPrivacyMode(on: boolean): void;
	setDisableClipboard(on: boolean): void;
	setViewOnly(on: boolean): void;
	setAudioMuted(muted: boolean): void;
	setBackgroundFps?(fps: number): void;
	setSessionActive?(active: boolean): void;
	getMonitors(): Monitor[];
	switchMonitor(idx: number): void;
	getVirtualDisplaySupport?(): VirtualDisplaySupport;
	toggleVirtualDisplay(index: number, on: boolean): void;
	getWindowsSessions?(): WindowsSessions;
	selectWindowsSession(sid: number): void;
	getStats?(): ClientStats;
}

export interface ClientOptions {
	deviceId: string;
	serverPubKey: string;
	connection: Record<string, unknown> | null;
	myName: string;
	scaleMode: string;
	fps: number;
	fpsMode: string;
	imageQuality: string;
	qualityPreset: string;
	adaptiveQuality: boolean;
	preferCodec: string;
	disableAudio: boolean;
	serverRecord: boolean;
}

type ClientCtor = new (canvas: HTMLCanvasElement, opts: ClientOptions) => RemoteClient;

export interface FileSheet {
	open(session: unknown): void;
	close(): void;
	isOpen(): boolean;
	_session?: { deviceId?: string } | null;
	_el?: HTMLElement | null;
}

export interface TouchInput {
	setMode(mode: string): void;
	start(): void;
	stop(): void;
}
type TouchCtor = new (
	canvas: HTMLCanvasElement,
	renderer: unknown,
	send: (msg: unknown) => void
) => TouchInput;

interface RdWindow {
	BetterDesk?: Record<string, unknown>;
	t?: (key: string) => string;
	__capabilities?: ViewerCapabilities;
	__guestToken?: string;
	__initialDeviceId?: string;
	__mockRemote?: { scenario: string } | null;
	RDClient?: ClientCtor;
	CDAPSession?: ClientCtor;
	MeshSession?: ClientCtor;
	RemoteTargetSession?: ClientCtor;
	MockRemoteSession?: ClientCtor;
	RDVideo?: { isSupported(): boolean };
	__fileTransferModal?: FileSheet | null;
}

const w = () => window as unknown as RdWindow;

export interface LoadOptions {
	deviceId: string;
	capabilities: ViewerCapabilities;
	guestToken: string;
	csrfToken: string;
	/** Set only when the server has the dev mock on for this request */
	mock: { scenario: string } | null;
}

/** Add one classic script; scripts added with async=false run in the order they were added */
function addScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const el = document.createElement('script');
		el.src = src;
		el.async = false;
		el.dataset.rdclient = '';
		el.onload = () => resolve();
		el.onerror = () => reject(new Error(`Could not load ${src}`));
		document.head.appendChild(el);
	});
}

/** The URL of a wrapped script (cache-busted per console build) */
export function scriptUrl(file: (typeof RDCLIENT_SCRIPTS)[number]): string {
	return `${asset(`rdclient/${file}`)}?v=${encodeURIComponent(version)}`;
}

/** The globals the wrapped scripts read before and while they run */
export function setGlobals(opts: LoadOptions): void {
	installCapabilities();
	const win = w();
	win.BetterDesk = { ...(win.BetterDesk ?? {}), csrfToken: opts.csrfToken, t };
	// file-modal.js, cdap and mesh code translate through window.t (key back when missing)
	win.t = (key: string) => t(key);
	win.__capabilities = opts.capabilities;
	win.__guestToken = opts.guestToken;
	win.__initialDeviceId = opts.deviceId;
	win.__mockRemote = opts.mock;
}

let loading: Promise<void> | null = null;

/** Load the client once per page; the mock script only when `mock` is set */
export function loadRdClient(opts: LoadOptions): Promise<void> {
	setGlobals(opts);
	loading ??= Promise.all([
		...RDCLIENT_SCRIPTS.map((f) => addScript(scriptUrl(f))),
		...(opts.mock ? [addScript(MOCK_SCRIPT)] : [])
	]).then(
		() => undefined,
		(err: unknown) => {
			loading = null;
			for (const el of document.head.querySelectorAll('script[data-rdclient]')) el.remove();
			throw err;
		}
	);
	return loading;
}

/** The client for a transport (RDClient for RustDesk peers; the mock replaces all of them) */
export function createClient(
	canvas: HTMLCanvasElement,
	opts: ClientOptions,
	transport: Transport
): RemoteClient {
	const win = w();
	const Ctor: ClientCtor | undefined =
		win.__mockRemote && win.MockRemoteSession
			? win.MockRemoteSession
			: transport === 'mesh' && win.MeshSession
				? win.MeshSession
				: transport === 'cdap' && win.CDAPSession
					? win.CDAPSession
					: (transport === 'rdp' || transport === 'vnc') && win.RemoteTargetSession
						? win.RemoteTargetSession
						: win.RDClient;
	if (!Ctor) throw new Error('Remote client not loaded');
	return new Ctor(canvas, opts);
}

/** WebCodecs decoding (needs a secure context); without it the client falls back to slower H.264 */
export function videoDecodingSupported(): boolean {
	return w().RDVideo?.isSupported() ?? true;
}

/** The file transfer sheet of the wrapped client (public/js/rdclient/file-modal.js) */
export function fileSheet(): FileSheet | null {
	return w().__fileTransferModal ?? null;
}

/** RDTouch is a top-level class of touch.js (a global binding, not a window property) */
export function touchInput(): TouchCtor | null {
	try {
		return typeof RDTouch === 'function' ? (RDTouch as TouchCtor) : null;
	} catch {
		return null;
	}
}

declare const RDTouch: unknown;
