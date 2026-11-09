/**
 * The remote viewer's sessions: one tab per device, each with its own
 * client (RDClient, CDAP, mesh, RDP/VNC gateway or the dev mock), its
 * connection state in plain words, its chat and its viewer settings. Port
 * of the session manager in public/js/remote.js; the page components
 * render this state and call these methods.
 *
 * The clients are the wrapped legacy scripts (rdclient.ts); nothing here
 * puts them into $state (they are large mutable objects with their own
 * timers), only what the page shows.
 */

import { tick } from 'svelte';
import { formatDate } from '#lib/i18n/format.ts';
import { tf } from '#lib/i18n/i18n.svelte.ts';
import { toast } from '#lib/ui/toasts.svelte.ts';
import { confirm } from '#lib/ui/dialogs.svelte.ts';
import {
	acceptCertificate,
	getBillingCheck,
	getConnectPassword,
	getPendingBillingSession,
	submitWorkReport,
	type BillingCheck,
	type PendingBillingSession,
	type ViewerData
} from '#lib/api/remote.ts';
import { getDevice } from '#lib/api/devices.ts';
import { isGuestMode, isRemoteTargetId, isViewOnlyGuest, peerAllowed, transportOf } from './access.ts';
import { isMobileViewer } from './capabilities.ts';
import {
	createClient,
	fileSheet,
	touchInput,
	videoDecodingSupported,
	type ClientOptions,
	type Monitor,
	type RemoteClient,
	type TouchInput,
	type VirtualDisplaySupport,
	type WindowsSessions
} from './rdclient.ts';
import { fpsForMode, loadPrefs, presetForQuality, savePrefs, type ViewerPrefs } from './prefs.ts';
import { secureStore } from './secure-store.ts';
import {
	classifyEnd,
	detailRows,
	detailsText,
	endOutcome,
	isStep,
	loginErrorText,
	SLOW_AFTER_MS,
	stepAdvances,
	stepFromLog,
	stepText,
	type CloseMeta,
	type EndInfo,
	type Outcome,
	type StepId,
	type Transport,
	type View
} from './states.ts';

export type SheetName = 'chat' | 'files' | 'info';

/** The controls that open each sheet (focus goes back there when it closes; file-modal.js marks btn-file-transfer) */
export const SHEET_BUTTONS: Record<SheetName, string> = {
	chat: 'rd-btn-chat',
	files: 'btn-file-transfer',
	info: 'rd-btn-info'
};

export interface ChatLine {
	id: number;
	text: string;
	type: 'sent' | 'received';
}

export interface Toggles {
	showCursor: boolean;
	lockAfter: boolean;
	privacy: boolean;
	disableClipboard: boolean;
	blockInput: boolean;
}

export interface BillingPane {
	session: PendingBillingSession;
	summary: string;
	error: string;
	busy: boolean;
}

/** Hooks a session panel gives the viewer to move focus inside it */
export interface PanelFocus {
	canvas(): void;
	password(): void;
	tfa(): void;
	reconnect(): void;
	summary(): void;
}

let chatSeq = 0;

export class ViewerSession {
	readonly deviceId: string;
	deviceName = $state('');
	platform = $state('');
	/** What the panel shows */
	view = $state<View>('connecting');
	/** The transport's own state word */
	state = $state('idle');
	stepId = $state<StepId | null>(null);
	slowHint = $state('');
	statusText = $state('');
	tryText = $state('');
	outcomeKind = $state('');
	endInfo = $state.raw<EndInfo | null>(null);
	endedBy = $state<'' | 'user' | 'cancel'>('');
	everStreamed = $state(false);
	connectedAt = $state<number | null>(null);
	lastError = $state('');
	encryptionWarning = $state('');
	banner = $state.raw<{ message: string; level: 'warning' | 'error' } | null>(null);
	loginError = $state('');
	tfaError = $state('');
	password = $state('');
	remember = $state(false);
	tfaCode = $state('');
	cdapFallback = $state(false);
	autoplayBlocked = $state(false);
	audioMuted = $state(false);
	recording = $state(false);
	meshServerRecord = $state(false);
	viewOnly = $state(false);
	chat = $state.raw<ChatLine[]>([]);
	latency = $state(0);
	monitors = $state.raw<Monitor[]>([]);
	virtualDisplays = $state.raw<VirtualDisplaySupport>({ supported: false });
	windowsSessions = $state.raw<WindowsSessions>({ sessions: [], currentSid: 0 });
	prefs = $state<ViewerPrefs>(loadPrefs(null));
	toggles = $state<Toggles>({
		showCursor: true,
		lockAfter: false,
		privacy: false,
		disableClipboard: false,
		blockInput: false
	});
	billing = $state.raw<BillingPane | null>(null);
	/** Bumped when the stats sheet should re-read the client */
	statsTick = $state(0);

	client: RemoteClient | null = null;
	canvas: HTMLCanvasElement | null = null;
	focus: PanelFocus | null = null;
	closed = false;
	started = false;
	slowTimer: ReturnType<typeof setTimeout> | null = null;
	endTimer: ReturnType<typeof setTimeout> | null = null;
	mediaRecorder: MediaRecorder | null = null;
	recordedChunks: Blob[] = [];
	touch: TouchInput | null = null;

	constructor(deviceId: string, name: string, platform: string, prefs: ViewerPrefs) {
		this.deviceId = deviceId;
		this.deviceName = name && name !== deviceId ? name : '';
		this.platform = platform;
		this.prefs = { ...prefs };
	}

	get label(): string {
		return this.deviceName || this.deviceId;
	}

	get streaming(): boolean {
		return this.view === 'streaming';
	}
}

export interface ViewerOptions {
	data: ViewerData;
	/** Leave the viewer (no sessions left, or Back) */
	onleave: () => void;
}

export class Viewer {
	sessions = $state.raw<ViewerSession[]>([]);
	activeId = $state<string | null>(null);
	sheet = $state<SheetName | null>(null);
	controlsOpen = $state(false);
	keepOpen = $state(false);
	pickerOpen = $state(false);
	fullscreen = $state(false);
	httpWarning = $state(false);
	billingCheck = $state.raw<BillingCheck | null>(null);
	mobileMode = $state<'direct' | 'touchpad'>('direct');

	readonly data: ViewerData;
	readonly transport: Transport;
	readonly guest: boolean;
	readonly viewOnlyGuest: boolean;
	readonly userId: string | number | null;
	private onleave: () => void;
	private lastClipboard = '';
	private clipboardGranted: boolean | null = null;
	private openFilesOnConnect = false;

	constructor(opts: ViewerOptions) {
		this.data = opts.data;
		this.transport = transportOf(opts.data.capabilities);
		this.guest = isGuestMode(opts.data.capabilities);
		this.viewOnlyGuest = isViewOnlyGuest(opts.data.capabilities);
		this.userId = opts.data.user?.id ?? null;
		this.onleave = opts.onleave;
	}

	get active(): ViewerSession | null {
		return this.sessions.find((s) => s.deviceId === this.activeId) ?? null;
	}

	/** Controls and Full screen show only while the active tab shows a picture */
	get chromeVisible(): boolean {
		return this.active?.view === 'streaming';
	}

	get controlsShown(): boolean {
		return this.chromeVisible && (this.controlsOpen || this.keepOpen);
	}

	isActive(s: ViewerSession): boolean {
		return s.deviceId === this.activeId;
	}

	connectedIds(): string[] {
		return this.sessions.map((s) => s.deviceId);
	}

	/* ── Opening and closing tabs ── */

	/** A new tab (or the existing one) for a device */
	open(deviceId: string, name = '', platform = '', opts: { filesOnConnect?: boolean } = {}): void {
		if (!peerAllowed(this.data.capabilities, this.data.deviceId, deviceId)) {
			console.warn('Guest access: refused session outside allowlist', deviceId);
			return;
		}
		const existing = this.sessions.find((s) => s.deviceId === deviceId);
		if (existing) {
			this.switchTo(deviceId);
			return;
		}
		if (opts.filesOnConnect) this.openFilesOnConnect = true;
		const s = new ViewerSession(deviceId, name, platform, loadPrefs(this.userId));
		if (!videoDecodingSupported()) {
			const insecure =
				location.protocol === 'http:' &&
				location.hostname !== 'localhost' &&
				location.hostname !== '127.0.0.1';
			if (insecure) this.httpWarning = true;
		}
		this.sessions = [...this.sessions, s];
		this.switchTo(deviceId);
		void this.loadDetails(s);
	}

	/** The panel's canvas is in the page: start connecting */
	attach(s: ViewerSession, canvas: HTMLCanvasElement): void {
		s.canvas = canvas;
		if (s.started || s.closed) return;
		s.started = true;
		this.startConnecting(s);
		this.connectClient(s);
	}

	private connectClient(s: ViewerSession): void {
		const c = s.client;
		if (!c) return;
		try {
			c.renderer.resize();
		} catch {
			/* not ready */
		}
		c.connect().catch((err: unknown) => {
			if (s.client === c) this.fail(s, err instanceof Error ? err.message : '');
		});
	}

	/** Name and system for tabs opened from the picker or a link */
	private async loadDetails(s: ViewerSession): Promise<void> {
		if (this.guest || isRemoteTargetId(s.deviceId)) return;
		if (s.platform && s.deviceName) return;
		try {
			const d = await getDevice(s.deviceId);
			if (s.closed) return;
			const r = d as Record<string, unknown>;
			const name = String(r.display_name || r.hostname || '');
			if (!s.deviceName && name) s.deviceName = name;
			if (!s.platform) s.platform = String(r.platform || r.os || '');
			if (s.view === 'connecting' && s.stepId) this.setStep(s, s.stepId, true);
		} catch {
			/* the ID is enough to connect */
		}
	}

	switchTo(deviceId: string): void {
		const s = this.sessions.find((x) => x.deviceId === deviceId);
		if (!s) return;
		const previous = this.activeId;
		this.activeId = deviceId;
		// Files belong to one session; chat and info follow the tab
		if (previous !== deviceId && this.sheet === 'files') this.closeSheet();
		if (s.view === 'streaming') {
			void tick().then(() => {
				s.focus?.canvas();
				this.resize();
			});
			s.client?.setAudioMuted(s.audioMuted);
			this.applyPrefs(s);
		}
		this.syncMediaCapture();
		this.syncTouch();
		void this.refreshBilling(deviceId);
	}

	close(deviceId: string, opts: { suppressLeave?: boolean } = {}): void {
		const s = this.sessions.find((x) => x.deviceId === deviceId);
		if (!s) return;
		s.closed = true;
		this.clearStepTimer(s);
		if (s.endTimer) clearTimeout(s.endTimer);
		try {
			s.client?.disconnect();
		} catch {
			/* gone already */
		}
		const files = fileSheet();
		if (files?.isOpen() && files._session && (files._session as { deviceId?: string }).deviceId === deviceId)
			files.close();
		if (s.mediaRecorder?.state === 'recording') {
			try {
				s.mediaRecorder.stop();
			} catch {
				/* stopped */
			}
		}
		s.touch?.stop();
		const index = this.sessions.indexOf(s);
		this.sessions = this.sessions.filter((x) => x !== s);
		if (this.activeId === deviceId) {
			this.activeId = null;
			const next = this.sessions[index] ?? this.sessions[index - 1] ?? this.sessions[0];
			if (next) this.switchTo(next.deviceId);
			else {
				this.closeSheet();
				if (!opts.suppressLeave) this.onleave();
			}
		} else this.syncMediaCapture();
	}

	closeAll(): void {
		for (const s of [...this.sessions]) this.close(s.deviceId, { suppressLeave: true });
	}

	/** Disconnect every session when the page goes away (not into the back-forward cache) */
	teardown(): void {
		for (const s of this.sessions) {
			try {
				s.client?.disconnect();
			} catch {
				/* gone */
			}
			if (s.mediaRecorder?.state === 'recording') {
				try {
					s.mediaRecorder.stop();
				} catch {
					/* stopped */
				}
			}
		}
	}

	reconnect(s: ViewerSession): void {
		const old = s.client;
		s.client = null;
		try {
			old?.disconnect();
		} catch {
			/* gone */
		}
		s.cdapFallback = false;
		s.billing = null;
		s.autoplayBlocked = false;
		this.startConnecting(s);
		this.connectClient(s);
	}

	cancel(s: ViewerSession): void {
		s.endedBy = 'cancel';
		try {
			s.client?.disconnect();
		} catch {
			/* gone */
		}
		// Transports that do not report the state change still end here
		if (s.view !== 'ended') this.finishEnd(s);
	}

	/** Disconnect (controls row): the session ends by you */
	disconnect(): void {
		const s = this.active;
		if (!s?.client) return;
		s.endedBy = 'user';
		s.client.disconnect();
	}

	/* ── Connecting ── */

	private clientOptions(s: ViewerSession): ClientOptions {
		const p = s.prefs;
		return {
			deviceId: s.deviceId,
			serverPubKey: this.data.serverPubKey,
			connection: this.data.connection,
			myName: this.data.user?.name || 'BetterDesk Web',
			scaleMode: p.scale,
			fps: fpsForMode(p.fpsMode, p.quality),
			fpsMode: p.fpsMode,
			imageQuality: p.quality,
			qualityPreset: presetForQuality(p.quality),
			adaptiveQuality: p.fpsMode === 'adaptive' && p.adaptiveQuality !== false,
			preferCodec: p.codec || 'Auto',
			disableAudio: false,
			serverRecord: s.meshServerRecord
		};
	}

	/** A fresh client and the connecting screen at step one */
	private startConnecting(s: ViewerSession): void {
		s.state = 'connecting';
		s.everStreamed = false;
		s.connectedAt = null;
		s.endedBy = '';
		s.endInfo = null;
		s.lastError = '';
		s.encryptionWarning = '';
		s.banner = null;
		s.loginError = '';
		s.tfaError = '';
		if (!s.canvas) return;
		s.client = createClient(s.canvas, this.clientOptions(s), this.transport);
		s.client.setBackgroundFps?.(s.prefs.backgroundFps || 1);
		s.viewOnly = !!s.client.viewOnly;
		this.wire(s, s.client);
		this.attachTouch(s);
		this.showView(s, 'connecting');
		this.setStep(s, 'find', true);
	}

	private wire(s: ViewerSession, c: RemoteClient): void {
		// Events from a client this session has replaced (reconnect) or closed are ignored
		const live = () => s.client === c && !s.closed;
		const on = <A extends unknown[]>(event: string, fn: (...args: A) => void) =>
			c.on(event, ((...args: A) => {
				if (live()) fn(...args);
			}) as unknown as (...args: never[]) => void);

		on('state', (state: string) => {
			s.state = String(state);
			this.handleState(s, s.state);
		});
		on('log', (msg: unknown) => {
			if (s.view !== 'connecting') return;
			const step = stepFromLog(msg);
			if (step) this.setStep(s, step);
		});
		on('step', (step: unknown) => {
			if (s.view === 'connecting' && isStep(step)) this.setStep(s, step);
		});
		on('error', (msg: unknown, meta?: CloseMeta) => {
			const text =
				msg && typeof msg === 'object'
					? String((msg as { message?: string }).message ?? '')
					: String(msg ?? '');
			this.fail(s, text, meta);
			if (meta?.cdapFallback) s.cdapFallback = true;
		});
		on('cdap_fallback_available', () => {
			s.cdapFallback = true;
		});
		on('disconnected', (reason: unknown, info?: CloseMeta) => {
			// A failure already on screen keeps its own message
			if (s.view === 'failed') return;
			s.endInfo = {
				reason: typeof reason === 'string' ? reason : '',
				meta: info ?? null,
				at: Date.now(),
				step: s.stepId
			};
			this.finishEnd(s);
			s.autoplayBlocked = false;
		});
		on('password_required', () => {
			this.setStep(s, 'signin');
			this.showView(s, 'password');
			s.loginError = '';
			s.password = '';
			const local = secureStore()
				.loadPeerPassword(s.deviceId)
				.catch(() => '');
			const org = this.data.mockRemote ? Promise.resolve('') : getConnectPassword(s.deviceId);
			void Promise.all([local, org]).then(([mine, theirs]) => {
				const saved = mine || theirs || '';
				if (saved) {
					s.password = saved;
					s.remember = true;
				}
				if (this.isActive(s)) void tick().then(() => s.focus?.password());
			});
		});
		on('login_error', (error: unknown) => {
			if (s.state === 'waiting_2fa' || s.view === 'tfa') {
				s.tfaError = String(error ?? '');
				s.tfaCode = '';
				if (this.isActive(s)) void tick().then(() => s.focus?.tfa());
				return;
			}
			this.showView(s, 'password');
			s.loginError = loginErrorText(error);
			s.password = '';
			if (this.isActive(s)) void tick().then(() => s.focus?.password());
		});
		on('certificate_required', (details?: { fingerprint?: string }) => {
			const fingerprint = String(details?.fingerprint ?? '');
			if (fingerprint) void this.trustCertificate(s, c, fingerprint);
		});
		on('2fa_error', (error: unknown) => {
			this.showView(s, 'tfa');
			s.tfaError = String(error || tf('remote.2fa_invalid', 'Invalid code'));
			s.tfaCode = '';
			if (this.isActive(s)) void tick().then(() => s.focus?.tfa());
		});
		on('2fa_required', () => {
			this.setStep(s, 'signin');
			this.showView(s, 'tfa');
			s.tfaError = '';
			s.tfaCode = '';
			if (this.isActive(s)) void tick().then(() => s.focus?.tfa());
		});
		on('login_success', () => {
			if (s.view === 'password' || s.view === 'tfa') this.showView(s, 'connecting');
			this.setStep(s, 'screen');
			const pw = s.password;
			if (s.remember && pw)
				void secureStore()
					.savePeerPassword(s.deviceId, pw)
					.catch(() => {});
			else if (!s.remember)
				void secureStore()
					.clearPeerPassword(s.deviceId)
					.catch(() => {});
		});
		on('session_start', () => {
			this.showView(s, 'streaming');
			this.resize();
			if (this.isActive(s)) this.applyPrefs(s);
			this.syncMediaCapture();
			if (this.isActive(s)) {
				void tick().then(() => s.focus?.canvas());
				this.refreshMonitors(s);
			}
			if (c.video)
				c.video.onAutoplayBlocked = () => {
					if (this.isActive(s)) s.autoplayBlocked = true;
				};
			if (this.openFilesOnConnect && this.isActive(s)) {
				this.openFilesOnConnect = false;
				void tick().then(() => this.openSheet('files'));
			}
		});
		on('stats', () => {
			s.statsTick++;
		});
		on('diagnostics', () => {
			/* window.BetterDesk.debugRelay logs them in the client */
		});
		on('latency', (rtt: unknown) => {
			s.latency = Number(rtt) || 0;
		});
		on('chat', (text: unknown) => this.addChat(s, String(text ?? ''), 'received'));
		// CDAP: the agent lists its monitors; RustDesk: peer_info after sign-in
		on('monitors', () => this.refreshMonitors(s));
		on('peer_info', (info?: { platform?: string; os?: string }) => {
			if (info && !s.platform && (info.platform || info.os)) s.platform = String(info.platform || info.os);
			this.refreshMonitors(s);
		});
		on('display_switched', () => this.refreshMonitors(s));
		on('virtual_display_toggled', () => this.refreshMonitors(s));
		// End-to-end encryption problems: a warning over the screen and in Session info
		on('signature_warning', (msg: unknown) => {
			console.warn('[Remote] Signature warning:', msg);
			s.encryptionWarning = String(msg ?? '');
			s.banner = { message: String(msg ?? ''), level: 'warning' };
		});
		on('encryption_warning', (msg: unknown) => {
			console.warn('[Remote] Encryption warning:', msg);
			s.encryptionWarning = String(msg ?? '');
			s.banner = { message: String(msg ?? ''), level: 'error' };
		});
	}

	private async trustCertificate(s: ViewerSession, c: RemoteClient, fingerprint: string): Promise<void> {
		const ok = await confirm({
			title: tf('remote.certificate_title', 'Untrusted certificate'),
			message: tf(
				'remote.certificate_confirm',
				'The certificate of {name} is not trusted. Trust the certificate with the fingerprint {fingerprint}?',
				{ name: s.label, fingerprint }
			),
			confirmLabel: tf('remote.certificate_trust', 'Trust certificate')
		});
		if (!ok || s.client !== c) return;
		try {
			await acceptCertificate(s.deviceId, fingerprint);
			c.disconnect();
			void c.connect();
		} catch (err) {
			this.fail(s, err instanceof Error ? err.message : 'Certificate was not trusted');
		}
	}

	private handleState(s: ViewerSession, state: string): void {
		switch (state) {
			case 'connecting':
				if (s.view !== 'connecting') this.showView(s, 'connecting');
				break;
			case 'waiting_password':
				// The client waits for the device's answer (a password request, or someone accepting)
				if (s.view === 'connecting') this.setStep(s, 'accept');
				break;
			case 'authenticating':
			case 'waiting_2fa':
				if (s.view === 'connecting') this.setStep(s, 'signin');
				break;
			case 'streaming':
				s.everStreamed = true;
				if (!s.connectedAt) s.connectedAt = Date.now();
				this.showView(s, 'streaming');
				this.syncMediaCapture();
				this.attachTouch(s);
				this.syncTouch();
				break;
			case 'disconnected':
			case 'error':
				if (state === 'error') {
					// The error event came first and already said what happened
					if (s.view !== 'failed') this.fail(s, s.lastError || '');
					break;
				}
				if (s.view === 'failed' || s.view === 'ended') break;
				// The client sends the reason right after this state; wait one tick for it
				if (s.endTimer) clearTimeout(s.endTimer);
				s.endTimer = setTimeout(() => this.finishEnd(s), 0);
				break;
		}
	}

	setStep(s: ViewerSession, id: StepId, force = false): void {
		if (!force && !stepAdvances(s.stepId, id)) return;
		s.stepId = id;
		if (s.view !== 'connecting') return;
		s.statusText = stepText(id, s.label, this.transport).now;
		s.slowHint = '';
		this.clearStepTimer(s);
		s.slowTimer = setTimeout(() => {
			if (s.closed || s.view !== 'connecting' || s.stepId !== id) return;
			s.slowHint = stepText(id, s.label, this.transport).slow;
		}, SLOW_AFTER_MS);
	}

	private clearStepTimer(s: ViewerSession): void {
		if (s.slowTimer) clearTimeout(s.slowTimer);
		s.slowTimer = null;
	}

	private showView(s: ViewerSession, view: View): void {
		s.view = view;
		if (view !== 'connecting') {
			this.clearStepTimer(s);
			s.slowHint = '';
		}
		if (view === 'connecting') {
			s.tryText = '';
			s.outcomeKind = '';
		}
		if (view !== 'streaming' && this.isActive(s)) {
			if (!this.keepOpen) this.controlsOpen = false;
		}
	}

	/** Failed before or while connecting: what happened, what to try, details */
	fail(s: ViewerSession, reason: string, meta?: CloseMeta | null): void {
		if (s.closed) return;
		s.lastError = reason || s.lastError || '';
		s.endInfo = { reason: s.lastError, meta: meta ?? null, at: Date.now(), step: s.stepId };
		if (s.endedBy) {
			this.finishEnd(s);
			return;
		}
		this.showResult(s, classifyEnd(s.lastError, meta, { name: s.label, everStreamed: s.everStreamed }));
	}

	/** The connection closed: ended by you, by the device, or failed on the way */
	private finishEnd(s: ViewerSession): void {
		if (s.closed) return;
		if (s.endTimer) {
			clearTimeout(s.endTimer);
			s.endTimer = null;
		}
		const end = s.endInfo ?? { reason: '', meta: null, at: Date.now(), step: s.stepId };
		s.endInfo = end;
		this.showResult(
			s,
			endOutcome(s.endedBy, end.reason, end.meta, { name: s.label, everStreamed: s.everStreamed })
		);
		if (s.everStreamed && this.data.workReports) void this.promptWorkReport(s);
	}

	private showResult(s: ViewerSession, info: Outcome): void {
		this.clearStepTimer(s);
		this.showView(s, info.ended ? 'ended' : 'failed');
		s.statusText = info.text;
		s.tryText = info.tryText;
		s.outcomeKind = info.kind;
		this.syncMediaCapture();
		// Keyboard users land on Reconnect; focus elsewhere in the page stays put
		const focused = document.activeElement;
		if (this.isActive(s) && (!focused || focused === document.body || focused === s.canvas))
			void tick().then(() => s.focus?.reconnect());
	}

	details(s: ViewerSession): [string, string][] {
		return detailRows(s.endInfo, {
			deviceId: s.deviceId,
			name: s.label,
			transport: this.transport,
			lastError: s.lastError,
			formatTime: (d) => formatDate(d, { second: '2-digit' })
		});
	}

	detailsText(s: ViewerSession): string {
		return detailsText(s.label, s.deviceId, s.statusText, this.details(s));
	}

	authenticate(s: ViewerSession): void {
		if (!s.password) {
			s.focus?.password();
			return;
		}
		s.loginError = '';
		void s.client?.authenticate(s.password);
	}

	verifyCode(s: ViewerSession): void {
		const code = s.tfaCode.replace(/\s/g, '');
		if (code.length !== 6) {
			s.tfaError = tf('remote.2fa_invalid', 'Enter a valid 6-digit code');
			s.focus?.tfa();
			return;
		}
		s.tfaError = '';
		s.client?.submit2FA(code);
	}

	/* ── Work report after a billed session ── */

	private async promptWorkReport(s: ViewerSession): Promise<void> {
		await new Promise((r) => setTimeout(r, 1200));
		let pending: PendingBillingSession | null = null;
		for (let i = 0; i < 5 && !s.closed; i++) {
			pending = await getPendingBillingSession(s.deviceId);
			if (pending) break;
			await new Promise((r) => setTimeout(r, 800));
		}
		if (!pending || s.closed || s.view === 'streaming' || s.view === 'connecting') return;
		s.billing = { session: pending, summary: '', error: '', busy: false };
		if (this.isActive(s)) void tick().then(() => s.focus?.summary());
	}

	skipWorkReport(s: ViewerSession): void {
		s.billing = null;
	}

	async submitWorkReport(s: ViewerSession): Promise<void> {
		const pane = s.billing;
		if (!pane || pane.busy) return;
		const summary = pane.summary.trim();
		if (!summary) {
			s.billing = { ...pane, error: tf('commercialization.report.summary_required', 'Summary is required') };
			return;
		}
		s.billing = { ...pane, busy: true, error: '' };
		try {
			await submitWorkReport(pane.session.id, summary);
			s.billing = null;
			toast.success(tf('commercialization.report.saved', 'Work report saved'));
		} catch (err) {
			s.billing = { ...pane, busy: false, error: err instanceof Error ? err.message : 'Error' };
		}
	}

	setReportSummary(s: ViewerSession, summary: string): void {
		if (s.billing) s.billing = { ...s.billing, summary };
	}

	async refreshBilling(deviceId: string): Promise<void> {
		if (this.guest) return;
		const check = await getBillingCheck(deviceId);
		if (this.activeId === deviceId) this.billingCheck = check;
	}

	/** Work report (controls row): the form opens when the session ends */
	markReportIntent(): void {
		const s = this.active;
		if (!s) return;
		try {
			sessionStorage.setItem(`bd-billing-report-intent:${s.deviceId}`, '1');
		} catch {
			/* storage blocked */
		}
		toast.info(tf('commercialization.report.intent_hint', 'Report form will open when the session ends'));
	}

	/* ── Controls ── */

	private withClient(fn: (c: RemoteClient, s: ViewerSession) => void): void {
		const s = this.active;
		if (s?.client) fn(s.client, s);
	}

	focusScreen(): void {
		const s = this.active;
		if (s?.view === 'streaming') s.focus?.canvas();
	}

	ctrlAltDel(): void {
		this.withClient((c) => c.sendCtrlAltDel());
		this.focusScreen();
	}

	lockScreen(): void {
		this.withClient((c) => c.sendLockScreen());
		this.focusScreen();
	}

	async restartRemote(): Promise<void> {
		const s = this.active;
		if (!s?.client) return;
		const ok = await confirm({
			title: tf('remote.restart_remote', 'Restart remote device'),
			message: tf('remote.confirm_restart', 'Restart the remote device?'),
			confirmLabel: tf('remote.restart_remote', 'Restart remote device'),
			danger: true
		});
		if (ok && s.client) s.client.sendRestartRemoteDevice();
	}

	refreshScreen(): void {
		this.withClient((c) => c.sendRefreshScreen());
		this.focusScreen();
	}

	resetKeyboard(): void {
		this.withClient((c) => {
			if (typeof c.resetKeyboard === 'function') c.resetKeyboard();
			else c.input?.resetKeyboard?.();
		});
		toast.success(tf('remote.reset_keyboard_done', 'Keyboard state reset on remote'));
		this.focusScreen();
	}

	async pasteClipboard(): Promise<void> {
		const s = this.active;
		if (!s?.client) return;
		if (s.client.viewOnly) {
			toast.warning(tf('remote.view_only', 'View only mode'));
			return;
		}
		try {
			const text = await navigator.clipboard.readText();
			if (text) s.client.sendClipboard(text);
			else toast.warning(tf('remote.clipboard_empty', 'Clipboard is empty'));
		} catch {
			toast.error(
				tf('remote.clipboard_denied', 'Clipboard access denied. HTTPS required or permission not granted.')
			);
		}
	}

	/** Type text (controls row): keystrokes for login screens and password fields; true when sent */
	typeText(text: string): boolean {
		const s = this.active;
		if (!s?.client) return false;
		if (s.client.viewOnly) {
			toast.warning(tf('remote.view_only', 'View only mode'));
			return false;
		}
		if (!text) {
			toast.warning(tf('remote.type_text_empty', 'Enter text to type on the remote'));
			return false;
		}
		const unavailable = tf('remote.type_text_unavailable', 'Type text is not available on this transport');
		if (typeof s.client.sendText !== 'function' || s.client.sendText(text) === false) {
			toast.warning(unavailable);
			return false;
		}
		toast.success(tf('remote.type_text_done', 'Text sent to remote keyboard'));
		return true;
	}

	setToggle(key: keyof Toggles, on: boolean): void {
		const s = this.active;
		if (!s) return;
		s.toggles = { ...s.toggles, [key]: on };
		const c = s.client;
		if (!c) return;
		if (key === 'blockInput') c.setBlockInput(on);
		else if (key === 'showCursor') c.setShowRemoteCursor(on);
		else if (key === 'lockAfter') c.setLockAfterSession(on);
		else if (key === 'privacy') c.setPrivacyMode(on);
		else c.setDisableClipboard(on);
	}

	/** Image quality, frame rate, scaling, keyboard mode, codec: the session and the saved defaults */
	setPref<K extends keyof ViewerPrefs>(key: K, value: ViewerPrefs[K]): void {
		const s = this.active;
		if (!s) return;
		s.prefs = { ...s.prefs, [key]: value };
		savePrefs(this.userId, s.prefs);
		const c = s.client;
		if (!c) return;
		if (key === 'quality') c.setQualityPreset(presetForQuality(String(value)));
		else if (key === 'fpsMode') c.setFpsMode?.(String(value));
		else if (key === 'scale') c.setScaleMode(String(value));
		else if (key === 'codec') c.setCodec(String(value));
		else if (key === 'keyboardMode') c.setKeyboardMode?.(String(value));
	}

	private applyPrefs(s: ViewerSession): void {
		const c = s.client;
		if (!c) return;
		const p = s.prefs;
		c.setBackgroundFps?.(p.backgroundFps || 1);
		if (c._state !== 'streaming' && c.state !== 'streaming') return;
		c.setQualityPreset(presetForQuality(p.quality));
		c.setFpsMode?.(p.fpsMode || 'adaptive');
		c.setScaleMode(p.scale || 'fit');
		if (p.codec && p.codec !== 'Auto') c.setCodec(p.codec);
		if (p.keyboardMode) c.setKeyboardMode?.(p.keyboardMode);
	}

	toggleAudio(): void {
		const s = this.active;
		if (!s) return;
		s.audioMuted = !s.audioMuted;
		s.client?.setAudioMuted(s.audioMuted);
	}

	toggleViewOnly(): void {
		const s = this.active;
		if (!s?.client) return;
		s.viewOnly = !s.viewOnly;
		s.client.setViewOnly(s.viewOnly);
		this.syncTouch();
	}

	toggleRecording(): void {
		const s = this.active;
		if (!s) return;
		if (s.mediaRecorder?.state === 'recording') {
			s.mediaRecorder.stop();
			s.recording = false;
			return;
		}
		if (this.transport === 'mesh') {
			s.meshServerRecord = !s.meshServerRecord;
			toast.info(
				s.meshServerRecord
					? tf('mesh.recording_server_on', 'Server recording enabled — reconnecting…')
					: tf('mesh.recording_server_off', 'Server recording disabled — reconnecting…')
			);
			this.reconnect(s);
			return;
		}
		try {
			if (!s.canvas) return;
			const stream = s.canvas.captureStream(30);
			s.recordedChunks = [];
			const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
				MediaRecorder.isTypeSupported(m)
			);
			const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
			rec.ondataavailable = (e) => {
				if (e.data.size > 0) s.recordedChunks.push(e.data);
			};
			rec.onstop = () => {
				const blob = new Blob(s.recordedChunks, { type: mime || 'video/webm' });
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `betterdesk-${s.deviceId}-${Date.now()}.webm`;
				a.click();
				URL.revokeObjectURL(url);
				s.mediaRecorder = null;
				s.recording = false;
			};
			rec.start(1000);
			s.mediaRecorder = rec;
			s.recording = true;
		} catch (err) {
			console.warn('[Remote] Recording not supported:', err);
		}
	}

	/* ── Screens ── */

	refreshMonitors(s: ViewerSession): void {
		const c = s.client;
		if (!c) return;
		try {
			s.monitors = c.getMonitors() || [];
		} catch {
			s.monitors = [];
		}
		try {
			s.virtualDisplays = c.getVirtualDisplaySupport?.() ?? { supported: false };
		} catch {
			s.virtualDisplays = { supported: false };
		}
		try {
			s.windowsSessions = c.getWindowsSessions?.() ?? { sessions: [], currentSid: 0 };
		} catch {
			s.windowsSessions = { sessions: [], currentSid: 0 };
		}
	}

	switchMonitor(idx: number): void {
		const s = this.active;
		if (!s?.client) return;
		s.client.switchMonitor(idx);
		this.refreshMonitors(s);
		s.monitors = s.monitors.map((m) => ({ ...m, current: m.idx === idx }));
	}

	toggleVirtualDisplay(index: number, on: boolean): void {
		const s = this.active;
		s?.client?.toggleVirtualDisplay(index, on);
		if (s) this.refreshMonitors(s);
	}

	selectWindowsSession(sid: number): void {
		const s = this.active;
		if (!s?.client) return;
		s.client.selectWindowsSession(sid);
		s.windowsSessions = { ...s.windowsSessions, currentSid: sid };
	}

	/* ── Side sheets: chat, file transfer, session info (one at a time, beside the screen) ── */

	openSheet(name: SheetName): void {
		const s = this.active;
		if (!s) return;
		const files = fileSheet();
		if (name !== 'files' && files?.isOpen()) files.close();
		if (name === 'files') {
			if (!s.client?.fileTransfer && this.transport !== 'cdap') {
				toast.warning(
					tf('remote.file_transfer_unavailable', 'File transfer is not available for this session.')
				);
				return;
			}
			if (!files) return;
			this.sheet = 'files';
			files.open(s);
			files._el?.querySelector<HTMLElement>('.ft-modal-close')?.focus();
		} else this.sheet = name;
		this.resize();
	}

	closeSheet(): void {
		const was = this.sheet;
		this.sheet = null;
		if (was === 'files') {
			const files = fileSheet();
			if (files?.isOpen()) files.close();
		}
		this.resize();
	}

	toggleSheet(name: SheetName): void {
		if (this.sheet === name) this.closeSheet();
		else this.openSheet(name);
	}

	/** The file sheet closed itself (its × or Escape) */
	onFileSheetClosed(): void {
		if (this.sheet === 'files') {
			this.sheet = null;
			this.resize();
		}
	}

	sendChat(s: ViewerSession, text: string): boolean {
		const msg = text.trim();
		if (!msg || !s.client) return false;
		s.client.sendChat(msg);
		this.addChat(s, msg, 'sent');
		return true;
	}

	private addChat(s: ViewerSession, text: string, type: 'sent' | 'received'): void {
		s.chat = [...s.chat, { id: ++chatSeq, text, type }];
	}

	/* ── Screen size, input, clipboard ── */

	resize(): void {
		const s = this.active;
		if (!s?.client) return;
		requestAnimationFrame(() => {
			try {
				s.client?.renderer.resize();
			} catch {
				/* not ready */
			}
		});
	}

	resizeAll(): void {
		for (const s of this.sessions) {
			try {
				s.client?.renderer.resize();
			} catch {
				/* not ready */
			}
		}
	}

	/** Keyboard, mouse, inbound clipboard and audio only for the active streaming tab */
	syncMediaCapture(): void {
		for (const s of this.sessions) {
			s.client?.setSessionActive?.(s.deviceId === this.activeId && s.state === 'streaming');
		}
	}

	/** Tablets: touch input on the screen (RustDesk transport only) */
	private attachTouch(s: ViewerSession): void {
		if (!isMobileViewer() || !s.client || !s.canvas) return;
		if (typeof s.client.input?.sendMessage !== 'function') return;
		const Touch = touchInput();
		if (!Touch) return;
		if (!s.touch)
			s.touch = new Touch(s.canvas, s.client.renderer, (msg) => {
				s.client?.input?.sendMessage?.(msg);
			});
		this.syncTouch();
	}

	syncTouch(): void {
		for (const s of this.sessions) {
			if (!s.touch) continue;
			if (s.deviceId === this.activeId && s.state === 'streaming' && !s.client?.viewOnly) {
				s.touch.setMode(this.mobileMode);
				s.touch.start();
			} else s.touch.stop();
		}
	}

	setMobileMode(mode: 'direct' | 'touchpad'): void {
		this.mobileMode = mode;
		this.syncTouch();
	}

	/** Special keys of the tablet toolbar, as key presses on the remote */
	sendSpecialKey(key: 'Meta' | 'Alt+Tab' | 'PrintScreen' | 'Escape'): void {
		const input = this.active?.client?.input;
		if (!input?._handleKeyDown || !input._handleKeyUp) return;
		const code = { Meta: 'MetaLeft', 'Alt+Tab': 'Tab', PrintScreen: 'PrintScreen', Escape: 'Escape' }[key];
		const alt = key === 'Alt+Tab';
		input._handleKeyDown(
			new KeyboardEvent('keydown', { code, altKey: alt, bubbles: true, cancelable: true })
		);
		input._handleKeyUp(new KeyboardEvent('keyup', { code, altKey: alt, bubbles: true, cancelable: true }));
	}

	keyFromBridge(e: KeyboardEvent): void {
		const input = this.active?.client?.input;
		if (e.type === 'keydown') input?._handleKeyDown?.(e);
		else input?._handleKeyUp?.(e);
	}

	/**
	 * The local clipboard to the device, when the browser already allows
	 * reading it (Firefox asks on every read, so it never does there; Paste
	 * clipboard in Actions stays the way to send it).
	 */
	async syncClipboard(): Promise<void> {
		const s = this.active;
		if (!s?.client || s.state !== 'streaming' || s.client.viewOnly) return;
		if (!navigator.clipboard?.readText) return;
		if (!(await this.clipboardReadGranted())) return;
		try {
			const text = await navigator.clipboard.readText();
			if (text && text !== this.lastClipboard) {
				this.lastClipboard = text;
				s.client.sendClipboard(text);
			}
		} catch {
			/* not focused or refused */
		}
	}

	private async clipboardReadGranted(): Promise<boolean> {
		if (this.clipboardGranted !== null) return this.clipboardGranted;
		try {
			const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
			this.clipboardGranted = status.state === 'granted';
			status.onchange = () => {
				this.clipboardGranted = status.state === 'granted';
			};
		} catch {
			this.clipboardGranted = false;
		}
		return this.clipboardGranted;
	}

	/** Autoplay was blocked: the click on "Start playback" plays video and resumes audio */
	startPlayback(s: ViewerSession): void {
		s.autoplayBlocked = false;
		s.client?.video?.retryPlay?.();
		const ctx = s.client?.audio?.audioCtx;
		if (ctx?.state === 'suspended') void ctx.resume();
	}
}
