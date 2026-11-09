import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import qrcode from 'qrcode-generator';
import { createRawSnippet, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import Avatar from '../../../src/lib/ui/Avatar.svelte';
import BooleanStatus from '../../../src/lib/ui/BooleanStatus.svelte';
import CodeBlock from '../../../src/lib/ui/CodeBlock.svelte';
import Empty from '../../../src/lib/ui/Empty.svelte';
import Facts from '../../../src/lib/ui/Facts.svelte';
import LangFlag from '../../../src/lib/ui/LangFlag.svelte';
import ListRow from '../../../src/lib/ui/ListRow.svelte';
import Meter from '../../../src/lib/ui/Meter.svelte';
import Platform from '../../../src/lib/ui/Platform.svelte';
import Presence from '../../../src/lib/ui/Presence.svelte';
import QR from '../../../src/lib/ui/QR.svelte';
import ShareBar from '../../../src/lib/ui/ShareBar.svelte';
import Tag from '../../../src/lib/ui/Tag.svelte';
import TagSet from '../../../src/lib/ui/TagSet.svelte';
import Time from '../../../src/lib/ui/Time.svelte';
import User from '../../../src/lib/ui/User.svelte';
import ValueCopy from '../../../src/lib/ui/ValueCopy.svelte';
import ValueField from '../../../src/lib/ui/ValueField.svelte';
import Version from '../../../src/lib/ui/Version.svelte';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../../src/lib/ui/toasts.svelte.ts', () => ({ toast }));

const EN = {
	common: {
		none: 'None',
		on: 'On',
		off: 'Off',
		copied: 'Copied to clipboard',
		copy_value: 'Copy {value}',
		copy_failed: 'Could not copy.'
	},
	actions: { copy: 'Copy', show_value: 'Show', hide_value: 'Hide' },
	time: {
		just_now: 'just now',
		minutes_ago: '{count}m ago',
		hours_ago: '{count}h ago',
		days_ago: '{count}d ago'
	}
};

beforeEach(() => {
	setStrings('en', 'ltr', EN);
	toast.success.mockClear();
	toast.error.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

/** Text people type that must stay text */
const HOSTILE = ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', 'abc\u202Egpj.exe'];

function expectNoMarkup(container: HTMLElement) {
	expect(container.querySelector('img, script')).toBeNull();
}

const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

describe('user text stays text', () => {
	test.each(HOSTILE)('Tag, TagSet, User, ValueCopy, Facts render %j as text', (s) => {
		const tag = render(Tag, { label: s });
		expect(tag.container.querySelector('.tag-text')?.textContent).toBe(s);
		expectNoMarkup(tag.container);

		const set = render(TagSet, { tags: [s, 'office'] });
		expect([...set.container.querySelectorAll('.tag-text')].map((n) => n.textContent)).toEqual([s, 'office']);
		expectNoMarkup(set.container);

		const user = render(User, { user: { username: 'x', display_name: s }, avatar: true, picture: '' });
		expect(user.container.querySelector('.user-name')?.textContent).toBe(s);
		expectNoMarkup(user.container);

		const value = render(ValueCopy, { value: s });
		expect(value.container.querySelector('.mono')?.textContent).toBe(s);
		expect(value.container.querySelector('.mono')).toHaveAttribute('title', s);
		expectNoMarkup(value.container);

		const facts = render(Facts, { items: [{ label: s, value: s }] });
		expect(facts.container.querySelector('dt')?.textContent).toBe(s);
		expect(facts.container.querySelector('dd')?.textContent?.trim()).toBe(s);
		expectNoMarkup(facts.container);
	});
});

describe('Tag and TagSet', () => {
	test('a tag shows its icon and the full text of a long label on hover', () => {
		const long = 'a tag that is much longer than the column';
		const { container } = render(Tag, { label: long, icon: 'tags' });
		expect(container.querySelector('.tag')).toHaveAttribute('title', long);
		expect(container.querySelector('.material-icons')?.textContent).toBe('sell');
	});
	test('comma text becomes tokens; nothing gives the empty dash', () => {
		const { container } = render(TagSet, { tags: ' office, ,finance ' });
		expect([...container.querySelectorAll('.tag-text')].map((n) => n.textContent)).toEqual([
			'office',
			'finance'
		]);
		const none = render(TagSet, { tags: [] });
		expect(none.container.querySelector('.value-empty')).toHaveTextContent('None');
	});
});

describe('Empty', () => {
	test('the dash is hidden and read as None', () => {
		const { container } = render(Empty);
		const dash = container.querySelector('[aria-hidden="true"]');
		expect(dash?.textContent).toBe('–');
		expect(container.querySelector('.sr-only')?.textContent).toBe('None');
	});
	test('a word replaces the dash', () => {
		render(Empty, { word: 'Never' });
		expect(screen.getByText('Never')).toHaveClass('value-empty');
		expect(document.querySelector('.sr-only')).toBeNull();
	});
});

describe('Time', () => {
	const NOW = new Date('2026-11-08T15:00:00Z');

	test('recent: relative text, the full date in the title and for screen readers', () => {
		vi.useFakeTimers({ now: NOW });
		const { container } = render(Time, { value: '2026-11-08 12:00:00' });
		const time = container.querySelector('time')!;
		expect(time).toHaveAttribute('datetime', '2026-11-08T12:00:00.000Z');
		expect(time.firstChild?.textContent).toBe('3h ago');
		const full = time.getAttribute('title')!;
		expect(full).toMatch(/2026/);
		expect(time.querySelector('.sr-only')?.textContent).toBe(` (${full})`);
	});
	test('relative={false} shows the date itself without a repeat for screen readers', () => {
		vi.useFakeTimers({ now: NOW });
		const { container } = render(Time, { value: '2026-11-08 12:00:00', relative: false });
		const time = container.querySelector('time')!;
		expect(time.textContent).toBe(time.getAttribute('title'));
		expect(time.textContent).toMatch(/2026/);
		expect(time.querySelector('.sr-only')).toBeNull();
	});
	test('format changes the shown date', () => {
		vi.useFakeTimers({ now: NOW });
		const { container } = render(Time, {
			value: '2026-11-08 12:00:00',
			relative: false,
			format: { hour: undefined, minute: undefined }
		});
		expect(container.querySelector('time')!.firstChild?.textContent).not.toMatch(/\d\d:\d\d/);
	});
	test('no date shows the empty word', () => {
		render(Time, { value: null, empty: 'Never' });
		expect(screen.getByText('Never')).toHaveClass('value-empty');
		expect(document.querySelector('time')).toBeNull();
	});
	test('"just now" moves on after a minute (shared clock)', () => {
		vi.useFakeTimers({ now: NOW });
		const { container } = render(Time, { value: NOW.toISOString() });
		const time = () => container.querySelector('time')!.firstChild?.textContent;
		expect(time()).toBe('just now');
		vi.advanceTimersByTime(61_000);
		flushSync();
		expect(time()).toBe('1m ago');
	});
	test('the clock pauses while the tab is hidden', () => {
		vi.useFakeTimers({ now: NOW });
		const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
		const { container } = render(Time, { value: NOW.toISOString() });
		const time = () => container.querySelector('time')!.firstChild?.textContent;
		vi.advanceTimersByTime(3 * 61_000);
		flushSync();
		expect(time()).toBe('just now');
		hidden.mockReturnValue(false);
		document.dispatchEvent(new Event('visibilitychange'));
		flushSync();
		expect(time()).toBe('3m ago');
	});
});

describe('Version and BooleanStatus', () => {
	test('no leading v; empty gives the dash', () => {
		render(Version, { version: 'v1.4.2' });
		expect(screen.getByText('1.4.2')).toHaveClass('version');
		const none = render(Version, { version: '' });
		expect(none.container.querySelector('.value-empty')).not.toBeNull();
	});
	test('on is good, off is neutral, words can change', () => {
		render(BooleanStatus, { value: true });
		expect(screen.getByText('On')).toHaveClass('status', 'is-good');
		render(BooleanStatus, { value: false, off: 'Blocked' });
		expect(screen.getByText('Blocked')).toHaveClass('status', 'is-neutral');
	});
});

describe('Platform', () => {
	test('picks the OS mark from the sprite', () => {
		const { container } = render(Platform, { platform: 'Ubuntu 24.04' });
		const svg = container.querySelector('svg.os-icon')!;
		expect(svg).toHaveClass('os-linux');
		expect(svg).toHaveAttribute('aria-hidden', 'true');
		expect(svg.querySelector('use')?.getAttribute('href')).toMatch(/\/img\/os-icons\.svg#linux$/);
		expect(screen.getByText('Ubuntu 24.04')).toBeInTheDocument();
	});
	test('windows and mac get their own marks', () => {
		const win = render(Platform, { platform: 'Windows 11 Pro' });
		expect(win.container.querySelector('svg')).toHaveClass('os-windows');
		const mac = render(Platform, { platform: 'macOS 15.1' });
		expect(mac.container.querySelector('svg')).toHaveClass('os-apple');
	});
	test('an unknown system keeps an empty box of the same size', () => {
		const { container } = render(Platform, { platform: 'Plan 9' });
		expect(container.querySelector('svg')).toBeNull();
		expect(container.querySelector('.os-icon.os-icon-none')).not.toBeNull();
		expect(screen.getByText('Plan 9')).toBeInTheDocument();
	});
});

describe('Avatar', () => {
	test('a user with a picture shows it as a decorative image', () => {
		const { container } = render(Avatar, {
			user: { id: 7, username: 'linus', has_avatar: true, avatar_version: 3 }
		});
		const box = container.querySelector('.avatar')!;
		expect(box).toHaveAttribute('aria-hidden', 'true');
		const img = box.querySelector('img')!;
		expect(img).toHaveAttribute('src', '/api/users/7/avatar?v=3');
		expect(img).toHaveAttribute('alt', '');
	});
	test('without a picture: initials in the name colour', () => {
		const { container } = render(Avatar, { user: 'Linus Rath', size: 'md' });
		const box = container.querySelector('.avatar')!;
		expect(box.textContent).toBe('LR');
		expect(box).toHaveClass('is-md');
		expect(box.className).toMatch(/\bis-c[1-6]\b/);
		expect(box.querySelector('img')).toBeNull();
	});
	test('a name without letters or digits gets the person icon', () => {
		const { container } = render(Avatar, { user: '!!! ???' });
		expect(container.querySelector('.avatar .material-icons')?.textContent).toBe('person');
	});
	test('a picture that fails to load turns into the initials', async () => {
		const { container } = render(Avatar, { user: 'Linus Rath', picture: '/broken.png' });
		const img = container.querySelector('img')!;
		await fireEvent.error(img);
		const box = container.querySelector('.avatar')!;
		expect(box.querySelector('img')).toBeNull();
		expect(box.textContent).toBe('LR');
		expect(box.className).toMatch(/\bis-c[1-6]\b/);
	});
	test('presence sits on the corner with its label', () => {
		const { container } = render(Avatar, { user: 'Linus', presence: 'busy', presenceLabel: 'Busy' });
		const wrap = container.querySelector('.avatar-presence')!;
		expect(wrap.querySelector('.avatar')).not.toBeNull();
		expect(screen.getByRole('img', { name: 'Busy' })).toHaveClass('presence', 'is-busy');
	});
});

describe('Presence', () => {
	test('each status has its own class; a label makes it an image with a name', () => {
		const classes = (['online', 'away', 'busy', 'offline'] as const).map((status) => {
			render(Presence, { status, label: status.toUpperCase() });
			const el = screen.getByRole('img', { name: status.toUpperCase() });
			return [...el.classList].find((c) => c.startsWith('is-'));
		});
		expect(new Set(classes).size).toBe(4);
		expect(classes).toEqual(['is-online', 'is-away', 'is-busy', 'is-offline']);
	});
	test('without a label it is decorative', () => {
		const { container } = render(Presence, { status: 'online' });
		expect(container.querySelector('.presence')).toHaveAttribute('aria-hidden', 'true');
		expect(screen.queryByRole('img')).toBeNull();
	});
});

describe('User', () => {
	test('a user object shows display name, else first and last name', () => {
		render(User, { user: { username: 'lr', first_name: 'Linus', last_name: 'Rath' } });
		expect(screen.getByText('Linus Rath')).toHaveClass('user-name');
		expect(document.querySelector('.avatar')).toBeNull();
	});
	test('no name gives the empty word', () => {
		render(User, { user: null, empty: 'Unassigned' });
		expect(screen.getByText('Unassigned')).toHaveClass('value-empty');
	});
});

describe('ValueCopy', () => {
	test('copies the full value, shows a tick for 1.5 s and a toast', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const long = '1234567890'.repeat(8);
		render(ValueCopy, { value: long, label: 'Device ID' });
		const btn = screen.getByRole('button', { name: 'Copy Device ID' });
		expect(btn.querySelector('.material-icons')?.textContent).toBe('content_copy');
		await user.click(btn);
		expect(writeText).toHaveBeenCalledWith(long);
		expect(btn).toHaveClass('copied');
		expect(btn.querySelector('.material-icons')?.textContent).toBe('check');
		expect(toast.success).toHaveBeenCalledWith('Copied to clipboard');
		vi.advanceTimersByTime(1500);
		flushSync();
		expect(btn).not.toHaveClass('copied');
		expect(btn.querySelector('.material-icons')?.textContent).toBe('content_copy');
	});
	test('a failed copy shows the error toast and no tick', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('denied'));
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		document.execCommand = vi.fn().mockReturnValue(false);
		render(ValueCopy, { value: '10.0.9.14' });
		const btn = screen.getByRole('button', { name: 'Copy 10.0.9.14' });
		await userEvent.click(btn);
		expect(toast.error).toHaveBeenCalled();
		expect(btn).not.toHaveClass('copied');
	});
	test('no value gives the dash, never in mono', () => {
		const { container } = render(ValueCopy, { value: '  ' });
		expect(container.querySelector('.mono')).toBeNull();
		expect(container.querySelector('.value-empty')).not.toBeNull();
	});
});

describe('ValueField', () => {
	test('hidden value shows dots until Show; Copy copies the value either way', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const { container } = render(ValueField, { value: 'SECRETKEY=', label: 'Server key', hidden: true });
		expect(container.textContent).not.toContain('SECRETKEY=');
		await userEvent.click(screen.getByRole('button', { name: 'Copy Server key' }));
		expect(writeText).toHaveBeenCalledWith('SECRETKEY=');
		await userEvent.click(screen.getByRole('button', { name: 'Show Server key' }));
		expect(container.querySelector('code')?.textContent).toBe('SECRETKEY=');
		expect(screen.getByRole('button', { name: 'Hide Server key' })).toHaveTextContent('Hide');
	});
});

describe('Facts', () => {
	test('blank values show the dash or the item word; snippets render', () => {
		const { container } = render(Facts, {
			items: [
				{ label: 'IP', value: '' },
				{ label: 'Last seen', value: null, empty: 'Never' },
				{ label: 'Status', value: snippet('<span class="probe">ok</span>') }
			]
		});
		const dds = container.querySelectorAll('dd');
		expect(dds[0]?.querySelector('.sr-only')?.textContent).toBe('None');
		expect(dds[1]?.textContent?.trim()).toBe('Never');
		expect(dds[2]?.querySelector('.probe')).not.toBeNull();
	});
});

describe('Meter', () => {
	test('fill width follows the share, the number is text, thresholds colour it', () => {
		const { container } = render(Meter, { value: 45, max: 50 });
		expect(container.querySelector<HTMLElement>('.meter-fill')!.style.width).toBe('90%');
		expect(container.querySelector('.meter-value')?.textContent).toBe('90%');
		expect(container.querySelector('.meter')).toHaveClass('is-high');
	});
});

describe('ShareBar', () => {
	test('legend names every part with its number; zero parts leave the bar only', () => {
		const { container } = render(ShareBar, {
			parts: [
				{ value: 14, label: 'online', tone: 'ok', href: '/devices?status=online' },
				{ value: 0, label: 'banned', tone: 'danger' }
			]
		});
		expect(container.querySelectorAll('.share-bar > span')).toHaveLength(1);
		expect(container.querySelector('.share-bar')).toHaveAttribute('aria-hidden', 'true');
		expect(screen.getByRole('link', { name: '14 online' })).toHaveAttribute('href', '/devices?status=online');
		expect(screen.getByText('banned').closest('li')?.textContent).toMatch(/0\s+banned/);
	});
});

describe('ListRow', () => {
	test('a row with href is one link with a chevron', () => {
		render(ListRow, { title: 'Enrollment requests', count: 3, href: '/registrations' });
		const link = screen.getByRole('link');
		expect(link).toHaveClass('list-row');
		expect(link.querySelector('.row-count')?.textContent).toBe('3');
		expect(link.querySelector('.row-chevron')).not.toBeNull();
		expect(screen.queryAllByRole('button')).toHaveLength(0);
	});
	test('with actions the title is the target and the actions stay outside it', async () => {
		const onclick = vi.fn();
		render(ListRow, {
			title: 'Office PC',
			onclick,
			actions: snippet('<button type="button">Menu</button>')
		});
		const target = screen.getByRole('button', { name: 'Office PC' });
		expect(target).toHaveClass('row-target');
		expect(target.contains(screen.getByRole('button', { name: 'Menu' }))).toBe(false);
		await userEvent.click(target);
		expect(onclick).toHaveBeenCalledOnce();
	});
});

describe('CodeBlock', () => {
	test('Copy copies the whole text', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render(CodeBlock, { code: 'line 1\nline 2', title: 'Install script' });
		await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
		expect(writeText).toHaveBeenCalledWith('line 1\nline 2');
		expect(screen.getByRole('region', { name: 'Install script' }).textContent).toBe('line 1\nline 2');
	});
});

describe('LangFlag', () => {
	test('a mapped language gets its decorative flag; others none', () => {
		const { container } = render(LangFlag, { code: 'de', name: 'Deutsch' });
		const img = container.querySelector('img')!;
		expect(img.getAttribute('src')).toMatch(/\/img\/flags\/de\.svg$/);
		expect(img).toHaveAttribute('alt', '');
		expect(screen.getByText('Deutsch')).toBeInTheDocument();
		const none = render(LangFlag, { code: 'xx', name: 'Klingon' });
		expect(none.container.querySelector('img')).toBeNull();
	});
});

/** Dark cells of the reference matrix as "col,row" */
function darkCells(bytes: string): { n: number; cells: string[] } {
	const ref = qrcode(0, 'M');
	ref.addData(bytes, 'Byte');
	ref.make();
	const n = ref.getModuleCount();
	const cells: string[] = [];
	for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (ref.isDark(r, c)) cells.push(`${c},${r}`);
	return { n, cells };
}

/** Modules drawn in the path, shifted back by the 4-module quiet zone */
function drawnCells(container: HTMLElement): string[] {
	const d = container.querySelector('path')!.getAttribute('d')!;
	return [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${Number(m[1]) - 4},${Number(m[2]) - 4}`);
}

describe('QR', () => {
	test('one module per dark cell inside a 4-module quiet zone', () => {
		const text = 'https://example.com/enroll?token=abc';
		const { container } = render(QR, { text, label: 'QR code', size: 160 });
		const svg = screen.getByRole('img', { name: 'QR code' });
		const { n, cells } = darkCells(text);
		expect(svg).toHaveAttribute('viewBox', `0 0 ${n + 8} ${n + 8}`);
		expect(svg).toHaveAttribute('width', '160');
		expect(drawnCells(container)).toEqual(cells);
		// The finder pattern's corner module sits just inside the quiet zone
		expect(container.querySelector('path')!.getAttribute('d')!.startsWith('M4 4h1v1h-1z')).toBe(true);
	});
	test('text outside Latin-1 is encoded as UTF-8', () => {
		const text = 'Grüße ✓';
		const { container } = render(QR, { text, label: 'QR' });
		const utf8 = String.fromCharCode(...new TextEncoder().encode(text));
		expect(drawnCells(container)).toEqual(darkCells(utf8).cells);
	});
});
