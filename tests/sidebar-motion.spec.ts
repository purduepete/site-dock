import { expect, test, type Locator } from '@playwright/test';

async function midpoint(sidebar: Locator, property: string) {
    return sidebar.evaluate((element, name) => {
        const animation = element
            .getAnimations()
            .find((candidate) => candidate instanceof CSSTransition && candidate.transitionProperty === name);
        if (!animation) throw new Error(`Missing ${name} transition`);
        expectDuration(animation.effect?.getTiming().duration);
        animation.pause();
        animation.currentTime = 150;
        const style = getComputedStyle(element);
        return { width: parseFloat(style.width), transform: style.transform, visibility: style.visibility };

        function expectDuration(duration: number | string | undefined) {
            if (duration !== 300) throw new Error(`Expected 300ms transition, received ${duration}`);
        }
    }, property);
}

for (const theme of ['light', 'midnight']) {
    test(`${theme}: favorites animate in both directions without replacing frames`, async ({ page }) => {
        await page.addInitScript((value) => localStorage.setItem('sitedock.theme', value), theme);
        await page.route('**/api/session', (route) =>
            route.fulfill({ json: { authenticated: true, gatewayAuthenticated: true, allowedOrigins: [] } })
        );
        await page.route('**/api/favorites', (route) =>
            route.fulfill({
                json: {
                    revision: 1,
                    groups: [],
                    favorites: [{ id: 'one', name: 'Fixture', url: 'http://127.0.0.1:18791/', mode: 'embed' }],
                },
            })
        );
        await page.goto('/');
        const sidebar = page.locator('.sidebar');
        const frame = await page.locator('iframe').elementHandle();
        await expect(sidebar).toHaveCSS('width', '280px');
        for (const name of ['Minimize favorites', 'Expand favorites']) {
            await page.getByRole('button', { name, exact: true }).click();
            const sample = await midpoint(sidebar, 'width');
            expect(sample.width).toBeGreaterThan(50);
            expect(sample.width).toBeLessThan(280);
            await sidebar.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
        }
        // Reversing an unfinished transition must still reach the expanded width.
        await page.getByRole('button', { name: 'Minimize favorites' }).click();
        await midpoint(sidebar, 'width');
        await page.getByRole('button', { name: 'Expand favorites' }).click();
        await expect(sidebar).toHaveCSS('width', '280px');
        const handle = page.getByRole('separator', { name: 'Sidebar width' });
        const bounds = await handle.boundingBox();
        if (!bounds) throw new Error('Resize handle is missing');
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 40, bounds.y + 100);
        await expect(sidebar).toHaveCSS('transition-duration', '0s');
        await page.mouse.up();

        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByRole('button', { name: 'Show favorites' }).click();
        const opening = await midpoint(sidebar, 'transform');
        expect(opening.visibility).toBe('visible');
        expect(opening.transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
        await sidebar.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
        await sidebar.getByRole('button', { name: 'Close favorites' }).click();
        const closing = await midpoint(sidebar, 'transform');
        expect(closing.visibility).toBe('visible');
        expect(closing.transform).not.toBe('matrix(1, 0, 0, 1, 0, 0)');
        await sidebar.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
        await expect(sidebar).toHaveCSS('visibility', 'hidden');
        expect(await page.locator('iframe').evaluate((element, original) => element === original, frame)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.getByRole('button', { name: 'Show favorites' }).click();
        await expect(sidebar).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
        await sidebar.getByRole('button', { name: 'Close favorites' }).click();
        await expect(sidebar).toHaveCSS('visibility', 'hidden');
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.getByRole('button', { name: 'Minimize favorites' }).click();
        await expect(sidebar).toHaveCSS('width', '50px');
        await page.getByRole('button', { name: 'Expand favorites' }).click();
        expect(await sidebar.evaluate((element) => element.getAnimations().length)).toBe(0);
    });
}
