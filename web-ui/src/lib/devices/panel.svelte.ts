/**
 * The device panel's own state next to devicePanel (state/devicePanel.svelte.ts):
 * the tab it opens on and the line in its footer that says what the last
 * panel action did.
 *
 *   openDeviceAt(id, 'hardware')      the inventory page opens a device on Hardware
 *   say(t('device_detail.command_sent'))   result of an action in the panel
 */

import { openDevice, type PanelMode } from '#lib/state/devicePanel.svelte.ts';
import type { LiveView, PanelTab } from './panel-logic.ts';

export type StatusTone = 'neutral' | 'ok' | 'error';

class PanelView {
	/** The tab the next panel opens on; read and cleared when it opens */
	tab = $state<PanelTab | null>(null);
	/** The view of Live data the next panel opens on */
	liveView = $state<LiveView | null>(null);
	/** The footer's status line */
	message = $state('');
	tone = $state<StatusTone>('neutral');
}

export const panelView = new PanelView();

/** Open a device's panel on a tab (Overview when that tab doesn't apply to it) */
export function openDeviceAt(
	id: string,
	tab: PanelTab,
	opts: { mode?: PanelMode; opener?: HTMLElement | null; liveView?: LiveView } = {}
): void {
	panelView.tab = tab;
	panelView.liveView = opts.liveView ?? null;
	openDevice(id, opts);
}

/** Put a result in the panel's status line (announced politely) */
export function say(message: string, tone: StatusTone = 'ok'): void {
	panelView.message = message;
	panelView.tone = tone;
}

export function clearStatus(): void {
	panelView.message = '';
	panelView.tone = 'neutral';
}
