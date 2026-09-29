import { test, expect, type Page } from '@playwright/test';

async function menu(page: Page, path: string, action: string) {
  await page.locator(`[data-path="${path}"]`).click({ button: 'right' });
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

test('context menu copies, cuts across roots, renames open files and deletes directories', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.request.post('/api/entries?root=config', { headers: { 'X-CodeMirror-Request': '1' }, data: { name: 'operations', type: 'directory' } });
  await page.locator('#refresh-files').click();
  await expect(page.locator('[data-path="config/operations"]')).toBeVisible();
  await menu(page, 'config/other.md', 'Copy');
  await menu(page, 'config/operations', 'Paste');
  await expect(page.locator('#status-message')).toContainText('completed');
  await page.locator('[data-path="config/operations"]').click();
  await page.locator('[data-path="config/operations/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('operations/other.md');
  page.once('dialog', dialog => dialog.accept('renamed.md'));
  await menu(page, 'config/operations/other.md', 'Rename');
  await expect(page.locator('#current-filename')).toHaveText('operations/renamed.md');
  await page.locator('.cm-content').fill('# Keep changes');
  await menu(page, 'config/operations/renamed.md', 'Delete');
  await expect(page.locator('#status-message')).toContainText('Save changes');
  await expect(page.locator('[data-path="config/operations/renamed.md"]')).toBeVisible();
  await page.locator('#save-btn').click();
  await expect(page.locator('#status-message')).toHaveText('Saved');
  await menu(page, 'config/operations/renamed.md', 'Cut');
  await menu(page, 'media', 'Paste');
  await expect(page.locator('[data-path="config/operations/renamed.md"]')).toHaveCount(0);
  await expect(page.locator('#current-filename')).toHaveText('renamed.md');
  await page.locator('[data-path="media"]').click();
  await expect(page.locator('[data-path="media/renamed.md"]')).toBeVisible();
  await page.locator('.cm-content').fill('# Moved and saved');
  await page.locator('#save-btn').click();
  await expect(page.locator('#status-message')).toHaveText('Saved');
  const moved = await page.request.get('/api/files/renamed.md?root=media');
  expect((await moved.json()).content).toBe('# Moved and saved');
  page.once('dialog', dialog => dialog.accept());
  await menu(page, 'config/operations', 'Delete');
  await expect(page.locator('[data-path="config/operations"]')).toHaveCount(0);
  await page.locator('[data-path="media/renamed.md"]').click({ button: 'right' });
  await page.screenshot({ path: testInfo.outputPath('context-menu.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  page.once('dialog', dialog => dialog.accept());
  await menu(page, 'media/renamed.md', 'Delete');
  await expect(page.locator('#current-filename')).toHaveText('No file selected');
  await expect(page.locator('.cm-content')).not.toBeEditable();
});

test('keyboard menu and clipboard keep mounted roots protected and reject conflicts', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config"]').focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.locator('[data-path="config/other.md"]').focus();
  await page.keyboard.press('ControlOrMeta+c');
  await page.locator('[data-path="media"]').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#status-message')).toContainText('completed');
  await page.locator('[data-path="media"]').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.locator('#status-message')).toContainText('already exists');
  await expect(page.locator('[data-path="config/other.md"]')).toBeVisible();
});

test('mobile file menu is reachable and stays within the viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  await page.locator('#app-actions summary').click();
  await expect(page.getByRole('button', { name: 'Validate YAML', exact: true })).toBeVisible();
  await page.locator('#app-actions summary').click();
  await page.locator('#mobile-menu-toggle').click();
  await page.locator('[data-path="media"]').click();
  await page.getByRole('button', { name: 'File actions', exact: true }).click();
  const bounds = await page.locator('#file-context-menu').boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: testInfo.outputPath('mobile-menu.png'), animations: 'disabled' });
  await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
  await expect(page.locator('#create-location')).toContainText('/media');
  await page.getByLabel('Name', { exact: true }).fill('mobile-folder');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('[data-path="media/mobile-folder"]')).toBeVisible();
});

test('arrow navigation keeps the selected directory as creation target', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-path="config/docs"]')).toBeFocused();
  await expect(page.locator('[data-path="config/docs"]')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New file', exact: true }).click();
  await expect(page.locator('#create-location')).toContainText('/config/docs');
});

test('failed reopen after rename cannot save to the old path', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('other.md');
  await page.route('**/api/files/reopen-failed.md?root=config', route => route.fulfill({ status: 403, json: { error: 'Read denied' } }));
  page.once('dialog', dialog => dialog.accept('reopen-failed.md'));
  await menu(page, 'config/other.md', 'Rename');
  await expect(page.locator('#status-message')).toContainText('could not reopen');
  await expect(page.locator('.cm-content')).not.toBeEditable();
  await expect(page.locator('#save-btn')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-path="config/other.md"]')).toHaveCount(0);
  await expect(page.locator('[data-path="config/reopen-failed.md"]')).toBeVisible();
});
