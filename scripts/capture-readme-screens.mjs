/**
 * Capture marketing screenshots from a running local BetterDesk console.
 * Usage:
 *   node scripts/capture-readme-screens.mjs
 * Env:
 *   BD_URL (default http://127.0.0.1:5000)
 *   BD_USER / BD_PASS
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const requireFromTmp = createRequire(path.join(root, '.tmp-playwright', 'package.json'));
const { chromium } = requireFromTmp('playwright');
const outDir = path.join(root, 'screenshots', 'generated');
fs.mkdirSync(outDir, { recursive: true });

const base = process.env.BD_URL || 'http://127.0.0.1:5000';
const user = process.env.BD_USER || 'admin';
const pass = process.env.BD_PASS;
if (!pass) {
  console.error('Set BD_PASS (and optionally BD_USER / BD_URL) before capturing.');
  process.exit(1);
}

const shots = [
  { name: 'login-dark.png', path: '/login', beforeLogin: true },
  { name: 'dashboard-dark.png', path: '/' },
  { name: 'devices-list-dark.png', path: '/devices' },
  { name: 'device-details-dark.png', path: '/devices', openFirstDevice: true },
  { name: 'settings-updates-dark.png', path: '/settings#updates' },
  { name: 'remote-dark.png', path: '/remote' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  locale: 'en-US',
});
const page = await context.newPage();

async function dismissModals() {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
  }
  const blockers = page.locator(
    'button:has-text("Close"), button[aria-label="Close"], .modal .btn-close, [data-dismiss="modal"], button:has-text("Not now"), button:has-text("Later"), button:has-text("Dismiss")'
  );
  const n = await blockers.count();
  for (let i = 0; i < n; i++) {
    await blockers.nth(i).click({ timeout: 500 }).catch(() => {});
  }
  // Public endpoints required modal — Escape usually closes it; if not, open settings then leave.
  const endpointsBtn = page.locator('button:has-text("Open public endpoints settings")');
  if (await endpointsBtn.count()) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
    if (await endpointsBtn.isVisible().catch(() => false)) {
      await page.evaluate(() => {
        document.querySelectorAll('.modal, [role="dialog"], .overlay').forEach((el) => {
          el.remove();
        });
        document.body.classList.remove('modal-open');
      }).catch(() => {});
    }
  }
}

// Login shot first (logged out)
{
  await context.clearCookies();
  await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(outDir, 'login-dark.png'),
    fullPage: false,
  });
  console.log('wrote login-dark.png');
}

// Authenticate
await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
await page.fill('input[name="username"], input#username, input[type="text"]', user);
await page.fill('input[name="password"], input#password, input[type="password"]', pass);
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
  page.click('button[type="submit"], button:has-text("Login")'),
]);
await page.waitForTimeout(1000);
await dismissModals();

async function showAllDevicesFilter() {
  // Demo peers are not live-online; an "Online" filter hides them.
  const status = page.locator('#device-status-filter');
  if (await status.count()) {
    await status.selectOption('all').catch(async () => {
      await status.selectOption({ label: /all/i }).catch(() => {});
    });
    await page.waitForTimeout(1000);
  }
}

for (const shot of shots) {
  if (shot.beforeLogin) continue;
  await page.goto(`${base}${shot.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await dismissModals();

  if (shot.path.startsWith('/devices')) {
    await showAllDevicesFilter();
    await page
      .waitForSelector('table tbody tr, .devices-table tbody tr, [data-device-id]', {
        timeout: 5000,
      })
      .catch(() => {});
    // Hide local-only address-book bridge warning for marketing shots.
    await page.evaluate(() => {
      document.querySelectorAll('.devices-page, main, body').forEach((root) => {
        root.querySelectorAll('p, .alert, .banner, .hint, .form-hint, .text-muted').forEach((el) => {
          if (/PANEL_TRUST_SECRET|address-book names are unavailable/i.test(el.textContent || '')) {
            el.style.display = 'none';
          }
        });
      });
    }).catch(() => {});
  }

  if (shot.openFirstDevice) {
    const row = page.locator('table tbody tr').first();
    if (await row.count()) {
      await row.dblclick({ timeout: 3000 }).catch(async () => {
        await row.click({ timeout: 3000 }).catch(() => {});
      });
      await page.waitForTimeout(1500);
      // Prefer navigating to a device detail URL if the table exposes data-id.
      const id = await row.getAttribute('data-device-id').catch(() => null)
        || await row.locator('td').first().innerText().catch(() => '');
      const cleanId = String(id || '').trim();
      if (cleanId && /^\d+$/.test(cleanId)) {
        await page.goto(`${base}/devices?id=${cleanId}`, { waitUntil: 'networkidle' }).catch(() => {});
        await showAllDevicesFilter();
        await page.waitForTimeout(1000);
        await row.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
      await dismissModals();
    }
  }

  await page.screenshot({
    path: path.join(outDir, shot.name),
    fullPage: false,
  });
  console.log('wrote', shot.name);
}

await browser.close();
console.log('done ->', outDir);
