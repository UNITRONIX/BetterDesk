/**
 * What kind of screen and input the browser has: phone, tablet, touch,
 * foldable. Port of public/js/device-capabilities.js. The wrapped remote
 * client reads it as window.DeviceCapabilities (client.js isMobileRuntime),
 * so installCapabilities() puts the same object there.
 */

export const BP_PHONE = 767;
export const BP_TABLET = 1024;
export const BP_FOLD_INNER = 720;

export interface DeviceCapabilitiesApi {
	BP_PHONE: number;
	BP_TABLET: number;
	BP_FOLD_INNER: number;
	isPhone(): boolean;
	isTablet(): boolean;
	isMobileShell(): boolean;
	isTouch(): boolean;
	isFoldable(): boolean;
	isUnfolded(): boolean;
	getDevicePosture(): string;
	getVisualViewportHeight(): number;
	refresh(): void;
}

interface PostureNavigator {
	devicePosture?: { type?: string; addEventListener(type: 'change', fn: () => void): void };
}

const state = { isFoldable: false, devicePosture: 'unknown', isTouch: false, width: 0, height: 0 };

function matches(query: string): boolean {
	try {
		return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
	} catch {
		return false;
	}
}

export function hasTouch(): boolean {
	return 'ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
}

export function viewportWidth(): number {
	const iw = window.innerWidth || 0;
	const cw = document.documentElement ? document.documentElement.clientWidth : 0;
	const vv = window.visualViewport ? window.visualViewport.width : 0;
	const w = Math.max(iw, cw);
	if (w <= 0 && vv > 0) return vv;
	if (iw > 0 && iw < 100 && vv > iw) return vv;
	return w || vv || 0;
}

function refresh(): void {
	state.width = viewportWidth();
	state.height = window.innerHeight || 0;
	state.isTouch = hasTouch();
}

/** A narrow screen without a fine pointer: the web viewer cannot run there */
export function isPhone(): boolean {
	refresh();
	if (state.width <= 0 || state.width > BP_PHONE) return false;
	return !matches('(hover: hover) and (pointer: fine)');
}

function foldByMedia(): boolean {
	return (
		matches('(horizontal-viewport-segments: 2)') ||
		matches('(vertical-viewport-segments: 2)') ||
		matches('(screen-spanning: single-fold-horizontal)') ||
		matches('(screen-spanning: single-fold-vertical)')
	);
}

function foldByAspect(): boolean {
	const w = viewportWidth();
	const ratio = w / (window.innerHeight || 1);
	return hasTouch() && w >= 700 && w <= 1400 && ratio >= 0.8 && ratio <= 1.4;
}

function isUnfolded(): boolean {
	if (state.devicePosture === 'continuous') return true;
	if (foldByMedia()) return true;
	return foldByAspect() && viewportWidth() >= BP_FOLD_INNER;
}

export const DeviceCapabilities: DeviceCapabilitiesApi = {
	BP_PHONE,
	BP_TABLET,
	BP_FOLD_INNER,
	isPhone,
	isTablet: () => {
		refresh();
		return state.width > BP_PHONE && state.width <= BP_TABLET;
	},
	isMobileShell: () => {
		refresh();
		return state.width <= BP_TABLET;
	},
	isTouch: () => state.isTouch || hasTouch(),
	isFoldable: () => state.isFoldable,
	isUnfolded,
	getDevicePosture: () => state.devicePosture,
	getVisualViewportHeight: () => (window.visualViewport ? window.visualViewport.height : window.innerHeight),
	refresh
};

let installed = false;

/** Put DeviceCapabilities on window and keep posture changes coming (once per page) */
export function installCapabilities(): void {
	(window as unknown as { DeviceCapabilities: DeviceCapabilitiesApi }).DeviceCapabilities =
		DeviceCapabilities;
	if (installed) return;
	installed = true;
	refresh();
	const nav = navigator as unknown as PostureNavigator;
	if (nav.devicePosture) {
		state.isFoldable = true;
		state.devicePosture = nav.devicePosture.type || 'unknown';
		nav.devicePosture.addEventListener('change', () => {
			state.devicePosture = nav.devicePosture?.type || 'unknown';
			window.dispatchEvent(
				new CustomEvent('betterdesk:posture-change', { detail: { posture: state.devicePosture } })
			);
		});
	}
	state.isFoldable = state.isFoldable || foldByMedia() || foldByAspect();
}

/** The tablet layout of the viewer: touch input on a screen larger than a phone */
export function isMobileViewer(): boolean {
	return DeviceCapabilities.isTouch() && !isPhone();
}
