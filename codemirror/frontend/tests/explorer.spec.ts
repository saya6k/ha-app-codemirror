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

test('rename preserves the saved tab without depending on another read', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('other.md');
  await page.route('**/api/files/reopen-failed.md?root=config', route => route.fulfill({ status: 403, json: { error: 'Read denied' } }));
  page.once('dialog', dialog => dialog.accept('reopen-failed.md'));
  await menu(page, 'config/other.md', 'Rename');
  await expect(page.locator('#current-filename')).toHaveText('reopen-failed.md');
  await expect(page.locator('.cm-content')).toBeEditable();
  await expect(page.locator('#save-btn')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-path="config/other.md"]')).toHaveCount(0);
  await expect(page.locator('[data-path="config/reopen-failed.md"]')).toBeVisible();
});

test('multi-selection cuts, pastes and deletes several entries at once', async ({ page }) => {
  await page.goto('/');
  for (const name of ['multi-a.md', 'multi-b.md', 'multi-c.md']) {
    await page.request.post('/api/entries?root=config', { headers: { 'X-CodeMirror-Request': '1' }, data: { name, type: 'file' } });
  }
  await page.locator('#refresh-files').click();
  const item = (path: string) => page.locator(`[data-path="${path}"]`);
  await item('config/multi-a.md').click();
  await item('config/multi-c.md').click({ modifiers: ['Shift'] });
  for (const name of ['a', 'b', 'c']) await expect(item(`config/multi-${name}.md`)).toHaveAttribute('aria-selected', 'true');
  await item('config/multi-b.md').click({ modifiers: ['ControlOrMeta'] });
  await expect(item('config/multi-b.md')).toHaveAttribute('aria-selected', 'false');
  await expect(item('config/multi-a.md')).toHaveAttribute('aria-selected', 'true');
  await item('config/multi-c.md').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Cut', exact: true }).click();
  await menu(page, 'config/docs', 'Paste');
  await expect(page.locator('#status-message')).toContainText('completed');
  await expect(item('config/multi-a.md')).toHaveCount(0);
  await expect(item('config/multi-c.md')).toHaveCount(0);
  await expect(item('config/multi-b.md')).toBeVisible();
  if (!(await item('config/docs/multi-a.md').isVisible())) await item('config/docs').click();
  await item('config/docs/multi-a.md').click();
  await item('config/docs/multi-c.md').click({ modifiers: ['ControlOrMeta'] });
  await item('config/multi-b.md').click({ modifiers: ['ControlOrMeta'] });
  page.once('dialog', dialog => { expect(dialog.message()).toContain('3 items'); void dialog.accept(); });
  await item('config/multi-b.md').focus();
  await page.keyboard.press('Delete');
  await expect(page.locator('#status-message')).toContainText('completed');
  for (const path of ['config/docs/multi-a.md', 'config/docs/multi-c.md', 'config/multi-b.md']) await expect(item(path)).toHaveCount(0);
});

test('shift+arrow extends the selection and a plain click resets it', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/guide.md"]').focus();
  await page.keyboard.press('Shift+ArrowDown');
  const selected = page.locator('#file-list [aria-selected="true"]');
  await expect(selected).toHaveCount(2);
  await page.locator('[data-path="config/guide.md"]').click();
  await expect(selected).toHaveCount(1);
  await expect(page.locator('#current-filename')).toHaveText('guide.md');
});
