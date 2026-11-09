/**
 * Several translated sentences as one count line ("12 devices. Average CPU
 * load 18 %. 3 shown."). Each sentence keeps its own placeholders; they are
 * renamed per sentence so two "{count}" don't collide, and CountLine shows
 * the numbers in the console language.
 */

export interface Sentence {
	key: string;
	params?: Record<string, number>;
}

export function joinSentences(
	sentences: readonly Sentence[],
	translate: (key: string) => string
): { text: string; values: Record<string, number> } {
	const values: Record<string, number> = {};
	const text = sentences
		.map((s, i) =>
			translate(s.key).replace(/\{(\w+)\}/g, (whole, name: string) => {
				const v = s.params?.[name];
				if (v === undefined) return whole;
				values[`${i}_${name}`] = v;
				return `{${i}_${name}}`;
			})
		)
		.join(' ');
	return { text, values };
}
