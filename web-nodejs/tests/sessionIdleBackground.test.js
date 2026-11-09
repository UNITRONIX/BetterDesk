/**
 * Requests marked `X-BD-Background: 1` (the console's polls and reads) are
 * checked against the idle and absolute limits but don't count as
 * activity, so the idle sign-out works while a console tab is open
 * (BUGS.md U2). Requests without the header still count.
 */

const panelSessionService = require('../services/panelSessionService');

function req({ background = false, lastActivityAt, createdAt }) {
    return {
        session: { userId: 7, createdAt, lastActivityAt, cookie: {} },
        get: (h) => (background && h.toLowerCase() === 'x-bd-background' ? '1' : undefined)
    };
}

describe('session activity', () => {
    const { idleTimeoutMs } = panelSessionService.getPolicy();
    const now = Date.now();

    test('a normal request moves the last activity', () => {
        const r = req({ createdAt: now - 60_000, lastActivityAt: now - 60_000 });
        expect(panelSessionService.touchActivity(r)).toEqual({ ok: true });
        expect(r.session.lastActivityAt).toBeGreaterThanOrEqual(now);
    });

    test('a background request leaves the last activity and the cookie alone', () => {
        const last = now - 60_000;
        const r = req({ background: true, createdAt: last, lastActivityAt: last });
        expect(panelSessionService.touchActivity(r)).toEqual({ ok: true });
        expect(r.session.lastActivityAt).toBe(last);
        expect(r.session.cookie.expires).toBeUndefined();
    });

    test('a background request still ends an idle session', () => {
        const last = now - idleTimeoutMs - 1000;
        const r = req({ background: true, createdAt: last, lastActivityAt: last });
        expect(panelSessionService.touchActivity(r)).toMatchObject({ ok: false, reason: 'idle' });
    });
});
