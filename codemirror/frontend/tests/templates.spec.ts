import { test, expect } from '@playwright/test';

const source = "{{ states('light.kitchen') }}";
test.beforeEach(async ({ page, request }) => {
  await request.put('/api/files/template.yaml?root=config', {
    headers: { 'X-CodeMirror-Request': '1' }, data: { content: source },
  });
  await page.goto('/');
  await page.locator('[data-path="config/template.yaml"]').click();
  await expect(page.getByRole('button', { name: 'Render template', exact: true })).toBeEnabled();
});

test('renders unsaved selection as inert text and allows rerun after errors', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/template', async route => {
    requests.push(route.request().postDataJSON().template);
    await route.fulfill(requests.length === 1
      ? { status: 400, json: { error: "UndefinedError: 'trigger' is undefined" } }
      : { json: { result: '<img src=x onerror=alert(1)>\n켜짐' } });
  });
  await page.locator('.cm-content').fill('{{ trigger }}');
  await page.locator('.cm-content').press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Render template', exact: true }).click();
  await expect(page.locator('#template-result')).toContainText('UndefinedError');
  expect(requests[0]).toBe('{{ trigger }}');
  await page.getByRole('button', { name: 'Run again', exact: true }).click();
  await expect(page.locator('#template-result')).toHaveText('<img src=x onerror=alert(1)>\n켜짐');
  await expect(page.locator('#template-result img')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveText('{{ trigger }}');
  await page.getByRole('button', { name: 'Close template preview' }).click();
  await expect(page.locator('#template-preview')).toBeHidden();
});

test('hover renders expressions and skips block-dependent context', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/template', async route => {
    requests.push(route.request().postDataJSON().template);
    await route.fulfill({ json: { result: 'on' } });
  });
  await page.locator('.cm-line').filter({ hasText: 'states' }).hover({ position: { x: 55, y: 8 } });
  await expect(page.locator('.template-tooltip')).toContainText('on');
  expect(requests).toEqual([source]);
  await page.locator('.cm-content').fill('{% set x = 3 %}\n{{ x }}');
  await page.locator('.cm-line').filter({ hasText: '{{ x }}' }).hover({ position: { x: 24, y: 8 } });
  await page.waitForTimeout(1000);
  expect(requests).toHaveLength(1);
});

test('late response is discarded on edits and file switches', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/template', async route => {
    await pending;
    await route.fulfill({ json: { result: 'outdated' } });
  });
  await page.getByRole('button', { name: 'Render template', exact: true }).click();
  await expect(page.locator('#template-result')).toContainText('Rendering');
  await page.locator('.cm-content').fill('{{ 2 }}');
  release();
  await expect(page.locator('#template-result')).toContainText('changed');
  await expect(page.locator('#template-result')).not.toContainText('outdated');
  await page.locator('[data-path="config/configuration.yaml"]').click();
  await expect(page.locator('#template-preview')).toBeHidden();
});

test('renders only the selected fragment and preserves empty output', async ({ page }) => {
  let sent = '';
  await page.route('**/api/template', async route => {
    sent = route.request().postDataJSON().template;
    await route.fulfill({ json: { result: '' } });
  });
  const editor = page.locator('.cm-content');
  await editor.fill('prefix\n{{ 42 }}\nsuffix');
  await editor.press('ControlOrMeta+a');
  await editor.press('ArrowLeft');
  await editor.press('ArrowDown');
  await editor.press('Shift+End');
  await page.getByRole('button', { name: 'Render template', exact: true }).click();
  await expect(page.locator('#template-result')).toHaveText('(Empty result)');
  expect(sent).toBe('{{ 42 }}');
  await expect(page.locator('#template-scope')).toHaveText('Selection');
});

test('quoted delimiters and malformed expressions do not confuse hover', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/template', async route => {
    requests.push(route.request().postDataJSON().template);
    await route.fulfill({ json: { result: '}}' } });
  });
  await page.locator('.cm-content').fill('{{ "}}" }}');
  await page.locator('.cm-line').hover({ position: { x: 24, y: 8 } });
  await expect(page.locator('.template-tooltip pre')).toHaveText('}}');
  expect(requests).toEqual(['{{ "}}" }}']);
  await page.locator('.cm-content').fill('{{ "unfinished }}');
  await page.locator('.cm-line').hover({ position: { x: 24, y: 8 } });
  await page.waitForTimeout(1000);
  await expect(page.locator('.template-tooltip')).toHaveCount(0);
  expect(requests).toHaveLength(1);
});

test('preview fits mobile and localizes controls without translating HA output', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('codemirror:language', 'ko'));
  await page.reload();
  await page.route('**/api/template', route => route.fulfill({ json: { result: 'Ready' } }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: '템플릿 렌더링', exact: true }).click();
    await expect(page.locator('#template-result')).toHaveText('Ready');
    const bounds = await page.locator('#template-preview').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    if (width <= 768) {
      const toolbar = await page.locator('#editor-toolbar').boundingBox();
      const output = await page.locator('#template-result').boundingBox();
      expect(output!.y + output!.height).toBeLessThanOrEqual(toolbar!.y);
    }
    await page.screenshot({ path: `test-results/template-preview-${width}.png` });
    await page.getByRole('button', { name: '템플릿 미리보기 닫기' }).click();
  }
  expect(errors).toEqual([]);
});
