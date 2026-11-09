import { describe, expect, test } from 'vitest';
import {
	avatarColor,
	avatarUrl,
	cleanVersion,
	displayName,
	iconName,
	initials,
	platformId,
	statusTone
} from '../../src/lib/util/display.ts';
import { readPref, writePref } from '../../src/lib/util/storage.ts';

describe('statusTone', () => {
	test('maps words to the five tones', () => {
		expect(statusTone('Online')).toBe('good');
		expect(statusTone('in progress')).toBe('waiting');
		expect(statusTone('offline')).toBe('neutral');
		expect(statusTone('no-signal')).toBe('warning');
		expect(statusTone('banned')).toBe('danger');
		expect(statusTone('danger')).toBe('danger');
		expect(statusTone('whatever')).toBe('neutral');
		expect(statusTone(null)).toBe('neutral');
	});
});

describe('initials', () => {
	test('letters and digits only, two at most', () => {
		expect(initials('Linus Rath')).toBe('LR');
		expect(initials('demo_ui_admin')).toBe('DU');
		expect(initials('linus.rath@example.com')).toBe('LR');
		expect(initials('admin')).toBe('AD');
		expect(initials('<img src=x>')).toBe('IS');
		expect(initials('!!! ???')).toBe('');
		expect(initials('')).toBe('');
		expect(initials('élodie')).toBe('ÉL');
		expect(initials('42 support')).toBe('4S');
	});
	test('uppercases with the locale', () => {
		expect(initials('ilker', 'tr')).toBe('İL');
	});
});

describe('people', () => {
	test('same name, same colour, in 1..6', () => {
		expect(avatarColor('Linus Rath')).toBe(avatarColor(' linus rath '));
		const c = avatarColor('x');
		expect(c).toBeGreaterThanOrEqual(1);
		expect(c).toBeLessThanOrEqual(6);
	});
	test('display name order', () => {
		expect(displayName({ username: 'u', display_name: 'Dee' })).toBe('Dee');
		expect(displayName({ username: 'u', first_name: 'A', last_name: 'B' })).toBe('A B');
		expect(displayName({ username: 'u' })).toBe('u');
		expect(displayName('plain')).toBe('plain');
	});
	test('avatar URL only for numeric ids with a version', () => {
		expect(avatarUrl({ id: 3, avatar_version: 'abc' })).toBe('/api/users/3/avatar?v=abc');
		expect(avatarUrl({ id: 3, avatar_version: 'abc', has_avatar: false })).toBe('');
		expect(avatarUrl({ id: '../x', avatar_version: 'abc' })).toBe('');
		expect(avatarUrl({ id: 3 })).toBe('');
	});
});

describe('platform, version, icons', () => {
	test('platform marks', () => {
		expect(platformId('Windows 11 Pro')).toBe('windows');
		expect(platformId('macOS 15.1')).toBe('apple');
		expect(platformId('Ubuntu 24.04')).toBe('linux');
		expect(platformId('Android 14')).toBe('android');
		expect(platformId('ChromeOS')).toBe('chrome');
		expect(platformId('Plan 9')).toBe('');
		expect(platformId(null)).toBe('');
	});
	test('versions lose a leading v', () => {
		expect(cleanVersion('v1.4.2')).toBe('1.4.2');
		expect(cleanVersion('version')).toBe('version');
		expect(cleanVersion(null)).toBe('');
	});
	test('icon names are meanings or sanitised glyph names', () => {
		expect(iconName('ban')).toBe('block');
		expect(iconName('settings')).toBe('settings');
		expect(iconName('x"><script>')).toBe('xscript');
	});
});

describe('storage', () => {
	test('works when localStorage throws', () => {
		const orig = Object.getOwnPropertyDescriptor(window, 'localStorage');
		Object.defineProperty(window, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('denied');
			}
		});
		try {
			writePref('k', 'v');
			expect(readPref('k')).toBe('v');
			writePref('k', null);
			expect(readPref('k')).toBeNull();
		} finally {
			if (orig) Object.defineProperty(window, 'localStorage', orig);
		}
	});
});
