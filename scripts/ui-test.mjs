import { chromium } from 'playwright-core';
import path from 'node:path';

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out = path.resolve('artifacts');
const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await page.waitForSelector('.node', { timeout: 10000 });
await page.screenshot({ path: path.join(out, 'ui-initial.png') });

// Generated code tab
await page.getByRole('tab', { name: '代码' }).click();
await page.waitForTimeout(250);
const codeText = await page.locator('.code-panel').innerText();
console.log('CODE_PANEL_START\n' + codeText + '\nCODE_PANEL_END');
await page.screenshot({ path: path.join(out, 'ui-code.png') });

// Apply dialog
await page.locator('.code-panel .btn.primary.full').click();
await page.waitForTimeout(350);
console.log('APPLY_MODAL=' + (await page.locator('.apply-modal').count()));
if (await page.locator('.apply-modal').count()) {
  await page.screenshot({ path: path.join(out, 'ui-apply.png') });
  await page.getByRole('button', { name: /演示模式/ }).click();
}

// Back to params, select normalize node
await page.getByRole('tab', { name: '参数' }).click();
await page.locator('.node').nth(1).click();
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, 'ui-inspector.png') });

// Collapse / expand inspector (should not refit the canvas)
const zoomBefore = await page.locator('.canvas-zoom span').innerText();
await page.locator('.inspector-head .icon-btn').click();
await page.waitForTimeout(350);
const zoomAfter = await page.locator('.canvas-zoom span').innerText();
await page.screenshot({ path: path.join(out, 'ui-collapsed.png') });
console.log(`ZOOM_COLLAPSE=${zoomBefore}->${zoomAfter}`);
await page.locator('.rail-toggle').click();
await page.waitForTimeout(350);

// Undo / redo after moving a node
const node = page.locator('.node').first();
const box = await node.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + 50, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const moved = await node.boundingBox();
  console.log('MOVED=' + (moved && Math.round(moved.x - box.x)));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const undone = await node.boundingBox();
  console.log('UNDONE=' + (undone && Math.round(undone.x - box.x)));
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
}

// Add a method via the + button on an operator card.
await page.locator('.search-box input').fill('sqrt');
await page.waitForTimeout(250);
await page.locator('.method-card .method-add').first().click();
await page.waitForTimeout(350);
console.log('NODE_COUNT=' + (await page.locator('.node').count()));
const nodes = await page.locator('.node').evaluateAll((els) => els.map((el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}));
console.log('NODE_RECTS=' + JSON.stringify(nodes));
await page.screenshot({ path: path.join(out, 'ui-add-method.png') });

// Drag the new output to empty canvas -> should create an output pill.
const newOut = page.locator('.node').last().locator('[data-port-kind="out"]').first();
const nb = await newOut.boundingBox();
if (nb) {
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 220, nb.y + 130, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(350);
}
console.log('VALUE_COUNT=' + (await page.locator('.value-node').count()));
await page.screenshot({ path: path.join(out, 'ui-connect.png') });

// Refresh demo and test narrow + light theme.
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.node');
await page.setViewportSize({ width: 1220, height: 860 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'ui-narrow.png') });
await page.evaluate(() => document.body.classList.add('vscode-light'));
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, 'ui-light.png') });

console.log('ERRORS=' + JSON.stringify(errors));
await browser.close();
