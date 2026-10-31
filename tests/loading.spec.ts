import { expect, test } from '@playwright/test';

const session = { authenticated: true, gatewayAuthenticated: true, allowedOrigins: [] };
const favorites = [
    { id: 'one', name: 'First fixture', url: 'http://127.0.0.1:18791/first', mode: 'embed' },
    { id: 'two', name: 'Second fixture', url: 'http://127.0.0.1:18791/second', mode: 'embed' },
];
const store = { revision: 1, groups: [], favorites };
function gate() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release: () => release() };
}

for (const theme of ['light', 'midnight']) {
    test(`${theme}: startup, slow-frame fallback, and stable navigation`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript((value) => localStorage.setItem('sitedock.theme', value), theme);
        const now = new Date('2026-10-30T12:00:00-07:00');
        await page.clock.install({ time: now });
        await page.clock.pauseAt(now);
        const sessionGate = gate();
        const favoritesGate = gate();
        const sessionRequested = gate();
        const favoritesRequested = gate();
        const frameGate = gate();
        await page.route('**/api/session', async (route) => {
            sessionRequested.release();
            await sessionGate.promise;
            await route.fulfill({ json: session });
        });
        await page.route('**/api/favorites', async (route) => {
            favoritesRequested.release();
            await favoritesGate.promise;
            await route.fulfill({ json: store });
        });
        await page.route('http://127.0.0.1:18791/**', async (route) => {
            await frameGate.promise;
            await route.fulfill({ contentType: 'text/html', body: '<!doctype html><button>Fixture content</button>' });
        });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await sessionRequested.promise;
        const startup = page.getByRole('status', { name: 'Loading Site Dock', exact: true });
        await page.clock.runFor(249);
        await expect(startup).toHaveCount(0);
        await page.clock.runFor(1);
        await expect(startup).toBeAttached();
        const spinner = await startup.elementHandle();
        sessionGate.release();
        await favoritesRequested.promise;
        expect(await startup.evaluate((element, original) => element === original, spinner)).toBe(true);
        favoritesGate.release();
        await expect(page.locator('iframe')).toHaveCount(1);
        await expect(startup).toHaveCount(0);
        const firstFrame = page.locator('iframe[title="First fixture"]');
        const originalFrame = await firstFrame.elementHandle();
        const header = await page.locator('.workspace-header').elementHandle();
        await page.clock.runFor(250);
        const waiting = page.getByRole('status', { name: 'Waiting for First fixture', exact: true });
        await expect(waiting).toHaveCount(0);
        await page.clock.runFor(3750);
        await expect(waiting).toBeVisible();
        await expect(waiting.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', favorites[0].url);
        await expect(firstFrame).not.toHaveClass(/ready/);
        await expect(firstFrame).not.toHaveClass(/loaded/);
        await expect(firstFrame).toHaveCSS('visibility', 'hidden');
        frameGate.release();
        await expect(firstFrame).toHaveClass(/loaded/);
        await expect(firstFrame).toHaveClass(/ready/);
        await expect(waiting).toHaveCount(0);
        await expect(firstFrame).toHaveCSS('animation-duration', '0.6s');
        await page.clock.runFor(600);
        await expect(firstFrame).toHaveCSS('opacity', '1');
        const animations = await firstFrame.evaluate((element) => element.getAnimations().length);
        expect(animations).toBe(0);
        await page.getByRole('button', { name: 'Show favorites' }).click();
        await page.getByRole('button', { name: 'Second fixture', exact: true }).click();
        await page.getByRole('button', { name: 'Show favorites' }).click();
        await page.getByRole('button', { name: 'First fixture', exact: true }).click();
        expect(await firstFrame.evaluate((element, original) => element === original, originalFrame)).toBe(true);
        expect(
            await page.locator('.workspace-header').evaluate((element, original) => element === original, header)
        ).toBe(true);
        await expect(waiting).toHaveCount(0);
        await page.getByRole('button', { name: 'Reload selected site' }).click();
        await expect(firstFrame).toHaveClass(/ready/);
        await expect(firstFrame).not.toHaveClass(/first-reveal/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.getByRole('button', { name: 'Show favorites' }).click();
        await page
            .getByRole('complementary', { name: 'Favorites' })
            .getByRole('button', { name: 'Add favorite', exact: true })
            .click();
        await expect(page.getByRole('dialog', { name: 'Add favorite' })).toBeVisible();
        await expect(page.getByLabel('Name', { exact: true })).toBeFocused();
    });
}

test('reduced motion keeps a slow frame hidden until it loads', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1024, height: 768 });
    const now = new Date('2026-10-30T12:00:00-07:00');
    await page.clock.install({ time: now });
    await page.clock.pauseAt(now);
    const frameGate = gate();
    await page.route('**/api/session', (route) => route.fulfill({ json: session }));
    await page.route('**/api/favorites', (route) => route.fulfill({ json: store }));
    await page.route('http://127.0.0.1:18791/**', async (route) => {
        await frameGate.promise;
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><p>Fixture</p>' });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('iframe')).toHaveCount(1);
    await page.clock.runFor(4000);
    const frame = page.locator('iframe[title="First fixture"]');
    await expect(page.getByRole('status', { name: 'Waiting for First fixture' })).toBeVisible();
    await expect(frame).toHaveCSS('visibility', 'hidden');
    await expect(frame).toHaveCSS('opacity', '0');
    frameGate.release();
    await expect(frame).toHaveClass(/loaded/);
    await expect(frame).toHaveCSS('animation-name', 'none');
    await expect(frame).toHaveCSS('opacity', '1');
});
