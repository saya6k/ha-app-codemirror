import { test, expect } from '@playwright/test';

const entities = [
  { entity_id: 'light.kitchen', friendly_name: 'Kitchen Light', domain: 'light', state: 'on', state_translated: '켜짐' },
  { entity_id: 'sensor.living_temperature', friendly_name: '거실 온도', domain: 'sensor', state: '23' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/entities', route => route.fulfill({ json: entities }));
});

test('new directory and new file use selected folder, reject duplicates and open editor', async ({ page }) => {
  await page.goto('/');
  await page.locator('#app-actions summary').click();
  await page.locator('[data-path="config/docs"]').click();
  await page.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
  await expect(page.locator('#create-location')).toContainText('/config/docs');
  await page.getByLabel('Name', { exact: true }).fill('new-folder');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#create-dialog')).not.toBeVisible();
  await expect(page.locator('[data-path="config/docs/new-folder"]')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New file', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('notes.md');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#current-filename')).toHaveText('docs/new-folder/notes.md');
  await expect(page.locator('.cm-content')).toBeEditable();
  await page.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New file', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('notes.md');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#create-error')).toContainText('already exists');
  await expect(page.locator('#create-dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('new file preserves unsaved editor content in its original tab', async ({ page }) => {
  await page.goto('/');
  await page.locator('#app-actions summary').click();
  await page.locator('[data-path="config/other.md"]').click();
  await expect(page.locator('#current-filename')).toHaveText('other.md');
  await page.locator('.cm-content').fill('# draft');
  await page.getByRole('button', { name: 'File actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New file', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('keep-draft.md');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('#current-filename')).toHaveText('keep-draft.md');
  await page.getByRole('tab', { name: 'other.md •', exact: true }).click();
  // The draft remains available when the new file opens in a separate tab.
  await expect(page.locator('.cm-content')).toContainText('draft');
  await expect(page.locator('[data-path="config/keep-draft.md"]')).toBeVisible();
});

test('validation and HA actions use endpoints and protect unsaved changes', async ({ page }) => {
  let checks = 0;
  const actions: string[] = [];
  await page.route('**/api/validate', route => { checks++; return route.fulfill({ json: { result: 'valid', errors: null } }); });
  await page.route('**/api/ha/*', route => { actions.push(route.request().url().split('/').pop()!); return route.fulfill({ json: { success: true, message: 'Action completed' } }); });
  await page.goto('/');
  await page.locator('#app-actions summary').click();
  await page.getByRole('button', { name: 'Validate YAML', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('Saved HA configuration is valid');
  expect(checks).toBe(1);
  await page.getByRole('button', { name: 'Reload YAML', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('Action completed');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Restart HA', exact: true }).click();
  expect(actions).toEqual(['reload']);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Restart HA', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('Action completed');
  expect(actions).toEqual(['reload', 'restart']);
  await page.locator('[data-path="config/configuration.yaml"]').click();
  await expect(page.locator('#current-filename')).toHaveText('configuration.yaml');
  await page.locator('.cm-content').fill('entity_id: light.kitchen');
  await page.getByRole('button', { name: 'Reload YAML', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('Save');
  expect(actions).toEqual(['reload', 'restart']);
  await page.getByRole('button', { name: 'Validate YAML', exact: true }).click();
  await expect(page.locator('#status-info')).toContainText('Unsaved');
  const previousChecks = checks;
  await page.locator('.cm-content').fill('broken: [');
  await page.getByRole('button', { name: 'Validate YAML', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('syntax errors');
  expect(checks).toBe(previousChecks);
});

test('entity dropdown supports empty value, substring and friendly name filtering', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('#app-actions summary').click();
  await expect(page.locator('#entity-status')).toContainText('2 entities');
  await page.locator('[data-path="config/configuration.yaml"]').click();
  await expect(page.locator('#current-filename')).toHaveText('configuration.yaml');
  const editor = page.locator('.cm-content');
  await editor.fill('entity_id: ');
  await editor.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option').filter({ hasText: 'light.kitchen' })).toBeVisible();
  // CodeMirror deliberately ignores selection keys for 75 ms after opening.
  await page.waitForTimeout(100);
  await editor.press('ArrowDown');
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option', { selected: true })).toContainText('sensor.living_temperature');
  await editor.press('Enter');
  await expect(editor).toContainText('sensor.living_temperature');
  await editor.fill('entity_id: kit');
  await editor.press('Control+Space');
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option')).toHaveCount(1);
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option')).toContainText('light.kitchen');
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option')).toContainText('켜짐');
  await page.waitForTimeout(100);
  await editor.press('Enter');
  await expect(editor).toHaveText('entity_id: light.kitchen');
  await editor.fill('entity_id: ');
  await editor.pressSequentially('light.');
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option')).toContainText('light.kitchen');
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option')).toContainText('켜짐');
  await editor.press('Escape');
  await editor.fill('entity_id: 거실');
  await page.getByRole('button', { name: 'Entity suggestions', exact: true }).click();
  await expect(page.locator('.cm-tooltip-autocomplete').getByRole('option')).toContainText('sensor.living_temperature');
  await page.screenshot({ path: testInfo.outputPath('entity-dropdown.png'), animations: 'disabled' });
});

test('entity connection failures and control failures remain visible', async ({ page }) => {
  await page.route('**/api/entities', route => route.fulfill({ status: 503, json: { error: 'Core unavailable' } }));
  await page.route('**/api/ha/reload', route => route.fulfill({ status: 422, json: { error: 'Invalid saved config', details: 'Line 2: invalid YAML' } }));
  await page.goto('/');
  await page.locator('#app-actions summary').click();
  await expect(page.locator('#entity-status')).toContainText('unavailable');
  await page.route('**/api/entities', route => route.fulfill({ json: entities }));
  await page.getByRole('button', { name: 'Refresh entities', exact: true }).click();
  await expect(page.locator('#entity-status')).toContainText('2 entities');
  await page.getByRole('button', { name: 'Reload YAML', exact: true }).click();
  await expect(page.locator('#status-message')).toContainText('failed');
  await page.locator('#status-bar').click();
  await expect(page.locator('#validation-details-content')).toContainText('Line 2: invalid YAML');
});
