import { expect, test } from '@playwright/test';

test('requires login, rejects invalid credentials, and supports keyboard access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  await page.getByLabel(/username/i).fill('wrong-owner');
  await page.getByLabel(/^password/i).fill('incorrect password for this test');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('retains the supplied embedded apps and supports editing and themes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') console.log(`Browser console: ${message.text()}`);
  });
  page.on('requestfailed', request => console.log(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto('/');
  await page.getByLabel(/username/i).fill('browser-owner');
  await page.getByLabel(/^password/i).fill('browser-test-password-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  const header = page.locator('.workspace-header');
  await expect.poll(async () => (await header.boundingBox())?.height ?? 100).toBeLessThanOrEqual(44);
  await expect(header.getByText('EMBEDDED SITE')).toHaveCount(0);
  const sidebar = page.getByRole('complementary', { name: 'Favorites' });
  await expect(page.getByRole('button', { name: 'Minimize favorites' })).toHaveText('S');
  const firstFrame = page.locator('iframe').first();
  const frameHandle = await firstFrame.elementHandle();
  await page.getByRole('button', { name: 'Minimize favorites' }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '50px');
  await expect(page.getByRole('button', { name: 'Ferry Tracker', exact: true })).toBeVisible();
  await expect(sidebar.locator('.site-icon').first()).toBeVisible();
  await expect(sidebar.locator('.favorite-select > span').first()).not.toBeVisible();
  await expect(page.getByRole('separator', { name: 'Sidebar width' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand favorites', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand favorites', exact: true })).toHaveText('S');
  expect(await firstFrame.evaluate((element, original) => element === original, frameHandle)).toBe(true);
  await page.getByRole('button', { name: 'SmartDevices', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'SmartDevices', exact: true })).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '50px');
  await page.screenshot({ path: 'test-results/sidebar-minimized.png', fullPage: true });
  await page.reload();
  await expect(sidebar).toHaveCSS('width', '50px');
  await page.getByRole('button', { name: 'Expand favorites', exact: true }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveCSS('width', '280px');
  const response = await page.request.get('/api/favorites');
  const store = await response.json() as {
    revision: number;
    favorites: { id: string; name: string; url: string; mode: string }[];
  };
  const embedded = store.favorites.filter(favorite => favorite.mode === 'embed');
  for (const favorite of embedded) {
    await page.getByText(favorite.name, { exact: true }).first().click();
    await expect.poll(() => page.frames().some(frame => frame.url().startsWith(favorite.url)), {
      message: `Load ${favorite.name} at its saved URL`,
      timeout: 15_000,
    }).toBe(true);
  }
  expect(page.frames().length).toBeGreaterThanOrEqual(embedded.length + 1);
  for (const favorite of embedded) {
    const frame = page.frames().find(candidate => candidate.url().startsWith(favorite.url));
    expect(frame).toBeDefined();
    await expect.poll(async () => (await frame!.locator('body').innerText()).trim().length, {
      message: `${favorite.name} rendered content`,
      timeout: 15_000,
    }).toBeGreaterThan(0);
    const text = await frame!.locator('body').innerText();
    console.log(`Embedded app ${favorite.name}: ${text.trim().slice(0, 150).replace(/\s+/g, ' ')}`);
  }
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f5fb');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(244, 245, 251)');
  await page.screenshot({ path: 'test-results/dashboard-light.png', fullPage: true });
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#020617');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(2, 6, 23)');
  await expect(page.getByRole('button', { name: /sign out/i })).toHaveCSS('border-radius', '0px');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('14px "Roboto Flex Variable"'))).toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /Roboto Flex Variable/);
  await page.screenshot({ path: 'test-results/dashboard-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser test');
  await page.getByLabel('Website address', { exact: true }).fill('https://example.com/');
  await page.getByRole('combobox', { name: 'Open preference' }).click();
  await page.getByRole('option', { name: 'Separate tab', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Open preference' })).toHaveText('Separate tab');
  await expect(page.getByRole('button', { name: 'Save favorite', exact: true })).toHaveCSS('background-image', 'none');
  await expect(page.getByRole('button', { name: 'Save favorite', exact: true })).toHaveCSS('background-color', 'rgb(107, 140, 174)');
  await expect(page.getByRole('button', { name: 'Save favorite', exact: true })).toHaveCSS('color', 'rgb(15, 23, 42)');
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser test', exact: true, level: 1 })).toBeVisible();
  await expect.poll(async () => {
    const saved = await page.request.get('/api/favorites');
    const value = await saved.json() as { favorites: { name: string }[] };
    return value.favorites.some(favorite => favorite.name === 'Browser test');
  }).toBe(true);
  await page.getByRole('button', { name: 'Delete Browser test', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Delete favorite?' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await expect(modal.getByRole('button', { name: 'Delete favorite' })).toHaveCSS('background-image', 'none');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete Browser test', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Delete Browser test', exact: true }).click();
  await modal.getByRole('button', { name: 'Delete favorite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Browser test', exact: true })).toHaveCount(0);
  await expect(page.locator('select')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('custom dropdown stays inside narrow and tablet viewports', async ({ page }) => {
  await page.goto('/');
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('combobox', { name: 'Theme' }).click();
    const listbox = page.getByRole('listbox', { name: 'Theme' });
    await expect(listbox).toBeVisible();
    const rect = await listbox.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('renders source sites only after login and opens ESPN in a tab', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel(/username/i).fill('browser-owner');
  await page.getByLabel(/^password/i).fill('browser-test-password-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
  await expect(page.getByText('ESPN', { exact: true }).first()).toBeVisible();

  const espn = page.getByRole('link', { name: /ESPN/ }).first();
  const popupPromise = context.waitForEvent('page');
  await espn.click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  expect(popup.url()).toContain('espn.com');
  await popup.close();

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page.getByLabel(/username/i)).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('creates shared groups and filters favorites in expanded, minimized and mobile sidebars', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByLabel(/username/i).fill('browser-owner');
  await page.getByLabel(/^password/i).fill('browser-test-password-123');
  await page.getByRole('button', { name: /sign in/i }).click();
  const groups = page.getByRole('combobox', { name: 'Group', exact: true });
  await expect(groups).toHaveText('All sites');
  const frame = page.locator('iframe').first();
  const frameHandle = await frame.elementHandle();
  await groups.click();
  await page.getByRole('option', { name: 'Create group...' }).click();
  await expect(page.getByRole('dialog', { name: 'Create group' })).toBeVisible();
  await page.getByLabel('Group name', { exact: true }).fill('Sports');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(groups).toHaveText('Sports');
  await expect(page.locator('.favorite')).toHaveCount(0);
  expect(await frame.evaluate((element, original) => element === original, frameHandle)).toBe(true);
  await groups.click();
  await page.getByRole('option', { name: 'All sites' }).click();
  await groups.click();
  await page.getByRole('option', { name: 'Create group...' }).click();
  await page.getByLabel('Group name', { exact: true }).fill('Personal');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(groups).toHaveText('Personal');
  await groups.click();
  await page.getByRole('option', { name: 'All sites' }).click();
  await page.getByRole('button', { name: 'Edit ESPN' }).click();
  await page.getByRole('checkbox', { name: 'Sports', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Personal', exact: true }).check();
  await page.screenshot({ path: 'test-results/multiple-groups-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Save favorite', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Edit favorite' })).toHaveCount(0);
  await groups.click();
  await page.getByRole('option', { name: 'Sports', exact: true }).click();
  await expect(page.locator('.favorite')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open ESPN in a separate tab' })).toHaveAttribute('aria-keyshortcuts', 'Control+1');
  await page.getByRole('button', { name: 'Minimize favorites' }).click();
  await expect(groups).toBeVisible();
  await groups.click();
  const panel = page.getByRole('listbox', { name: 'Group', exact: true });
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  await expect(page.getByRole('option', { name: 'Ungrouped' })).toHaveCount(0);
  await page.getByRole('option', { name: 'All sites' }).click();
  await expect(page.getByRole('button', { name: 'Ferry Tracker', exact: true })).toBeVisible();
  await groups.click();
  await page.getByRole('option', { name: 'Sports', exact: true }).click();
  await page.reload();
  await expect(groups).toHaveText('Sports');
  await expect(page.getByRole('complementary', { name: 'Favorites' })).toHaveCSS('width', '50px');
  await page.screenshot({ path: 'test-results/groups-minimized.png', fullPage: true });
  await page.getByRole('button', { name: 'Expand favorites' }).click();
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Dark', exact: true }).click();
  await groups.click();
  await page.screenshot({ path: 'test-results/groups-dark.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Light', exact: true }).click();
  await groups.click();
  await page.screenshot({ path: 'test-results/groups-light.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Show favorites' }).click();
  await groups.click();
  await page.getByRole('option', { name: 'All sites' }).click();
  await expect(page.getByRole('button', { name: 'Ferry Tracker', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await otherPage.goto('/');
    await otherPage.getByLabel(/username/i).fill('browser-owner');
    await otherPage.getByLabel(/^password/i).fill('browser-test-password-123');
    await otherPage.getByRole('button', { name: /sign in/i }).click();
    await otherPage.getByRole('combobox', { name: 'Group', exact: true }).click();
    await otherPage.getByRole('option', { name: 'Sports', exact: true }).click();
    await expect(otherPage.locator('.favorite')).toHaveCount(1);
    await expect(otherPage.getByRole('link', { name: 'Open ESPN in a separate tab' })).toBeVisible();
    await otherPage.getByRole('combobox', { name: 'Group', exact: true }).click();
    await otherPage.getByRole('option', { name: 'Personal', exact: true }).click();
    await expect(otherPage.locator('.favorite')).toHaveCount(1);
    await expect(otherPage.getByRole('link', { name: 'Open ESPN in a separate tab' })).toBeVisible();
    await otherPage.getByRole('button', { name: 'Edit ESPN' }).click();
    await expect(otherPage.getByRole('checkbox', { name: 'Sports', exact: true })).toBeChecked();
    await expect(otherPage.getByRole('checkbox', { name: 'Personal', exact: true })).toBeChecked();
    await otherPage.getByRole('checkbox', { name: 'Sports', exact: true }).uncheck();
    await otherPage.getByRole('checkbox', { name: 'Personal', exact: true }).uncheck();
    await otherPage.getByRole('button', { name: 'Save favorite', exact: true }).click();
    await expect(otherPage.getByRole('combobox', { name: 'Group', exact: true })).toHaveText('All sites');
    await expect(otherPage.getByRole('link', { name: 'Open ESPN in a separate tab' })).toHaveCount(1);
    await otherPage.getByRole('combobox', { name: 'Group', exact: true }).click();
    await expect(otherPage.getByRole('option', { name: 'Ungrouped' })).toHaveCount(0);
  } finally {
    await other.close();
  }
});
