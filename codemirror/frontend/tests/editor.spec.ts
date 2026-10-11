import { test, expect } from '@playwright/test';

test('Markdown preview, save, persistence and escaped filenames', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.locator('[data-path="config/guide.md"]').click();
  await expect(page.locator('.cm-content')).toContainText('Home Assistant');
  await page.getByRole('button', { name: 'Preview Markdown' }).click();
  await expect(page.getByRole('heading', { name: 'Home Assistant', exact: true })).toBeVisible();
  await expect(page.locator('#markdown-preview table')).toBeVisible();
  const editor = page.locator('.cm-content');
  await editor.fill('# Changed title\n\n**Saved Markdown**');
  await expect(page.locator('#markdown-preview h1')).toHaveText('Changed title');
  await page.locator('#save-btn').click();
  await expect(page.locator('#status-message')).toHaveText('Saved');
  await page.reload();
  await expect(editor).toContainText('Changed title');
  await page.getByRole('treeitem').filter({ hasText: 'quotes " & <test>.md' }).click();
  await expect(editor).toContainText('Filename escaping');
  await expect(page.locator('test')).toHaveCount(0);
  await page.locator('[data-path="config/guide.md"]').click();
  await page.getByRole('button', { name: 'Preview Markdown' }).click();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('picker uploads binary and Markdown into selected folder and preserves conflicts', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/docs"]').click();
  await page.locator('#upload-input').setInputFiles([
    { name: 'upload.md', mimeType: 'text/markdown', buffer: Buffer.from('# Uploaded') },
    { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0, 1, 2, 3]) },
  ]);
  await expect(page.locator('#upload-results')).toContainText('2/2 uploaded to /config/docs');
  await page.locator('[data-path="config/docs/upload.md"]').click();
  await expect(page.locator('.cm-content')).toContainText('Uploaded');
  await page.locator('#upload-input').setInputFiles({ name: 'upload.md', mimeType: 'text/markdown', buffer: Buffer.from('overwrite') });
  await expect(page.locator('#upload-results')).toContainText('already exists');
  await expect(page.locator('.cm-content')).toContainText('Uploaded');
});

test('file drop on a folder uploads there without inserting into editor', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('other.md');
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['# Dropped'], 'dropped.md', { type: 'text/markdown' }));
    return data;
  });
  await page.locator('[data-path="config/docs"]').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.locator('#upload-results')).toContainText('1/1 uploaded to /config/docs');
  await expect(page.locator('.cm-content')).toContainText('Other document');
  await page.locator('[data-path="config/docs"]').click();
  await expect(page.locator('[data-path="config/docs/dropped.md"]')).toBeVisible();
});

test('unified roots preserve unsaved changes and restore cross-root files', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#workspace, #upload-folder, #workspace-toolbar')).toHaveCount(0);
  await expect(page.locator('[data-path="config"]')).toBeVisible();
  await expect(page.locator('[data-path="media"]')).toBeVisible();
  await expect(page.locator('[data-path="ssl"]')).toHaveCount(0);
  await page.locator('[data-path="config/other.md"]').click();
  await page.locator('.cm-content').fill('# Unsaved');
  await page.locator('[data-path="media"]').click();
  await page.locator('[data-path="media/media.md"]').click();
  await expect(page.locator('.cm-content')).toContainText('Media workspace');
  await page.getByRole('tab', { name: 'other.md •', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Unsaved');
  await page.getByRole('tab', { name: 'media.md', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.locator('.cm-content')).toContainText('Media workspace');
});

test('directories toggle at runtime and keep unsaved files open', async ({ page }) => {
  await page.goto('/');
  await page.locator('#root-picker summary').click();
  const config = page.getByRole('checkbox', { name: '/config' });
  await page.locator('[data-path="config/guide.md"]').click();
  await config.uncheck();
  await expect(page.locator('[data-path="config"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'guide.md' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-path="config"]')).toHaveCount(0);
  await expect(page.locator('[data-path="media"]')).toBeVisible();
  await page.locator('#root-picker summary').click();
  await config.check();
  await expect(page.locator('[data-path="config/guide.md"]')).toBeVisible();
  const ssl = page.getByRole('checkbox', { name: '/ssl' });
  const media = page.getByRole('checkbox', { name: '/media' });
  await ssl.check();
  await expect(page.locator('[data-path="ssl"]')).toBeVisible();
  await ssl.uncheck();
  await expect(page.locator('[data-path="ssl"]')).toHaveCount(0);
  // /media became the start root while /config was off, so it is already expanded.
  await page.locator('[data-path="media/media.md"]').click();
  await page.locator('.cm-content').fill('# Unsaved media');
  await media.click();
  await expect(media).toBeChecked();
  await expect(page.locator('#status-message')).toContainText('Save or close unsaved files in /media first');
  await page.locator('.cm-content').fill('# Media workspace\n');
  await page.locator('#save-btn').click();
  await expect(page.locator('#status-message')).toHaveText('Saved');
  await media.uncheck();
  await expect(page.locator('[data-path="media"]')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'media.md' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-path="media"]')).toHaveCount(0);
  await page.locator('#root-picker summary').click();
  await media.check();
  await expect(page.locator('[data-path="media/media.md"]')).toBeVisible();
});

test('Markdown preview removes active content and embedded requests', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:18099')) external.push(request.url()); });
  await page.goto('/');
  await page.locator('[data-path="config/unsafe.markdown"]').click();
  await page.locator('#preview-btn').click();
  await expect(page.locator('#markdown-preview h1')).toHaveText('Preview safety');
  await expect(page.locator('#markdown-preview script, #markdown-preview img, #markdown-preview [onclick], #markdown-preview a[href]')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('invalid YAML and JSON cannot be saved; valid state restores', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/configuration.yaml"]').click();
  await expect(page.locator('#current-filename')).toHaveText('configuration.yaml');
  await page.locator('.cm-content').fill('homeassistant: [');
  await expect(page.locator('#save-btn')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#status-message')).toContainText('Invalid');
  await page.locator('#validation-details-restore').click();
  await expect(page.locator('.cm-content')).toContainText('name: Home');
  await page.locator('[data-path="config/data.json"]').click();
  await expect(page.locator('#current-filename')).toHaveText('data.json');
  await page.locator('.cm-content').fill('{');
  await expect(page.locator('#status-message')).toContainText('Invalid');
});

test('switching files clears undo history', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('other.md');
  await page.locator('.cm-content').fill('# Private draft');
  await page.locator('[data-path="config/guide.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('guide.md');
  const content = await page.locator('.cm-content').textContent();
  await page.locator('.cm-content').press('ControlOrMeta+z');
  await expect(page.locator('.cm-content')).toHaveText(content!);
});

test('save failures remain visible and invalid documents stay blocked', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('other.md');
  await page.locator('.cm-content').fill('# Keep this draft');
  await page.route('**/api/files/other.md?root=config', route => route.fulfill({
    status: 403, contentType: 'application/json', body: '{"error":"Workspace access is disabled"}',
  }));
  await page.locator('#save-btn').click();
  await expect(page.locator('#status-message')).toContainText('Failed to save');
  await expect(page.locator('.cm-content')).toContainText('Keep this draft');
  await page.locator('[data-path="config/data.json"]').click();
  await expect(page.locator('#current-filename')).toHaveText('data.json');
  await page.locator('.cm-content').fill('{');
  await page.locator('.cm-content').press('ControlOrMeta+s');
  await expect(page.locator('#save-btn')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#status-message')).toContainText('Cannot save');
});

for (const width of [320, 768, 1024]) {
  test(`responsive editor at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/');
    if (width <= 768) await page.locator('#mobile-menu-toggle').click();
    await page.locator('[data-path="config/guide.md"]').click();
    await page.locator('#preview-btn').click();
    await expect(page.locator('#markdown-preview')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`viewport-${width}.png`), fullPage: true, animations: 'disabled' });
  });
}
