/**
 * What one open device panel loads besides the device: the inventory report,
 * a day of availability history, connection sessions, the agent's live
 * views, the folder list and the known tags. Each part loads the first time
 * its tab needs it and stays for the panel's life (switching tabs doesn't
 * load again; Retry and Refresh do). Results of an older request are dropped
 * when a newer one for the same part has started.
 */

import { ApiError } from '#lib/api/client.ts';
import * as agentApi from '#lib/api/device-agent.ts';
import type { AgentResult, AgentView, Availability, ConnectionSession } from '#lib/api/device-agent.ts';
import { listFolders, listTags, type Folder } from '#lib/api/devices.ts';
import { inventoryView, localDay, type InventoryView, type LiveView } from './panel-logic.ts';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface Loadable<T> {
	state: LoadState;
	value: T | null;
	error: string;
}

const idle = <T>(): Loadable<T> => ({ state: 'idle', value: null, error: '' });

export type AgentProblem = 'offline' | 'timeout' | 'other';

export interface AgentState {
	state: LoadState | 'pending';
	result: AgentResult | null;
	problem: AgentProblem | null;
	/** The server's message for 'other' (a code or a sentence) */
	error: string;
	/** Files: the folder shown or being opened */
	path: string;
}

const agentIdle = (): AgentState => ({ state: 'idle', result: null, problem: null, error: '', path: '/' });

/** What kind of failure an agent request had (503 offline, 504 timeout, anything else) */
export function agentProblem(err: unknown): { problem: AgentProblem; error: string } {
	const msg = err instanceof Error ? err.message : String(err ?? '');
	const status = err instanceof ApiError ? err.status : 0;
	const code = err instanceof ApiError ? (err.code ?? msg) : msg;
	if (status === 503 || /offline/i.test(code)) return { problem: 'offline', error: msg };
	if (status === 504 || /timeout/i.test(code)) return { problem: 'timeout', error: msg };
	return { problem: 'other', error: msg };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err ?? ''));

export class PanelData {
	readonly id: string;
	inventory = $state<Loadable<InventoryView | null>>(idle());
	availabilityDay = $state(localDay());
	availability = $state<Loadable<Availability>>(idle());
	sessions = $state<Loadable<ConnectionSession[]>>(idle());
	views = $state<Record<LiveView, AgentState>>({
		services: agentIdle(),
		processes: agentIdle(),
		events: agentIdle(),
		activity: agentIdle(),
		files: agentIdle()
	});
	folders = $state.raw<Folder[] | null>(null);
	tags = $state.raw<string[]>([]);

	#seq: Record<string, number> = {};
	#tagsLoaded = false;
	#foldersLoading: Promise<void> | null = null;

	constructor(id: string) {
		this.id = id;
	}

	#next(part: string): () => boolean {
		const n = (this.#seq[part] = (this.#seq[part] ?? 0) + 1);
		return () => this.#seq[part] === n;
	}

	/** null value: the agent never sent a report */
	async loadInventory(): Promise<void> {
		const current = this.#next('inventory');
		this.inventory = { state: 'loading', value: this.inventory.value, error: '' };
		try {
			const data = await agentApi.getInventoryReport(this.id);
			if (current()) this.inventory = { state: 'ready', value: data ? inventoryView(data) : null, error: '' };
		} catch (err) {
			if (current()) this.inventory = { state: 'error', value: null, error: message(err) };
		}
	}

	async loadAvailability(day = this.availabilityDay): Promise<void> {
		const current = this.#next('availability');
		this.availabilityDay = day;
		this.availability = { state: 'loading', value: null, error: '' };
		try {
			const value = await agentApi.getAvailability(this.id, day);
			if (current()) this.availability = { state: 'ready', value, error: '' };
		} catch (err) {
			if (current()) this.availability = { state: 'error', value: null, error: message(err) };
		}
	}

	async loadSessions(): Promise<void> {
		const current = this.#next('sessions');
		this.sessions = { state: 'loading', value: this.sessions.value, error: '' };
		try {
			const value = await agentApi.getConnectionSessions(this.id);
			if (current()) this.sessions = { state: 'ready', value, error: '' };
		} catch (err) {
			if (current()) this.sessions = { state: 'error', value: null, error: message(err) };
		}
	}

	/** A live view; Files opens `path` (the root at first) */
	async loadView(view: LiveView, path?: string): Promise<void> {
		const current = this.#next(`view:${view}`);
		const where = path ?? this.views[view].path;
		this.views[view] = { ...this.views[view], state: 'loading', problem: null, error: '', path: where };
		try {
			const result =
				view === 'files'
					? await agentApi.browseFiles(this.id, where)
					: await agentApi.getAgentView(this.id, view as AgentView);
			if (!current()) return;
			this.views[view] = {
				state: result.pending ? 'pending' : 'ready',
				result,
				problem: null,
				error: '',
				path: where
			};
		} catch (err) {
			if (!current()) return;
			const p = agentProblem(err);
			this.views[view] = { state: 'error', result: null, problem: p.problem, error: p.error, path: where };
		}
	}

	/** Folder list for the folder name and the edit form (once) */
	loadFolders(): Promise<void> {
		this.#foldersLoading ??= listFolders()
			.then((f) => {
				this.folders = f;
			})
			.catch(() => {
				this.folders = [];
			});
		return this.#foldersLoading;
	}

	/** Tags other devices have, for suggestions (once) */
	async loadTags(): Promise<void> {
		if (this.#tagsLoaded) return;
		this.#tagsLoaded = true;
		try {
			this.tags = await listTags();
		} catch {
			this.tags = [];
		}
	}

	/** A tag just added is a suggestion from now on */
	rememberTags(tags: readonly string[]): void {
		const all = [...this.tags, ...tags.filter((x) => !this.tags.includes(x))];
		this.tags = all.sort((a, b) => a.localeCompare(b));
	}
}
