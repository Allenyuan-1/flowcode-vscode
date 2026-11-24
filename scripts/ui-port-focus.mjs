import { chromium } from 'playwright-core';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Port focus QA:
 *  - wheel zooms the canvas (anchored at the pointer)
 *  - port hit target is enlarged but neighbouring targets never overlap
 *  - click a port = focus (dim unrelated links, keep the downstream chain lit)
 *  - press + drag = still a link, not a focus
 * Run against the static preview: python -m http.server 8765 -d dist
 */
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out = path.resolve('artifacts');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
await page.waitForSelector('.node', { timeout: 10000 });
await page.screenshot({ path: path.join(out, 'pf-00-initial.png') });

const portCenter = async (id) => {
  const box = await page.locator(`[data-port-id="${id}"]`).boundingBox();
  return box && { x: box.x + box.width / 2, y: box.y + box.height / 2, w: box.width, h: box.height };
};
const pillText = async () =>
  (await page.locator('.focus-pill').count()) ? page.locator('.focus-pill').innerText() : '(none)';

// --- 1. wheel = zoom, anchored at the pointer ---
const zoomBefore = await page.locator('.canvas-zoom span').innerText();
const canvasBox = await page.locator('.canvas').boundingBox();
const anchor = { x: canvasBox.x + canvasBox.width / 2, y: canvasBox.y + canvasBox.height / 2 };
await page.mouse.move(anchor.x, anchor.y);
await page.mouse.wheel(0, -240);
await page.waitForTimeout(200);
const zoomAfter = await page.locator('.canvas-zoom span').innerText();
console.log(`WHEEL_ZOOM=${zoomBefore}->${zoomAfter}`);
await page.keyboard.press('f');
await page.waitForTimeout(350);

// --- 2. hit target size + no overlapping targets ---
const rects = await page.locator('.port').evaluateAll((els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.portId, left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
  }),
);
const sizes = await page.locator('.port').evaluateAll((els) =>
  [...new Set(els.map((el) => `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`))],
);
const overlaps = [];
for (let i = 0; i < rects.length; i += 1) {
  for (let j = i + 1; j < rects.length; j += 1) {
    const a = rects[i];
    const b = rects[j];
    if (
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
    ) {
      overlaps.push(`${a.id}~${b.id}`);
    }
  }
}
console.log('PORT_SIZE=' + JSON.stringify(sizes) + ' OVERLAPS=' + JSON.stringify(overlaps));

// --- 3. click output port -> dim unrelated edges, keep downstream lit ---
const target = await portCenter('demo-x:out');
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(300);
console.log('OUT_PILL=' + JSON.stringify(await pillText()));
console.log(
  `EDGES total=${await page.locator('.edge').count()} focused=${await page.locator('.edge.is-focused').count()}` +
    ` follow=${await page.locator('.edge.is-follow').count()} dimmed=${await page.locator('.edge.is-dimmed').count()}` +
    ` chainRows=${await page.locator('.port-chain-row').count()}`,
);
await page.screenshot({ path: path.join(out, 'pf-02-port-focus.png') });

// --- 4. click input port -> upstream + downstream ---
const input = await portCenter('demo-normalize:in:0');
await page.mouse.click(input.x, input.y);
await page.waitForTimeout(300);
console.log('IN_PILL=' + JSON.stringify(await pillText()));
await page.screenshot({ path: path.join(out, 'pf-06-input-port.png') });

// --- 5. click the same port again -> unfocus ---
await page.mouse.click(input.x, input.y);
await page.waitForTimeout(250);
console.log('AFTER_TOGGLE pill=' + (await page.locator('.focus-pill').count()) +
  ' dimmed=' + (await page.locator('.edge.is-dimmed').count()));

// --- 6. press + drag from a method output still creates a flow output ---
const addOut = await portCenter('demo-add:out:0');
await page.mouse.move(addOut.x, addOut.y);
await page.mouse.down();
await page.mouse.move(addOut.x + 60, addOut.y + 300, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(350);
console.log('AFTER_DRAG pill=' + (await page.locator('.focus-pill').count()) +
  ' values=' + (await page.locator('.value-node').count()));
await page.screenshot({ path: path.join(out, 'pf-03-after-drag.png') });
await page.screenshot({ path: path.join(out, 'pf-03-after-drag.png') });

// --- 7. portrait: same rules, vertical layout ---
await page.setViewportSize({ width: 900, height: 1180 });
await page.waitForTimeout(450);
const portrait = await page.locator('.port').evaluateAll((els) =>
  els.map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.portId, left: r.x, right: r.x + r.width, top: r.y, bottom: r.y + r.height };
  }),
);
const portraitOverlaps = [];
for (let i = 0; i < portrait.length; i += 1) {
  for (let j = i + 1; j < portrait.length; j += 1) {
    const a = portrait[i];
    const b = portrait[j];
    if (
      Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
      Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
    ) {
      portraitOverlaps.push(`${a.id}~${b.id}`);
    }
  }
}
console.log('PORTRAIT_OVERLAPS=' + JSON.stringify(portraitOverlaps));
const portraitPort = await portCenter('demo-x:out');
await page.mouse.click(portraitPort.x, portraitPort.y);
await page.waitForTimeout(300);
console.log('PORTRAIT_PILL=' + JSON.stringify(await pillText()));
await page.screenshot({ path: path.join(out, 'pf-08-portrait.png') });

console.log('ERRORS=' + JSON.stringify(errors));
await browser.close();
