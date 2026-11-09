/**
 * Advanced tab: which configuration files can be edited, in which order,
 * and what a save of each needs (old settings.js "Advanced config files").
 * No DOM.
 */

import type { ConfigFile } from '#lib/api/settings-system.ts';

/** Key of a file's plain name; files without one show their id */
export function fileLabelKey(id: string): string {
	return `settings.advanced_file_${id}`;
}

export interface FileGroups {
	/** The console can change (or create) these: existing ones first */
	editable: ConfigFile[];
	/** Exist, but the console can only show them */
	readOnly: ConfigFile[];
	/** Not on this server and can't be created here */
	unavailable: ConfigFile[];
}

export function groupFiles(files: readonly ConfigFile[]): FileGroups {
	const editable = files
		.filter((f) => (f.exists && f.writable) || (!f.exists && f.canCreate))
		.sort((a, b) => Number(b.exists) - Number(a.exists));
	const readOnly = files.filter((f) => f.exists && !f.writable);
	const unavailable = files.filter((f) => !f.exists && !f.canCreate);
	return { editable, readOnly, unavailable };
}

/** The sentence under the editor: which service a save needs */
export function restartHintKey(requiresRestart: string | null | undefined): string {
	switch (requiresRestart) {
		case 'none':
			return 'settings.advanced_restart_none';
		case 'console':
			return 'settings.advanced_restart_console';
		case 'goserver':
			return 'settings.advanced_restart_goserver';
		case 'systemd':
			return 'settings.advanced_restart_systemd';
		default:
			return 'settings.advanced_restart_generic';
	}
}

/** The restart row under the editor shows for files whose saves need one */
export function showsRestart(
	file: Pick<ConfigFile, 'requiresRestart' | 'exists' | 'canCreate'> | null
): boolean {
	return !!file && file.requiresRestart !== 'none' && !!(file.exists || file.canCreate);
}

/** A file that doesn't exist yet opens with this line, so saving creates it */
export function newFileText(hint: string): string {
	return `# ${hint}\n`;
}

/** Unsaved: the editor's text differs from what was loaded */
export function isDirty(text: string, original: string): boolean {
	return text !== original;
}
