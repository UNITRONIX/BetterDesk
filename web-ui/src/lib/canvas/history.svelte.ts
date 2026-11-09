/**
 * Undo and redo for a node editor: snapshots of the whole document as
 * JSON, at most `limit` steps back (50, as the flow builder always had).
 * A new change clears what could be redone.
 */

export class History<T> {
	#undo = $state.raw<string[]>([]);
	#redo = $state.raw<string[]>([]);
	readonly limit: number;

	constructor(limit = 50) {
		this.limit = limit;
	}

	get canUndo(): boolean {
		return this.#undo.length > 0;
	}

	get canRedo(): boolean {
		return this.#redo.length > 0;
	}

	/** Remember `state` as it is before a change */
	push(state: T): void {
		const next = [...this.#undo, JSON.stringify(state)];
		this.#undo = next.length > this.limit ? next.slice(next.length - this.limit) : next;
		this.#redo = [];
	}

	/** The state before the last change, or null; `current` becomes redoable */
	undo(current: T): T | null {
		const last = this.#undo.at(-1);
		if (last === undefined) return null;
		this.#undo = this.#undo.slice(0, -1);
		this.#redo = [...this.#redo, JSON.stringify(current)];
		return JSON.parse(last) as T;
	}

	/** The state the last undo left, or null; `current` becomes undoable */
	redo(current: T): T | null {
		const last = this.#redo.at(-1);
		if (last === undefined) return null;
		this.#redo = this.#redo.slice(0, -1);
		this.#undo = [...this.#undo, JSON.stringify(current)];
		return JSON.parse(last) as T;
	}

	clear(): void {
		this.#undo = [];
		this.#redo = [];
	}
}
