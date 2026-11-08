/**
 * Data display helpers in public/js/utils.js: every value kind renders with
 * one component, escapes what it is given, and maps status words to tones.
 */
global.window = global.window || { BetterDesk: { lang: 'en' } };
const Utils = require('../public/js/utils.js');

const evil = '<img src=x onerror="alert(1)">\'';

describe('data display helpers', () => {
    test('escape text and attribute values', () => {
        for (const html of [
            Utils.statusHtml('good', evil, { title: evil }),
            Utils.tagHtml(evil, { title: evil }),
            Utils.tagsHtml([evil]),
            Utils.valueHtml(evil, { copy: true }),
            Utils.versionHtml(evil),
            Utils.platformHtml(evil),
            Utils.userHtml(evil, { avatar: true, picture: evil }),
            Utils.emptyHtml(evil),
        ]) {
            expect(html).not.toMatch(/<img src=x/);
            expect(html).not.toMatch(/="alert/);
            expect(html).not.toMatch(/'"/);
        }
    });

    test('map status words onto the five tones', () => {
        expect(Utils.statusHtml('pending', 'Waiting')).toBe('<span class="status is-waiting">Waiting</span>');
        expect(Utils.statusTone('approved')).toBe('good');
        expect(Utils.statusTone('Rejected')).toBe('neutral');
        expect(Utils.statusTone('no signal')).toBe('warning');
        expect(Utils.statusTone('failed')).toBe('danger');
        expect(Utils.statusTone('something new')).toBe('neutral');
    });

    test('show one muted dash for missing values, read as None', () => {
        const empty = '<span class="value-empty"><span aria-hidden="true">–</span><span class="sr-only">None</span></span>';
        expect(Utils.tagsHtml([])).toBe(empty);
        expect(Utils.valueHtml('')).toBe(empty);
        expect(Utils.timeHtml(null)).toBe(empty);
        expect(Utils.timeHtml('0001-01-01T00:00:00Z', { empty: 'Never' })).toBe('<span class="value-empty">Never</span>');
    });

    test('times carry a datetime and the full date for screen readers', () => {
        const html = Utils.timeHtml('2026-01-02 03:04:05');
        expect(html).toMatch(/^<time class="time" datetime="2026-01-02T03:04:05\.000Z" title="[^"]+">/);
    });

    test('versions drop a leading v; copy buttons carry the full value', () => {
        expect(Utils.versionHtml('v1.4.2')).toBe('<span class="version">1.4.2</span>');
        expect(Utils.valueHtml('10.0.0.5', { copy: true })).toContain('data-copy-value="10.0.0.5"');
    });

    test('avatars: picture when there is one, otherwise initials in a stable colour', () => {
        expect(Utils.initials('Linus Rath')).toBe('LR');
        expect(Utils.avatarColor('Linus Rath')).toBe(Utils.avatarColor(' linus rath '));
        expect(Utils.avatarBoxHtml('Linus Rath')).toMatch(/^<span class="avatar is-c[1-6]" aria-hidden="true">LR<\/span>$/);
        expect(Utils.avatarBoxHtml('Jan', { picture: '/api/users/3/avatar', size: 'md' }))
            .toBe('<span class="avatar is-md" aria-hidden="true"><img src="/api/users/3/avatar" alt="" loading="lazy"></span>');
    });

    test('numbers, sizes, durations and percentages in the console language', () => {
        expect(Utils.formatBytes(1610612736)).toBe('1.5 GB');
        expect(Utils.formatDuration(183900)).toBe('2d 3h');
        expect(Utils.formatPercent(62.4)).toBe('62%');
        expect(Utils.formatNumber(12345)).toBe('12,345');
    });
});
