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

async function contentLayouts(sidebar: Locator, times: number[] = []) {
    return sidebar.evaluate((element, times) => {
        const read = () => ({
            sections: [...element.children].map((child) => {
                const rect = child.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            }),
            text: [...element.querySelectorAll('.wordmark, .dropdown-trigger > span, .account > span')].map((label) => {
                const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
                const rects = [];
                while (walker.nextNode()) {
                    if (!walker.currentNode.textContent?.trim()) continue;
                    const range = document.createRange();
                    range.selectNodeContents(walker.currentNode);
                    rects.push(
                        ...[...range.getClientRects()]
                            .filter((rect) => rect.width && rect.height)
                            .map(({ x, y, width, height }) => ({ x, y, width, height }))
                    );
                }
                return rects;
            }),
        });
        if (!times.length) return [read()];
        const animation = element
            .getAnimations()
            .find((candidate) => candidate instanceof CSSTransition && candidate.transitionProperty === 'width');
        if (!animation) throw new Error('Missing width transition');
        return times.map((time) => {
            animation.currentTime = time;
            return read();
        });
    }, times);
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
        await page.evaluate(() => document.fonts.ready);
        const handle = page.getByRole('separator', { name: 'Sidebar width' });
        for (const width of [280, 220, 480]) {
            if (width !== 280) await handle.press(width === 220 ? 'Home' : 'End');
            await expect(sidebar).toHaveCSS('width', `${width}px`);
            for (const name of ['Minimize favorites', 'Expand favorites']) {
                await page.getByRole('button', { name, exact: true }).click();
                const sample = await midpoint(sidebar, 'width');
                expect(sample.width).toBeGreaterThan(50);
                expect(sample.width).toBeLessThan(width);
                const layouts = await contentLayouts(sidebar, [30, 90, 150, 240, 299]);
                await sidebar.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()));
                const [finalLayout] = await contentLayouts(sidebar);
                for (const layout of layouts) expect(layout).toEqual(finalLayout);
            }
        }
        // Reversing an unfinished transition must still reach the expanded width.
        await page.getByRole('button', { name: 'Minimize favorites' }).click();
        await midpoint(sidebar, 'width');
        await page.getByRole('button', { name: 'Expand favorites' }).click();
        await expect(sidebar).toHaveCSS('width', '480px');
        const bounds = await handle.boundingBox();
        if (!bounds) throw new Error('Resize handle is missing');
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
        await page.mouse.down();
        await page.mouse.move(bounds.x - 40, bounds.y + 100);
        await expect(sidebar).toHaveCSS('transition-duration', '0s');
        const [dragLayout] = await contentLayouts(sidebar);
        const dragWidth = await sidebar.evaluate((element) => element.getBoundingClientRect().width);
        for (const section of dragLayout.sections) expect(section.width).toBe(dragWidth);
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
