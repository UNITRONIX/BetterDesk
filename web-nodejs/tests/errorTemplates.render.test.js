'use strict';

/**
 * Error templates must render with no locals at all.
 *
 * Issue #513: panelAccessGuard renders errors/403 before initI18n() has run,
 * so `lang`, `appName` and `_()` were undefined and the 403 page threw. The
 * throw was then handled by the 500 handler, which threw the same way, and the
 * browser got Express's bare "Internal Server Error".
 *
 * These tests render each template with an empty locals object so any
 * reintroduced unguarded variable fails here instead of in production.
 */

const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const VIEWS = path.join(__dirname, '..', 'views', 'errors');

function render(template, locals = {}) {
    const source = fs.readFileSync(path.join(VIEWS, template), 'utf8');
    return ejs.render(source, locals, { filename: path.join(VIEWS, template) });
}

describe('error templates render without i18n/branding locals', () => {
    test.each(['403.ejs', '404.ejs', '500.ejs'])('%s renders with empty locals', (template) => {
        const html = render(template);
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('BetterDesk');
        expect(html.length).toBeGreaterThan(300);
    });

    test.each([
        ['403.ejs', '403'],
        ['404.ejs', '404'],
        ['500.ejs', '500'],
    ])('%s keeps its status code visible', (template, code) => {
        expect(render(template)).toContain(`error-code">${code}<`);
    });

    test('403 uses the title/message passed by panelAccessGuard', () => {
        const html = render('403.ejs', {
            title: 'Forbidden',
            message: 'You do not have permission to access this panel section',
        });
        // With no _() available the English fallback keeps the server-provided
        // message instead of a generic one.
        expect(html).toContain('Forbidden');
    });

    test('403 prefers translations when an i18n helper is available', () => {
        const html = render('403.ejs', {
            lang: 'de',
            appName: 'BetterDesk DE',
            _: (key, fallback) => {
                const dict = {
                    'errors.forbidden_title': 'Zugriff verweigert',
                    'errors.forbidden_message': 'Kein Zugriff',
                    'errors.go_home': 'Zur Startseite',
                };
                return dict[key] || fallback || key;
            },
        });
        expect(html).toContain('<html lang="de">');
        expect(html).toContain('BetterDesk DE');
        expect(html).toContain('Zugriff verweigert');
    });

    test('500 survives a missing, null or string error local', () => {
        for (const locals of [{}, { error: null }, { error: 'boom' }, { error: new Error('boom') }]) {
            expect(() => render('500.ejs', locals)).not.toThrow();
        }
    });

    test('500 does not leak error details outside development', () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const html = render('500.ejs', { error: new Error('secret stack detail') });
            expect(html).not.toContain('secret stack detail');
        } finally {
            process.env.NODE_ENV = previous;
        }
    });
});
