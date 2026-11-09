/**
 * Visible text in Svelte markup must come from the translation files.
 *
 * Reports text nodes with letters in them and literal values of attributes
 * people read (aria-label, title, placeholder, alt, label). Mustache
 * expressions ({t('key')}) are fine. Symbols and punctuation alone (×, –, :)
 * are allowed, so are elements marked translate="no" (brand names, sample IDs).
 */
const READ_ATTRS = new Set([
	'aria-label',
	'aria-description',
	'title',
	'placeholder',
	'alt',
	'label',
	'aria-roledescription',
	'aria-valuetext'
]);
const LETTERS = /\p{L}/u;

function insideNoTranslate(node) {
	for (let p = node.parent; p; p = p.parent) {
		if (p.type === 'SvelteElement' && p.startTag) {
			const attr = p.startTag.attributes.find(
				(a) => a.type === 'SvelteAttribute' && a.key && a.key.name === 'translate'
			);
			if (
				attr &&
				attr.value.length === 1 &&
				attr.value[0].type === 'SvelteLiteral' &&
				attr.value[0].value === 'no'
			)
				return true;
		}
		if (p.type === 'SvelteStyleElement' || p.type === 'SvelteScriptElement') return true;
	}
	return false;
}

export default {
	meta: {
		type: 'problem',
		docs: { description: 'Disallow hard-coded user-visible strings in Svelte markup' },
		schema: [],
		messages: {
			text: 'Visible text "{{text}}" must come from the translation files (t(...)).',
			attr: 'Attribute {{name}}="{{text}}" must come from the translation files (t(...)).'
		}
	},
	create(context) {
		return {
			SvelteText(node) {
				const text = node.value.trim();
				if (!text || !LETTERS.test(text) || insideNoTranslate(node)) return;
				context.report({ node, messageId: 'text', data: { text: text.slice(0, 40) } });
			},
			SvelteAttribute(node) {
				const name = node.key && node.key.name;
				if (!READ_ATTRS.has(name)) return;
				for (const part of node.value) {
					if (part.type === 'SvelteLiteral' && LETTERS.test(part.value) && !insideNoTranslate(node)) {
						context.report({ node, messageId: 'attr', data: { name, text: part.value.slice(0, 40) } });
					}
				}
			}
		};
	}
};
