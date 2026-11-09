import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$app/paths', () => ({
	resolve: (p: string) => '/app' + (p || '/'),
	asset: (p: string) => '/app/' + p
}));

afterEach(() => {
	document.head.querySelectorAll('script').forEach((s) => s.remove());
	vi.unstubAllGlobals();
});

test('the H.264 helpers load from the new console, not the old public folder', async () => {
	vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
	const { loadMseH264 } = await import('../../../src/lib/devices-area/cdap/desktop.ts');
	const done = loadMseH264();
	// The muxer first; the video helper only after it loaded
	const first = document.head.querySelector('script');
	expect(first?.getAttribute('src')).toBe('/app/rdclient/vendor/jmuxer.min.js');
	first?.dispatchEvent(new Event('load'));
	await vi.waitFor(() => expect(document.head.querySelectorAll('script')).toHaveLength(2));
	const second = document.head.querySelectorAll('script')[1];
	expect(second?.getAttribute('src')).toBe('/app/rdclient/video.js');
	(window as unknown as { RDVideo: unknown }).RDVideo = function RDVideo() {};
	second?.dispatchEvent(new Event('load'));
	await expect(done).resolves.toBe(true);
});
