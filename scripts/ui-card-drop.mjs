import { chromium } from 'playwright-core';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Card-level drop QA: dropping anywhere on a card is attributed to that card's
 * nearest port on the wanted side, with a live preview (row + port + snapped
 * ghost). Verified through the generated code, not just the DOM.
 */
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out = path.resolve('artifacts');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`console: ${msg.text()}`);
});

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await page.waitForSelector('.node');
await page.keyboard.press('f');
await page.waitForTimeout(350);

const code = async () => {
  await page.getByRole('tab', { name: '代码' }).click();
  await page.waitForTimeout(200);
  const text = await page.locator('.code-panel').innerText();
  await page.getByRole('tab', { name: '参数' }).click();
  await page.waitForTimeout(150);
  return text.split('\n').filter((line) => /^\d+$/.test(line.trim()) === false && line.trim()).slice(-8).join(' | ');
};
const box = async (selector) => {
  const b = await page.locator(selector).boundingBox();
  return b && { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
};
const nodeBox = async (index) => page.locator('.node').nth(index).boundingBox();
const values = () => page.locator('.value-node').count();

console.log('BASE_CODE=' + JSON.stringify(await code()));

const xOut = await box('[data-port-id="demo-x:out"]');
const nz = await nodeBox(1);
const nzIn0 = await box('[data-port-id="demo-normalize:in:0"]');
const nzIn1 = await box('[data-port-id="demo-normalize:in:1"]');

// --- 1. drag x.out over the middle of the normalize card (not on a port) ---
await page.mouse.move(xOut.x, xOut.y);
await page.mouse.down();
await page.mouse.move(nz.x + nz.width / 2, nzIn0.y - 2, { steps: 12 });
await page.waitForTimeout(200);
console.log('PREVIEW1 rows=' + (await page.locator('.node-row.is-target-row').count()) +
  ' ports=' + JSON.stringify(await page.locator('.port.is-target').evaluateAll((els) => els.map((el) => el.dataset.portId))) +
  ' ghost=' + (await page.locator('.edge-ghost').count()));
await page.screenshot({ path: path.join(out, 'pf-10-drop-preview.png') });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('DROP1_CODE=' + JSON.stringify(await code()));

// --- 2. drag the y pill onto the normalize card, lower half (scale row) ---
const yPill = await page.locator('.value-node').nth(1).boundingBox();
await page.mouse.move(yPill.x + yPill.width / 2, yPill.y + 20);
await page.mouse.down();
await page.mouse.move(nz.x + nz.width / 2, nzIn1.y + 6, { steps: 12 });
await page.waitForTimeout(200);
console.log('PREVIEW2 rows=' + (await page.locator('.node-row.is-target-row').count()) +
  ' ports=' + JSON.stringify(await page.locator('.port.is-target').evaluateAll((els) => els.map((el) => el.dataset.portId))));
await page.screenshot({ path: path.join(out, 'pf-12-pill-preview.png') });
await page.mouse.up();
await page.waitForTimeout(400);
console.log('DROP2_CODE=' + JSON.stringify(await code()));
const ySnap = await page.locator('.value-node').filter({ hasText: 'INy' }).first().boundingBox();
console.log('PILL_SNAP dx=' + Math.round(ySnap.x + ySnap.width - nz.x) + ' (expect ~ -34)');

// --- 3. empty drop from a method output creates a flow output pill ---
const before = await values();
const addOut = await box('[data-port-id="demo-add:out:0"]');
await page.mouse.move(addOut.x, addOut.y);
await page.mouse.down();
await page.mouse.move(addOut.x + 40, addOut.y + 300, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('EMPTY_FROM_METHOD values=' + before + '->' + (await values()));

// --- 4. empty drop from a value pill is rejected with a hint ---
const xOut2 = await box('[data-port-id="demo-x:out"]');
const before2 = await values();
await page.mouse.move(xOut2.x, xOut2.y);
await page.mouse.down();
await page.mouse.move(xOut2.x + 30, xOut2.y + 320, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('EMPTY_FROM_VALUE values=' + before2 + '->' + (await values()) +
  ' toast=' + JSON.stringify((await page.locator('.toast').count()) ? await page.locator('.toast').first().innerText() : 'none'));
await page.screenshot({ path: path.join(out, 'pf-14-empty-hint.png') });

console.log('ERRORS=' + JSON.stringify(errors));
await browser.close();
