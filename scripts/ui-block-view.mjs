import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Block view QA:
 *  - the parser folds a dispatcher into one block per branch
 *  - blocks render as a layered graph (depth bands, dependency edges)
 *  - clicking a block opens its nodes; clicking a node asks the host to reveal
 *    that line
 *  - slice mode dims everything outside the focused block's up/downstream
 *
 * Runs against the static preview: python -m http.server 8765 -d dist
 */

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const out = path.resolve('artifacts');
await mkdir(out, { recursive: true });

const source = [
  'def dispatch(expr, scale):',
  '    if expr is None:',
  '        return 0',
  '    if isinstance(expr, int):',
  '        out = expr * scale',
  '    elif isinstance(expr, str):',
  '        out = len(expr)',
  '    elif isinstance(expr, (list, tuple)):',
  '        out = len(expr) * scale',
  '    else:',
  '        out = 0',
  '    total = out + scale',
  '    return total',
].join('\n');

const parsed = JSON.parse(execFileSync('python', [path.resolve('python/parse_flow.py')], {
  input: JSON.stringify({ source, filename: 'blocks.py', entry: 'dispatch' }),
  encoding: 'utf8',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
}));
if (!parsed.ok) throw new Error(`parse failed: ${JSON.stringify(parsed.error)}`);
const regions = parsed.graph.regions ?? [];
console.log(`REGIONS=${regions.length} NODES=${parsed.graph.nodes.length}`);
if (!regions.length) throw new Error('parser returned no regions');

const browser = await chromium.launch({ executablePath: edge, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
// The static preview has no favicon; ignore that one 404 and keep real errors.
const ignorable = /Failed to load resource.*404/;
page.on('console', (msg) => {
  if (msg.type() === 'error' && !ignorable.test(msg.text())) errors.push(`console: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

// Pretend to be the VS Code host so the webview accepts a graph we push in.
await page.addInitScript(() => {
  window.__posted = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (msg) => window.__posted.push(msg),
    getState: () => undefined,
    setState: () => {},
  });
});

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
// With a stubbed host the webview shows its empty state until we push a graph,
// so wait for the shell (not for the block-view button) before dispatching.
await page.waitForSelector('.app', { timeout: 10000 });
await page.waitForTimeout(300);

await page.evaluate((graph) => {
  window.dispatchEvent(new MessageEvent('message', {
    data: {
      type: 'graph', graph, methods: [], pythonVersion: '3',
      fileName: 'blocks.py', filePath: 'blocks.py',
      documentUri: 'file:///blocks.py', dirty: false,
    },
  }));
}, parsed.graph);
await page.waitForSelector('.blockview-launch', { timeout: 10000 });

await page.locator('.blockview-launch').click();
await page.waitForSelector('.blockview-stage svg', { timeout: 5000 });

const count = await page.locator('.blockview-count').innerText();
console.log('LAUNCH_COUNT=' + count);

const bands = await page.locator('.blockview-stage svg text').evaluateAll(
  (els) => els.map((el) => el.textContent).filter((text) => text && text.startsWith('第 ')),
);
console.log('LAYER_BANDS=' + JSON.stringify(bands));
console.log('LAYER_COUNT=' + bands.length);

const cards = page.locator('.blockview-stage svg g[style]');
const cardCount = await cards.count();
console.log('CARDS=' + cardCount);
if (cardCount !== regions.length) throw new Error(`expected ${regions.length} cards, got ${cardCount}`);

const edgeCount = await page.locator('.blockview-stage svg path').count();
console.log('EDGES=' + edgeCount);

// Names should be readable, not raw ids.
const names = await cards.evaluateAll((els) => els.map((el) => {
  const label = el.querySelector('text');
  return label ? label.textContent : '';
}));
console.log('CARD_TEXT=' + JSON.stringify(names));
await page.screenshot({ path: path.join(out, 'blockview-overview.png') });

// Drill into the second block and jump to a line.
await cards.nth(1).click();
await page.waitForTimeout(200);
const detailRows = await page.locator('.blockview-node').count();
console.log('DETAIL_ROWS=' + detailRows);
if (detailRows === 0) throw new Error('clicking a block did not open its nodes');
await page.screenshot({ path: path.join(out, 'blockview-detail.png') });

await page.locator('.blockview-node').first().click();
await page.waitForTimeout(150);
const reveals = await page.evaluate(() => window.__posted.filter((m) => m.type === 'reveal'));
console.log('REVEAL=' + JSON.stringify(reveals.slice(0, 2)));
if (!reveals.length) throw new Error('clicking a node did not post a reveal');

// Slice mode: focus one block, everything unrelated goes dim.
await page.getByRole('button', { name: '切片' }).click();
await page.waitForTimeout(150);
await cards.nth(2).click();
await page.waitForTimeout(200);
const opacities = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('opacity')));
const dimmed = opacities.filter((value) => value === '0.3').length;
console.log(`SLICE dimmed=${dimmed} lit=${opacities.length - dimmed}`);
if (dimmed === 0 || dimmed === opacities.length) throw new Error('slice mode did not dim anything');
await page.screenshot({ path: path.join(out, 'blockview-slice.png') });

console.log('ERRORS=' + JSON.stringify(errors));
await browser.close();
if (errors.length) process.exit(1);
