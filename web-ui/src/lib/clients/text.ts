/** Small text helpers for the clients and enrollment pages */

/**
 * A translated text cut at a placeholder, so a link or a component can go
 * in its place: around('Client {version}', '{version}') → ['Client ', '']
 */
export function around(text: string, token: string): [string, string] {
	const at = text.indexOf(token);
	return at === -1 ? [text, ''] : [text.slice(0, at), text.slice(at + token.length)];
}
