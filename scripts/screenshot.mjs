#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const baseUrl = process.env.SCREENSHOT_URL ?? 'http://localhost:3000';
const outDir = process.env.SCREENSHOT_DIR ?? 'screenshots';
const pathArg = process.argv[2] ?? '/';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 375, height: 812 },
];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    const url = new URL(pathArg, baseUrl).toString();
    await page.goto(url, { waitUntil: 'networkidle' });
    const safePath = pathArg.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
    const file = join(outDir, `${safePath}-${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`saved ${file} (${vp.width}x${vp.height})`);
    await context.close();
  }
} finally {
  await browser.close();
}
