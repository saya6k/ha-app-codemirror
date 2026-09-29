// Rasterize the unmodified official CodeMirror SVG; never redraw the trademark.
import { chromium } from '../codemirror/frontend/node_modules/playwright/index.mjs';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const app = fileURLToPath(new URL('../codemirror/', import.meta.url));
const source = await readFile(app + 'branding/codemirror.svg');
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
  await page.setContent('<html><body style="margin:0;background:transparent"><img alt="CodeMirror"></body></html>');
  await page.locator('img').evaluate((img, src) => { img.src = src; }, 'data:image/svg+xml;base64,' + source.toString('base64'));
  await page.locator('img').evaluate(img => img.decode());
  await mkdir(app + 'frontend/public', { recursive: true });
  for (const [name, size] of [['icon.png', 256], ['logo.png', 640]]) {
    await page.locator('img').evaluate((img, px) => { img.width = px; img.height = px; }, size);
    await page.locator('img').screenshot({ path: app + name, omitBackground: true });
    await copyFile(app + name, app + 'frontend/public/' + name);
  }
} finally { await browser.close(); }
