import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/configuration.yaml"]').click();
  await expect(page.locator('.cm-content')).toContainText('homeassistant:');
});

test('typing mdi: offers names with real SVG previews and inserts a complete icon', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.fill('icon: ');
  await editor.pressSequentially('mdi:home-ass');
  const option = page.getByRole('option', { name: 'mdi:home-assistant', exact: true });
  await expect(option).toBeVisible();
  await expect(option.locator('svg path')).toHaveAttribute('d', /^M/);
  await option.click();
  await expect(editor).toHaveText('icon: mdi:home-assistant');
});

test('quoted JSON icons complete in the middle without duplicating the suffix', async ({ page }) => {
  await page.locator('[data-path="config/data.json"]').click();
  const editor = page.locator('.cm-content');
  await expect(editor).toContainText('enabled');
  await editor.fill('{"icon":"mdi:home-assistant"}');
  await editor.press('End');
  for (let i = 0; i < 11; i++) await editor.press('ArrowLeft');
  await editor.press('Control+Space');
  await page.getByRole('option', { name: 'mdi:home-assistant', exact: true }).click();
  await expect(editor).toHaveText('{"icon":"mdi:home-assistant"}');
});

test('hover previews existing icons and ignores unknown names', async ({ page }, testInfo) => {
  const editor = page.locator('.cm-content');
  await editor.fill('icon: mdi:weather-sunny');
  await editor.press('Escape');
  await page.locator('.cm-line').hover({ position: { x: 110, y: 8 } });
  await expect(page.locator('.cm-tooltip-hover .mdi-preview')).toContainText('mdi:weather-sunny');
  await expect(page.locator('.cm-tooltip-hover .mdi-preview svg path')).toHaveAttribute('d', /^M/);
  await page.screenshot({ path: testInfo.outputPath('mdi-hover.png') });
  await editor.fill('icon: mdi:not-a-real-icon-xyz');
  await page.locator('.cm-line').hover({ position: { x: 110, y: 8 } });
  await page.waitForTimeout(800);
  await expect(page.locator('.mdi-preview')).toHaveCount(0);
});

test('icon completion stays separate from entities, comments and ordinary text', async ({ page }) => {
  await page.route('**/api/entities', route => route.fulfill({ json: [
    { entity_id: 'light.kitchen', friendly_name: 'Kitchen', domain: 'light', state: 'on' },
  ] }));
  await page.locator('#app-actions summary').click();
  await page.getByRole('button', { name: 'Refresh entities', exact: true }).click();
  await expect(page.locator('#entity-status')).toHaveText('1 entities');
  await page.locator('#app-actions summary').click();
  const editor = page.locator('.cm-content');
  await editor.fill('icon: mdi:lightbulb');
  await editor.press('Control+Space');
  await expect(page.getByRole('option', { name: 'mdi:lightbulb', exact: true })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: 'light.kitchen' })).toHaveCount(0);
  await editor.press('Escape');
  for (const source of ['# icon: mdi:lightbulb', 'name: Home # mdi:lightbulb', 'name: lightbulb']) {
    await editor.fill(source);
    await editor.press('Control+Space');
    await expect(page.getByRole('option').filter({ hasText: 'mdi:' })).toHaveCount(0);
  }
});

test('mobile keyboard completion loads local icons on demand with dark-mode previews', async ({ page }, testInfo) => {
  const catalogs: string[] = [];
  const external: string[] = [];
  page.on('request', request => {
    if (request.url().includes('_virtual_mdi-icons')) catalogs.push(request.url());
    if (!request.url().startsWith('http://127.0.0.1:18099/')) external.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('homeassistant:');
  expect(catalogs).toHaveLength(0);
  const editor = page.locator('.cm-content');
  await editor.fill('icon: mdi:home-ass');
  await editor.press('Control+Space');
  const option = page.getByRole('option', { name: 'mdi:home-assistant', exact: true });
  await expect(option.locator('svg')).toBeVisible();
  expect(catalogs).toHaveLength(1);
  const bounds = await option.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('mdi-completion-mobile.png') });
  await editor.press('Enter');
  await expect(editor).toHaveText('icon: mdi:home-assistant');
  await editor.press('Control+Space');
  await expect(option).toBeVisible();
  expect(catalogs).toHaveLength(1);
  expect(external).toEqual([]);
});
