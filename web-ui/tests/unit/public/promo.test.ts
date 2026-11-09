import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import type { Slide } from '../../../src/lib/api/signin.ts';

const PromoPanel = (await import('../../../src/lib/public/PromoPanel.svelte')).default;

const slide = (id: string, extra: Partial<Slide> = {}): Slide => ({
	id,
	slideKey: '',
	imageUrl: '/img/login-slides/' + id + '.jpg',
	title: 'Title ' + id,
	body: '',
	overlay: 45,
	...extra
});

const visible = () =>
	[...document.querySelectorAll<HTMLElement>('.login-promo-slide')]
		.filter((s) => !s.hidden)
		.map((s) => s.textContent?.trim());

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('matchMedia', (q: string) => ({
		matches: false,
		media: q,
		addEventListener() {},
		removeEventListener() {}
	}));
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	delete document.documentElement.dataset.a11yReduceMotion;
	setStrings('en', 'ltr', {});
});

describe('promo slides', () => {
	test('built-in slides take their text from the strings; one slide shows at a time', () => {
		setStrings('en', 'ltr', {
			login_promo: { slides: { free: { title: 'Free and open', body: 'Yours.' } } }
		});
		render(PromoPanel, { mode: 'slides', slides: [slide('a', { title: '', slideKey: 'free' }), slide('b')] });
		expect(visible()).toEqual(['Free and open Yours.']);
	});

	test('moves on every 7 seconds and wraps around', async () => {
		render(PromoPanel, { mode: 'slides', slides: [slide('a'), slide('b'), slide('c')] });
		expect(visible()).toEqual(['Title a']);
		await vi.advanceTimersByTimeAsync(7000);
		expect(visible()).toEqual(['Title b']);
		await vi.advanceTimersByTimeAsync(14000);
		expect(visible()).toEqual(['Title a']);
	});

	test('previous, next and the dots; the current dot is marked', async () => {
		render(PromoPanel, { mode: 'slides', slides: [slide('a'), slide('b'), slide('c')] });
		await fireEvent.click(screen.getByRole('button', { name: 'login_promo.prev' }));
		expect(visible()).toEqual(['Title c']);
		await fireEvent.click(screen.getByRole('button', { name: 'login_promo.next' }));
		expect(visible()).toEqual(['Title a']);
		const dots = screen.getAllByRole('button', { name: /Slide \d of 3/ });
		await fireEvent.click(dots[1]!);
		expect(visible()).toEqual(['Title b']);
		expect(dots[1]).toHaveAttribute('aria-current', 'true');
		expect(dots[0]).not.toHaveAttribute('aria-current');
	});

	test('stops while focus is inside, and when motion is reduced', async () => {
		const { unmount } = render(PromoPanel, { mode: 'slides', slides: [slide('a'), slide('b')] });
		await fireEvent.focusIn(screen.getByRole('button', { name: 'login_promo.next' }));
		await vi.advanceTimersByTimeAsync(10000);
		expect(visible()).toEqual(['Title a']);
		unmount();
		document.documentElement.dataset.a11yReduceMotion = 'true';
		render(PromoPanel, { mode: 'slides', slides: [slide('a'), slide('b')] });
		await vi.advanceTimersByTimeAsync(10000);
		expect(visible()).toEqual(['Title a']);
	});

	test('one slide: no controls; "single": an empty panel the branding stylesheet paints', () => {
		const { unmount } = render(PromoPanel, { mode: 'slides', slides: [slide('a')] });
		expect(screen.queryByRole('button')).toBeNull();
		unmount();
		render(PromoPanel, { mode: 'single', slides: [] });
		const aside = document.querySelector('.login-promo.login-promo-single');
		expect(aside).toHaveAttribute('aria-hidden', 'true');
	});
});
