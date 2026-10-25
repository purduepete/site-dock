import { expect, test } from '@playwright/test';

test('iPad desktop identity suppresses action hints but keeps Info help on tap', async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    });
    await page.goto('/');
    await page.getByLabel(/username/i).fill('browser-owner');
    await page.getByLabel(/^password/i).fill('browser-test-password-123');
    await page.getByRole('button', { name: /sign in/i }).click();
    const action = page.getByRole('button', { name: 'Minimize favorites' });
    await action.hover();
    await action.focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    const info = page.getByRole('button', { name: 'Groups information', exact: true });
    await info.hover();
    await info.focus();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await info.click();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('site modal and shared group ordering work in both themes and on narrow screens', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel(/username/i).fill('browser-owner');
    await page.getByLabel(/^password/i).fill('browser-test-password-123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const response = await page.request.get('/api/favorites');
    const store = await response.json();
    const seeded = await page.request.put('/api/favorites', {
        data: {
            baseRevision: store.revision,
            groups: ['Personal', 'Sports', 'News'],
            favorites: [{ id: 'example', name: 'Example', url: 'https://example.com/', mode: 'external' }],
        },
        headers: { Origin: 'http://127.0.0.1:18790' },
    });
    expect(seeded.ok()).toBe(true);
    await page.reload();
    for (const theme of ['Light', 'Midnight']) {
        await page.getByRole('combobox', { name: 'Theme' }).click();
        await page.getByRole('option', { name: theme, exact: true }).click();
        const themeControl = page.getByRole('combobox', { name: 'Theme' });
        await themeControl.hover();
        await themeControl.focus();
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await expect(themeControl).not.toHaveAttribute('aria-describedby');
        await expect(page.locator('button[title], a[title], div[title]')).toHaveCount(0);
        const info = page.getByRole('button', { name: 'Groups information', exact: true });
        await page.getByText('FAVORITES', { exact: false }).first().hover();
        await expect(page.getByRole('tooltip')).toHaveCount(0);
        await info.hover();
        const help = page.getByRole('tooltip');
        await expect(help).toBeVisible();
        await expect(help).toHaveCSS('border-radius', '0px');
        await help.hover();
        await expect(help).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(help).toHaveCount(0);
        await info.focus();
        await expect(help).toBeVisible();
        await page.keyboard.press('Tab');
        await expect(info).toHaveAttribute('aria-expanded', 'false');
        await info.click();
        await expect(help).toBeVisible();
        await page.getByRole('heading', { level: 1 }).click();
        await expect(info).toHaveAttribute('aria-expanded', 'false');
        const edit = page.getByRole('button', { name: 'Edit Example' });
        await edit.click();
        const modal = page.getByRole('dialog', { name: 'Edit favorite' });
        await expect(modal).toBeVisible();
        await expect(modal.getByLabel('Name', { exact: true })).toBeFocused();
        await expect(modal).toHaveCSS('border-radius', '0px');
        for (const label of ['Groups', 'Open preference']) {
            const row = modal.locator('.field-heading').filter({ hasText: label });
            const icon = row.getByRole('button');
            await expect(icon).toHaveCSS('border-top-width', '0px');
            await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await icon.hover();
            await expect(icon).toHaveCSS('border-top-width', '0px');
            await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            await page.keyboard.press('Escape');
            const labelBounds = await row.boundingBox();
            const iconBounds = await row.getByRole('button').boundingBox();
            expect(iconBounds!.y).toBeGreaterThanOrEqual(labelBounds!.y);
            expect(iconBounds!.y + iconBounds!.height).toBeLessThanOrEqual(labelBounds!.y + labelBounds!.height + 1);
        }
        await modal.getByRole('button', { name: 'Group membership information' }).click();
        await expect(modal.getByRole('tooltip')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modal).toBeVisible();
        await modal.getByLabel('Name', { exact: true }).focus();
        for (let step = 0; step < 12; step++) {
            await page.keyboard.press('Tab');
            expect(
                await modal.evaluate(
                    (element) => element.contains(document.activeElement) || document.activeElement === document.body
                )
            ).toBe(true);
        }
        await modal.getByRole('combobox', { name: 'Open preference' }).click();
        await expect(modal.getByRole('combobox', { name: 'Open preference' })).not.toHaveAttribute('aria-describedby');
        await expect(modal.getByRole('tooltip')).toHaveCount(0);
        await expect(modal.getByRole('listbox')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modal).toBeVisible();
        await expect(modal.getByRole('listbox')).toHaveCount(0);
        await modal.getByRole('combobox', { name: 'Open preference' }).click();
        await modal.getByRole('option', { name: 'Inside Site Dock', exact: true }).click();
        await expect(modal.getByRole('combobox')).toHaveText('Inside Site Dock');
        await expect(page.locator('select, datalist')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(modal).toHaveCount(0);
        await expect(edit).toBeFocused();
    }
    await page.getByRole('combobox', { name: 'Group' }).click();
    await page.getByRole('option', { name: 'Reorder groups...' }).click();
    const order = page.getByRole('dialog', { name: 'Reorder groups' });
    await order.getByRole('button', { name: 'Move Sports up' }).click();
    await order.getByRole('button', { name: 'Save order' }).click();
    await expect(order).toHaveCount(0);
    await page.reload();
    await page.getByRole('combobox', { name: 'Group' }).click();
    await expect(page.getByRole('option')).toHaveText([
        'All sites',
        'Sports',
        'Personal',
        'News',
        'Create group...',
        'Reorder groups...',
    ]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+g');
    await expect(page.getByRole('dialog').getByRole('option')).toHaveText([
        'All sites1',
        'Sports0',
        'Personal0',
        'News0',
    ]);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Show favorites' }).click();
    await page.getByRole('button', { name: 'Edit Example' }).click();
    const modal = page.getByRole('dialog', { name: 'Edit favorite' });
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Group membership information' }).dispatchEvent('click');
    const help = modal.getByRole('tooltip');
    await expect(help).toBeVisible();
    const helpBounds = await help.boundingBox();
    expect(helpBounds!.x).toBeGreaterThanOrEqual(0);
    expect(helpBounds!.x + helpBounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    const bounds = await modal.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await modal.getByLabel('Name', { exact: true }).fill('Renamed');
    await modal.getByRole('button', { name: 'Save favorite' }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Renamed', exact: true, level: 1 })).toBeVisible();
});
