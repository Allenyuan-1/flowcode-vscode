import { build, context } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await copyFile(path.join(root, 'webview/index.html'), path.join(dist, 'index.html'));
  await copyFile(path.join(root, 'python/parse_flow.py'), path.join(dist, 'parse_flow.py'));
  await copyFile(path.join(root, 'python/scan_imports.py'), path.join(dist, 'scan_imports.py'));
}

const extensionOptions = {
  entryPoints: [path.join(root, 'src/extension.ts')],
  outfile: path.join(dist, 'extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
};

const webviewOptions = {
  entryPoints: [path.join(root, 'webview/src/main.tsx')],
  outfile: path.join(dist, 'webview.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome110'],
  jsx: 'automatic',
  loader: { '.css': 'css' },
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
};

async function main() {
  if (!watch) {
    await rm(dist, { recursive: true, force: true });
  }
  await mkdir(dist, { recursive: true });
  await copyStatic();
  if (watch) {
    const [extCtx, webCtx] = await Promise.all([context(extensionOptions), context(webviewOptions)]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    console.log('FlowCode: watching extension + webview…');
  } else {
    await Promise.all([build(extensionOptions), build(webviewOptions)]);
    console.log('FlowCode: build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
