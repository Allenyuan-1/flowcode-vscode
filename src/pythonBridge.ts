import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { FileGraph, ParseResult } from './core/types';

const execFileAsync = promisify(execFile);

export interface PythonInfo {
  command: string;
  args: string[];
  version: string;
}

export class PythonBridgeError extends Error {
  constructor(
    message: string,
    readonly kind: 'missing' | 'timeout' | 'failed' | 'syntax' = 'failed',
  ) {
    super(message);
    this.name = 'PythonBridgeError';
  }
}

const cache = new Map<string, PythonInfo>();

async function probe(command: string, args: string[]): Promise<PythonInfo | undefined> {
  try {
    const { stdout } = await execFileAsync(command, [...args, '-c', 'import sys; print(sys.version.split()[0])'], {
      timeout: 8000,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const version = stdout.trim().split(/\r?\n/).pop() ?? '';
    if (!version) return undefined;
    return { command, args, version };
  } catch {
    return undefined;
  }
}

export async function findPython(explicit?: string): Promise<PythonInfo> {
  const key = explicit ?? '';
  const hit = cache.get(key);
  if (hit) return hit;
  const candidates: { command: string; args: string[] }[] = [];
  if (explicit && explicit.trim()) candidates.push({ command: explicit.trim(), args: [] });
  candidates.push(
    { command: 'python', args: [] },
    { command: 'python3', args: [] },
    { command: 'py', args: ['-3'] },
  );
  for (const candidate of candidates) {
    const info = await probe(candidate.command, candidate.args);
    if (info) {
      cache.set(key, info);
      return info;
    }
  }
  throw new PythonBridgeError(
    '没有找到 Python 解释器。请安装 Python，或在设置 flowcode.pythonPath 中指定解释器路径。',
    'missing',
  );
}

export interface ParseOptions {
  filename: string;
  cursorLine?: number;
  entry?: string;
  pythonPath?: string;
  signal?: AbortSignal;
  cells?: { source: string }[];
  cellIndex?: number;
}

export async function parseWithPython(source: string, options: ParseOptions): Promise<ParseResult> {
  const python = await findPython(options.pythonPath);
  const script = path.join(__dirname, 'parse_flow.py');
  const payload = JSON.stringify({
    source,
    filename: options.filename,
    cursorLine: options.cursorLine,
    entry: options.entry,
    cells: options.cells,
    cellIndex: options.cellIndex,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(python.command, [...python.args, script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new PythonBridgeError('解析超时（20 秒）。代码文件可能过大。', 'timeout'));
    }, 20_000);
    options.signal?.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new PythonBridgeError('解析已取消', 'failed'));
    });
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin?.on('error', () => {
      // The parser may exit before consuming all input; the close handler
      // below reports the useful error.
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PythonBridgeError(`无法启动 Python：${error.message}`, 'missing'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const errText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new PythonBridgeError(errText || `Python 进程退出，代码 ${code}`, 'failed'));
        return;
      }
      try {
        const text = Buffer.concat(stdout).toString('utf8').replace(/^\uFEFF/, '');
        const result = JSON.parse(text) as ParseResult;
        if (!result.ok) {
          reject(new PythonBridgeError(result.error?.message ?? '解析失败', 'syntax'));
          return;
        }
        resolve(result);
      } catch (error) {
        reject(new PythonBridgeError(`解析结果不是有效 JSON：${(error as Error).message}`, 'failed'));
      }
    });
    child.stdin?.end(payload, 'utf8');
  });
}

export async function scanImports(
  files: { relPath: string; source: string }[],
  root: string,
  pythonPath?: string,
): Promise<FileGraph> {
  const python = await findPython(pythonPath);
  const script = path.join(__dirname, 'scan_imports.py');
  const payload = JSON.stringify({ root, files });
  return new Promise((resolve, reject) => {
    const child = spawn(python.command, [...python.args, script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new PythonBridgeError('扫描工作区超时（30 秒）。', 'timeout'));
    }, 30_000);
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin?.on('error', () => {
      // close handler reports the useful error
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new PythonBridgeError(`无法启动 Python：${error.message}`, 'missing'));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const errText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new PythonBridgeError(errText || `Python 进程退出，代码 ${code}`, 'failed'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')) as FileGraph);
      } catch (error) {
        reject(new PythonBridgeError(`文件关系结果不是有效 JSON：${(error as Error).message}`, 'failed'));
      }
    });
    child.stdin?.end(payload, 'utf8');
  });
}
