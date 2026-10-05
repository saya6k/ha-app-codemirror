import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  await request.put('/api/files/docs/loading.md?root=config', { headers: { 'X-CodeMirror-Request': '1' }, data: { content: '# Loading fixture' } });
});

test('restores the editor independently of pending directories and entity translation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('codemirror:expanded-dirs', JSON.stringify(['config', 'media']));
    localStorage.setItem('codemirror:current-file', 'docs/loading.md');
  });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let mediaRequests = 0;
  await page.route('**/api/directory?**', async route => {
    if (new URL(route.request().url()).searchParams.get('root') === 'media') {
      mediaRequests++;
      await pending;
    }
    await route.continue();
  });
  await page.route('**/api/entities', async route => {
    await pending;
    await route.fulfill({ json: [] });
  });
  try {
    await page.goto('/');
    await expect(page.locator('[data-path="config/docs/loading.md"]')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'loading.md', exact: true })).toBeVisible();
    await expect(page.locator('.cm-content')).not.toBeEmpty();
    expect(mediaRequests).toBe(1);
    await expect(page.locator('[data-path="media/media.md"]')).toHaveCount(0);
  } finally { release(); }
});

test('collapsed mounts are not fetched until expanded', async ({ page }) => {
  let mediaRequests = 0;
  await page.route('**/api/directory?**', async route => {
    if (new URL(route.request().url()).searchParams.get('root') === 'media') mediaRequests++;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('[data-path="config/configuration.yaml"]')).toBeVisible();
  expect(mediaRequests).toBe(0);
  await page.locator('[data-path="media"]').click();
  await expect(page.locator('[data-path="media/media.md"]')).toBeVisible();
  expect(mediaRequests).toBe(1);
});

test('directory errors are readable and retryable without blocking other roots', async ({ page }) => {
  let fail = true;
  await page.route('**/api/directory?**', async route => {
    if (fail && new URL(route.request().url()).searchParams.get('root') === 'media') {
      await route.fulfill({ status: 403, json: { error: 'Permission denied for this directory' } });
    } else await route.continue();
  });
  await page.goto('/');
  await page.locator('[data-path="media"]').click();
  await expect(page.locator('.directory-error')).toContainText('Permission denied for this directory');
  await expect(page.locator('[data-path="media"]')).not.toContainText('{');
  await page.locator('[data-path="config/docs"]').click();
  await expect(page.locator('[data-path="config/docs/loading.md"]')).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('[data-path="media/media.md"]')).toBeVisible();
  await expect(page.locator('.directory-error')).toHaveCount(0);
});

test('directory pagination appends entries without discarding existing files', async ({ page }) => {
  await page.route('**/api/directory?**', async route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('root') !== 'media') return route.continue();
    const more = query.get('offset') === '500';
    await route.fulfill({ json: { entries: [{ name: more ? 'last.md' : 'first.md', path: more ? 'last.md' : 'first.md', type: 'file' }], next_offset: more ? null : 500 } });
  });
  await page.goto('/');
  await page.locator('[data-path="media"]').click();
  await expect(page.locator('[data-path="media/first.md"]')).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.locator('[data-path="media/last.md"]')).toBeVisible();
  await expect(page.locator('[data-path="media/first.md"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
});
