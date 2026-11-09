/**
 * The Material Symbols names the console draws, for the self-hosted font
 * subset in static/fonts. scripts/update-material-symbols.mjs at the repo
 * root builds the font from this list, and tests/unit/icons.test.ts checks
 * that the font has a glyph for every name. A name the font lacks draws
 * nothing, so its button looks empty.
 *
 * Icons are drawn by the Icon component (src/lib/ui/Icon.svelte), directly
 * or through the icon props of Button, IconButton, MenuItem and the rest;
 * by the remote viewer's file sheet (static/rdclient, plain JS that builds
 * icon spans); and by the sidebar from the section icons the server sends
 * (web-nodejs/lib/consoleNav.js).
 *
 * A name counts where it is written as a quoted literal in an icon place.
 * "Named like icon" means an identifier with icon, Icon or ICON in it
 * (themeIcon, ICON, MENU_ICONS, getFileIcon), but not favicon.
 * - the name of an Icon tag, and attributes named like icon:
 *   <Icon name={open ? 'expand_less' : 'expand_more'} />, <MenuItem icon="edit">
 * - variables, properties and maps named like icon:
 *   const themeIcon = $derived(...), { icon: 'home' }, const ICON = { done: 'check_circle' }
 * - what a function named like icon returns: fileIcon(e), getFileIcon(entry)
 * - the argument given for a parameter named like icon:
 *   function addItem(label, icon, action) {...} addItem(t(...), 'folder_open', ...)
 * - icon spans in markup or built in strings, and CSS content: 'expand_more'
 * In code, every quoted name counts except the ones it is compared with,
 * translation keys and object keys, so
 * `choice === 'light' ? 'light_mode' : 'dark_mode'` gives light_mode and dark_mode.
 * So keep icon names in places named like icon; a name that only arrives
 * as data at run time goes in EXTRA_ICONS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Folders that draw icons, from web-ui; web-nodejs is missing when web-ui is checked out alone */
const SCAN_ROOTS = ['src', 'static', '../web-nodejs'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.ts', '.svelte', '.html', '.css']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'vendor', 'generated', 'tests', 'data']);

/**
 * Names that only arrive as data at run time. The branding logo icon is
 * free text; its hint (branding.logo_icon_hint) suggests these three.
 */
export const EXTRA_ICONS = ['dns', 'cloud', 'security'];

const NAME = /^[a-z][a-z0-9_]{1,48}$/;
const ICONISH = String.raw`[\w$]*?(?<![Ff]av|FAV)(?:icon|Icon|ICON)[\w$]*`;
const ICONISH_WORD = new RegExp(`^${ICONISH}$`);

/** <Icon ...>, but not <IconButton> */
const ICON_TAG = /<Icon(?![\w$.-])/g;
/** icon="close", trailingIcon={...} */
const ICON_ATTR = new RegExp(String.raw`(?<![\w$.-])${ICONISH}=(?=["'{])`, 'g');
/** const themeIcon = ..., icon = ..., const ICON: Record<A, B> = ... */
const ICON_ASSIGN = new RegExp(
	String.raw`(?<![\w$])${ICONISH}(?:\.textContent)?(?:\s*:\s*[^=;\n]+?)?\s+=\s+(?![=>])`,
	'g'
);
/** { icon: 'home' }, confirmIcon: ..., ICONS: { ... } */
const ICON_PROP = new RegExp(String.raw`(?<![\w$])${ICONISH}\s*:(?!:)\s*`, 'g');
/** function fileIcon(e) { ... }, static getFileIcon(entry) { ... } */
const ICON_FUNCTION = new RegExp(String.raw`(?<![\w$])${ICONISH}\s*\(`, 'g');
/** <span class="material-icons">close</span> */
const SPAN_TEXT = /material-(?:icons|symbols)[\w-]*\b[^>\n]*>\s*([a-z][a-z0-9_]{1,48})\s*</g;
/** '<span class="material-icons">' + name + '</span>', or {name} after the tag in markup */
const SPAN_EXPR = /material-(?:icons|symbols)[\w-]*\b[^>\n]*>(?:['"]\s*\+\s*|(?=\{))/g;
const CSS_CONTENT = /(?<![\w-])content\s*:\s*(['"])([a-z][a-z0-9_]{1,48})\1/g;
const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/g;

/** Function declarations, to find the ones with a parameter named like icon */
const DECLARATIONS = [
	{ re: /(?<![\w$])(?:function\s*|#snippet\s+)([\w$]+)\s*\(/g, body: /^/ },
	{ re: /(?<![\w$.])([\w$]+)\s*=\s*(?:async\s*)?\(/g, body: /^\s*(?::[^=;{]+?)?=>/ },
	{ re: /(?<![\w$.])([\w$]+)\s*=\s*(?:async\s*)?function\b[\w$\s]*\(/g, body: /^/ },
	{ re: /(?<![\w$.])([\w$]+)\s*\(/g, body: /^\s*(?::\s*[^{;=()]+?)?\{/ }
];
const KEYWORDS = new Set([
	'if',
	'for',
	'while',
	'switch',
	'catch',
	'with',
	'return',
	'typeof',
	'await',
	'new'
]);

const OPEN = '([{';
const CLOSE = ')]}';

function lineEnd(code, i) {
	const j = code.indexOf('\n', i);
	return j < 0 ? code.length : j;
}

function blockEnd(code, i) {
	const j = code.indexOf('*/', i + 2);
	return j < 0 ? code.length : j + 2;
}

/** Index after the string literal that starts at i; a quote left open ends at the line end */
function stringEnd(code, i) {
	const quote = code[i];
	for (let j = i + 1; j < code.length; j++) {
		const c = code[j];
		if (c === '\\') j++;
		else if (c === quote) return j + 1;
		else if (quote === '`' && c === '$' && code[j + 1] === '{') j = closeOf(code, j + 1) - 1;
		else if (c === '\n' && quote !== '`') return j;
	}
	return code.length;
}

/** Index after the bracket that closes the one at i, skipping strings and comments */
function closeOf(code, i, limit = code.length) {
	let depth = 0;
	for (let j = i; j < limit;) {
		const c = code[j];
		if (c === '"' || c === "'" || c === '`') j = stringEnd(code, j);
		else if (c === '/' && code[j + 1] === '/') j = lineEnd(code, j);
		else if (c === '/' && code[j + 1] === '*') j = blockEnd(code, j);
		else {
			if (OPEN.includes(c)) depth++;
			else if (CLOSE.includes(c) && --depth === 0) return j + 1;
			j++;
		}
	}
	return limit;
}

/** Whether the expression that started at start goes on after the line break at j */
function continues(code, start, j) {
	const before = code.slice(start, j).trimEnd();
	if (!before || /(?:[=?:|&+\-*/,(]|=>)$/.test(before)) return true;
	const next = /\S/.exec(code.slice(j + 1, j + 200));
	return !!next && '?:|&+.'.includes(next[0]);
}

/** The expression that starts at i: up to one of stops or a closing bracket at its own level, or the line end */
function expressionAt(code, i, stops = ';,') {
	const limit = Math.min(code.length, i + 4000);
	let j = i;
	while (j < limit) {
		const c = code[j];
		if (c === '"' || c === "'" || c === '`') j = stringEnd(code, j);
		else if (c === '/' && code[j + 1] === '/') j = lineEnd(code, j);
		else if (c === '/' && code[j + 1] === '*') j = blockEnd(code, j);
		else if (OPEN.includes(c)) j = closeOf(code, j, limit);
		else if (CLOSE.includes(c) || stops.includes(c)) break;
		else if (c === '\n' && !continues(code, i, j)) break;
		else j++;
	}
	return code.slice(i, j);
}

/** The return values in a function body */
function returnsIn(body) {
	return [...body.matchAll(/(?<![\w$.])return\b\s*/g)].map((m) =>
		expressionAt(body, m.index + m[0].length, ';')
	);
}

/** A value in an icon place; for a function, what it returns */
function valueAt(code, i, stops) {
	const expr = expressionAt(code, i, stops);
	const fn =
		/^(?:async\s*)?(?:\([^()]*\)|[\w$]+)\s*(?::[^=;{]+?)?=>\s*\{|^(?:async\s*)?function\b[^{]*\{/.exec(expr);
	return fn ? returnsIn(expr.slice(fn[0].length - 1)).join('\n') : expr;
}

/** Split call arguments or parameters at their own commas */
function splitTopLevel(code) {
	const parts = [];
	let from = 0;
	for (let j = 0; j < code.length;) {
		const c = code[j];
		if (c === '"' || c === "'" || c === '`') j = stringEnd(code, j);
		else if (OPEN.includes(c)) j = closeOf(code, j);
		else {
			if (c === ',') {
				parts.push(code.slice(from, j));
				from = j + 1;
			}
			j++;
		}
	}
	parts.push(code.slice(from));
	return parts;
}

/** Compared with (=== 'light'), tested for (.includes('x')), a translation key (t('key')) or an object key ('key':) */
function notAnIcon(code, start, end) {
	const before = code.slice(Math.max(0, start - 16), start);
	const after = code.slice(end, end + 8);
	return (
		/(?:[=!]==?|\bcase|\.(?:includes|startsWith|endsWith|has|indexOf|test|split)\(|(?<![\w$.])(?:t|tf|tr)\()\s*$/.test(
			before
		) || /^(?:\s*[=!]==?|:(?!:))/.test(after)
	);
}

/** The quoted names in a piece of code that can be icon names */
function namesIn(code) {
	const out = [];
	for (let j = 0; j < code.length;) {
		const c = code[j];
		if (c === '"' || c === "'" || c === '`') {
			const end = stringEnd(code, j);
			const value = code.slice(j + 1, end - 1);
			if (NAME.test(value) && !notAnIcon(code, j, end)) out.push(value);
			j = end;
		} else if (c === '/' && code[j + 1] === '/') j = lineEnd(code, j);
		else if (c === '/' && code[j + 1] === '*') j = blockEnd(code, j);
		else j++;
	}
	return out;
}

/** Index of the > that ends the tag whose attributes start at i */
function tagEnd(code, i) {
	const limit = Math.min(code.length, i + 4000);
	for (let j = i; j < limit;) {
		const c = code[j];
		if (c === '>') return j;
		if (c === '"' || c === "'") j = stringEnd(code, j);
		else if (c === '{') j = closeOf(code, j, limit);
		else j++;
	}
	return limit;
}

/** Parameter positions named like icon, per function declared in the code */
function iconParams(code) {
	const found = new Map();
	for (const { re, body } of DECLARATIONS) {
		for (const m of code.matchAll(re)) {
			const fn = m[1];
			if (KEYWORDS.has(fn) || found.has(fn)) continue;
			const open = m.index + m[0].length - 1;
			const close = closeOf(code, open);
			if (!body.test(code.slice(close, close + 200))) continue;
			const params = splitTopLevel(code.slice(open + 1, close - 1));
			const at = params.findIndex((p) => ICONISH_WORD.test(/^\s*(?:\.\.\.)?([\w$]*)/.exec(p)?.[1] ?? ''));
			if (at >= 0) found.set(fn, at);
		}
	}
	return found;
}

/** The icon names written in one file's text, as written (meanings not yet turned into glyphs) */
export function iconNamesIn(text, file) {
	const names = new Set();
	const take = (code) => namesIn(code).forEach((n) => names.add(n));
	const ext = path.extname(file);

	let code = text;
	let css = '';
	if (ext === '.css') {
		code = '';
		css = text;
	} else if (ext === '.svelte' || ext === '.html') {
		css = [...text.matchAll(STYLE_BLOCK)].map((m) => m[1]).join('\n');
		code = text.replace(STYLE_BLOCK, '');
	}
	for (const m of css.matchAll(CSS_CONTENT)) names.add(m[2]);

	for (const m of code.matchAll(ICON_TAG)) {
		const start = m.index + m[0].length;
		const tag = code.slice(start, tagEnd(code, start));
		for (const attr of tag.matchAll(/(?<![\w$:-])name=(?=["'{])/g)) {
			const at = attr.index + attr[0].length;
			take(tag[at] === '{' ? tag.slice(at, closeOf(tag, at)) : tag.slice(at, stringEnd(tag, at)));
		}
	}
	for (const m of code.matchAll(ICON_ATTR)) {
		const at = m.index + m[0].length;
		take(code[at] === '{' ? code.slice(at, closeOf(code, at)) : code.slice(at, stringEnd(code, at)));
	}
	for (const m of code.matchAll(ICON_ASSIGN)) take(valueAt(code, m.index + m[0].length, ';,'));
	for (const m of code.matchAll(ICON_PROP)) take(valueAt(code, m.index + m[0].length, ';,'));
	for (const m of code.matchAll(ICON_FUNCTION)) {
		const close = closeOf(code, m.index + m[0].length - 1);
		const body = /^\s*(?::\s*[^{;=()]+?)?\{/.exec(code.slice(close, close + 200));
		if (body) {
			const open = close + body[0].length - 1;
			returnsIn(code.slice(open, closeOf(code, open))).forEach(take);
		}
	}
	for (const [fn, at] of iconParams(code)) {
		const call = new RegExp(String.raw`(?<![\w$])${fn.replace(/\$/g, '\\$')}\s*\(`, 'g');
		for (const m of code.matchAll(call)) {
			const open = m.index + m[0].length - 1;
			const arg = splitTopLevel(code.slice(open + 1, closeOf(code, open) - 1))[at];
			if (arg) take(arg);
		}
	}
	for (const m of code.matchAll(SPAN_TEXT)) names.add(m[1]);
	for (const m of code.matchAll(SPAN_EXPR)) {
		const at = m.index + m[0].length;
		take(code[at] === '{' ? code.slice(at, closeOf(code, at)) : expressionAt(code, at, ';,+'));
	}
	return [...names];
}

/** The ICONS meaning table of src/lib/util/display.ts, read from its source */
export function readMeanings() {
	const text = fs.readFileSync(path.join(UI, 'src/lib/util/display.ts'), 'utf8');
	const table = /export const ICONS = \{([^}]*)\}/.exec(text);
	if (!table) throw new Error('No ICONS table in src/lib/util/display.ts');
	return Object.fromEntries([...table[1].matchAll(/([\w$]+):\s*'([a-z0-9_]+)'/g)].map((m) => [m[1], m[2]]));
}

function walkFiles(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (SKIP_DIRS.has(ent.name)) continue;
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) walkFiles(full, out);
		else if (SCAN_EXTS.has(path.extname(ent.name)) && !/\.min\.js$|\.(?:test|spec)\.[jt]s$/.test(ent.name))
			out.push(full);
	}
	return out;
}

/** Every glyph name the console may draw, with the files (relative to web-ui) that draw it */
export function collectCandidateIcons() {
	const meanings = readMeanings();
	const icons = new Map();
	const add = (name, where) => {
		if (!icons.has(name)) icons.set(name, new Set());
		icons.get(name).add(where);
	};
	for (const name of EXTRA_ICONS) add(name, '(EXTRA_ICONS)');
	for (const root of SCAN_ROOTS) {
		const dir = path.join(UI, root);
		if (!fs.existsSync(dir)) continue;
		for (const file of walkFiles(dir)) {
			const rel = path.relative(UI, file).split(path.sep).join('/');
			// The Icon component turns meanings ("copy") into glyphs; the plain JS under static/ writes glyphs
			const glyph = rel.startsWith('static/') ? (n) => n : (n) => meanings[n] ?? n;
			for (const name of iconNamesIn(fs.readFileSync(file, 'utf8'), rel)) add(glyph(name), rel);
		}
	}
	return icons;
}
