import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const headers = { 'X-CodeMirror-Request': '1' };

test('tabs preserve drafts, undo, close cancellation and per-root saves', async ({ page }) => {
  await page.request.put('/api/files/tab-a.md?root=config', { headers, data: { content: '# A' } });
  await page.request.put('/api/files/tab-b.md?root=media', { headers, data: { content: '# B' } });
  await page.goto('/');
  await page.locator('[data-path="config/tab-a.md"]').click();
  const editor = page.locator('.cm-content');
  await editor.fill('# A draft');
  await page.locator('[data-path="media"]').click();
  await page.locator('[data-path="media/tab-b.md"]').click();
  await editor.fill('# B draft');
  await page.getByRole('tab', { name: 'tab-a.md •', exact: true }).click();
  await expect(editor).toHaveText('# A draft');
  await editor.press('ControlOrMeta+z');
  await expect(editor).toHaveText('# A');
  await page.getByRole('tab', { name: 'tab-b.md •', exact: true }).click();
  await expect(editor).toHaveText('# B draft');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Close tab: /media/tab-b.md', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'tab-b.md •', exact: true })).toBeVisible();
  await page.locator('#save-btn').click();
  await expect(page.locator('#status-message')).toHaveText('Saved');
  expect((await (await page.request.get('/api/files/tab-b.md?root=media')).json()).content).toBe('# B draft');
  await page.getByRole('button', { name: 'Close tab: /media/tab-b.md', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'tab-b.md', exact: true })).toHaveCount(0);
  await expect(editor).toHaveText('# A');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Close tab: /config/tab-a.md', exact: true }).click();
  await expect(editor).not.toBeEditable();
});

test('inactive dirty tabs block file mutations and HA actions', async ({ page }) => {
  await page.request.put('/api/files/dirty-tab.md?root=config', { headers, data: { content: '# draft' } });
  await page.goto('/');
  await page.locator('[data-path="config/dirty-tab.md"]').click();
  await page.locator('.cm-content').fill('# changed');
  await page.locator('[data-path="config/data.json"]').click();
  await page.locator('[data-path="config/dirty-tab.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('Save changes');
  await page.locator('#app-actions summary').click();
  await page.getByRole('button', { name: 'Reload YAML', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('Save your changes');
});

test('language choice translates settings, menus and CodeMirror search without changing documents', async ({ page }, testInfo) => {
  await page.request.put('/api/files/language.md?root=config', { headers, data: { content: '# Save\n\nNew file' } });
  await page.goto('/');
  await page.locator('[data-path="config/language.md"]').click();
  await page.locator('#appearance-btn').click();
  await page.locator('#appearance-language').selectOption('ko');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.locator('#appearance-title')).toHaveText('화면 설정');
  await expect(page.locator('#appearance-reset')).toHaveText('기본값 복원');
  await page.locator('#appearance-close').click();
  await page.locator('.cm-content').press('ControlOrMeta+f');
  await expect(page.locator('.cm-search')).toContainText('다음');
  await expect(page.locator('.cm-content')).toContainText('New file');
  await page.keyboard.press('Escape');
  await page.locator('[data-path="config/language.md"]').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '새 파일', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('korean-tabs.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await page.locator('#appearance-btn').click();
  await page.locator('#appearance-language').selectOption('en');
  await expect(page.locator('#appearance-title')).toHaveText('Appearance');
  await expect(page.locator('#appearance-reset')).toHaveText('Reset defaults');
});

test('folder picker compresses and uploads nested files without overwriting', async ({ page }) => {
  const temp = await mkdtemp(join(tmpdir(), 'codemirror-picker-'));
  try {
    const folder = join(temp, 'picked-folder');
    await mkdir(join(folder, 'nested'), { recursive: true });
    await writeFile(join(folder, 'nested', 'note.md'), '# Folder upload');
    await writeFile(join(folder, 'binary.bin'), Buffer.from([0, 1, 255]));
    await page.goto('/');
    await page.locator('[data-path="config/docs"]').click();
    let archiveRequests = 0;
    page.on('request', request => { if (request.url().includes('/api/upload-folder')) archiveRequests++; });
    await page.locator('#upload-folder-input').setInputFiles(folder);
    await expect(page.locator('#upload-results')).toContainText('picked-folder: 2 files uploaded');
    await page.locator('[data-path="config/docs/picked-folder"]').click();
    await page.locator('[data-path="config/docs/picked-folder/nested"]').click();
    await page.locator('[data-path="config/docs/picked-folder/nested/note.md"]').click();
    await expect(page.locator('.cm-content')).toContainText('Folder upload');
    await page.locator('[data-path="config/docs"]').click({ button: 'right' });
    await page.keyboard.press('Escape');
    await page.locator('#upload-folder-input').setInputFiles(folder);
    await expect(page.locator('#upload-results')).toContainText('already exists');
    expect(archiveRequests).toBe(2);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('folder drop preserves empty directories and drains entry batches', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-path="config/docs"]').evaluate(target => {
    const makeDir = (name: string, children: unknown[]) => ({ name, isDirectory: true,
      createReader() { let index = 0; return { readEntries(callback: (entries: unknown[]) => void) { callback(index < children.length ? [children[index++]] : []); } }; } });
    const file = { name: 'drop.md', isDirectory: false, file(callback: (file: File) => void) { callback(new File(['# ZIP drop'], 'drop.md')); } };
    const root = makeDir('dropped-folder', [makeDir('empty', []), file]);
    const data = new DataTransfer();
    data.items.add(new File(['placeholder'], 'folder'));
    const original = DataTransferItem.prototype.webkitGetAsEntry;
    DataTransferItem.prototype.webkitGetAsEntry = () => root as unknown as FileSystemEntry;
    try { target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data })); }
    finally { DataTransferItem.prototype.webkitGetAsEntry = original; }
  });
  await expect(page.locator('#upload-results')).toContainText('dropped-folder: 1 files uploaded');
  const result = await page.request.get('/api/files?root=config');
  const docs = (await result.json()).find((node: { name: string }) => node.name === 'docs');
  const folder = docs.children.find((node: { name: string }) => node.name === 'dropped-folder');
  expect(folder.children.some((node: { name: string; type: string }) => node.name === 'empty' && node.type === 'directory')).toBe(true);
});

test('drag preview highlights the folder the drop will land in', async ({ page }) => {
  await page.goto('/');
  const drag = (path: string, type: 'dragover' | 'drop') => page.locator(`[data-path="${path}"]`).evaluate((target, type) => {
    const data = new DataTransfer();
    data.items.add(new File(['# preview'], 'preview-drop.md'));
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data }));
  }, type);
  const hint = page.locator('#drop-hint');
  await drag('config/docs', 'dragover');
  await expect(hint).toHaveText('Drop to upload to /config/docs');
  await expect(page.locator('.tree-item.drop-target')).toHaveAttribute('data-path', 'config/docs');
  await drag('config/guide.md', 'dragover');
  await expect(hint).toHaveText('Drop to upload to /config');
  await expect(page.locator('.tree-item.drop-target')).toHaveAttribute('data-path', 'config');
  await drag('config/guide.md', 'drop');
  await expect(hint).toBeHidden();
  await expect(page.locator('.tree-item.drop-target')).toHaveCount(0);
  await expect(page.locator('#upload-results')).toContainText('Destination: /config');
  await expect(page.locator('#upload-results')).toContainText('1/1 uploaded to /config');
  expect((await page.request.get('/api/files/preview-drop.md?root=config')).ok()).toBe(true);
});
