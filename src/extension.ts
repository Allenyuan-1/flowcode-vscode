import * as vscode from 'vscode';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { parseWithPython, scanImports, PythonBridgeError } from './pythonBridge';
import { localStudioDraft, normalizeStudioDraft } from './core/studio';
import type { StudioDraft } from './core/studio';
import type { FileGraph, FlowGraph, MethodSpec, ParseResult } from './core/types';

function nonce(): string {
  return randomBytes(16).toString('base64');
}

function basename(uri: vscode.Uri): string {
  return path.basename(uri.fsPath);
}

function pythonCodeCells(notebook: vscode.NotebookDocument): vscode.NotebookCell[] {
  const code = notebook.getCells().filter((cell) => cell.kind === vscode.NotebookCellKind.Code);
  const python = code.filter((cell) => !cell.document.languageId || cell.document.languageId === 'python');
  return python.length ? python : code;
}

function isPythonNotebook(notebook: vscode.NotebookDocument): boolean {
  if (notebook.uri.fsPath.toLowerCase().endsWith('.ipynb')) return true;
  return notebook.notebookType.toLowerCase().includes('jupyter');
}

/** Keep imports, magics and top-level def/class blocks when replacing a cell. */
function cellPreamble(source: string): string {
  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  let index = 0;
  const isPreamble = (line: string) => {
    const text = line.trim();
    return !text || text.startsWith('#') || text.startsWith('%') || text.startsWith('!')
      || /^(import|from)\s/.test(text);
  };
  while (index < lines.length && isPreamble(lines[index])) {
    kept.push(lines[index]);
    index += 1;
  }
  while (index < lines.length) {
    const line = lines[index];
    if (/^@/.test(line)) {
      const start = index;
      index += 1;
      while (index < lines.length && (lines[index].startsWith('@') || !lines[index].trim())) index += 1;
      if (index < lines.length && /^(async\s+def|def|class)\s/.test(lines[index])) {
        index += 1;
        while (index < lines.length) {
          const next = lines[index];
          if (next.trim() && !/^\s/.test(next)) break;
          index += 1;
        }
        kept.push(...lines.slice(start, index));
      }
      continue;
    }
    if (/^(async\s+def|def|class)\s/.test(line)) {
      const start = index;
      index += 1;
      while (index < lines.length) {
        const next = lines[index];
        if (next.trim() && !/^\s/.test(next)) break;
        index += 1;
      }
      kept.push(...lines.slice(start, index));
      continue;
    }
    index += 1;
  }
  return kept.join('\n').trim();
}

interface TextTarget {
  kind: 'text';
  doc: vscode.TextDocument;
}

interface NotebookTarget {
  kind: 'notebook';
  notebook: vscode.NotebookDocument;
}

type Target = TextTarget | NotebookTarget;

interface LastParse {
  graph: FlowGraph;
  methods: MethodSpec[];
  targetKind: 'text' | 'notebook';
  documentUri: string;
  documentVersion: number;
  entryName: string;
  entryKind: 'function' | 'module';
  sourceRange?: FlowGraph['sourceRange'];
  pythonVersion?: string;
  notebookUri?: string;
  cellIndex: number;
  notebookMode?: 'all' | 'cell';
}

export class FlowCodeManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private panelDisposables: vscode.Disposable[] = [];
  private commandDisposables: vscode.Disposable[] = [];
  private lastParse: LastParse | undefined;
  private targetKind: 'text' | 'notebook' = 'text';
  private documentUri: string | undefined;
  private notebookUri: string | undefined;
  private notebookCell = 0;
  private notebookMode: 'all' | 'cell' = 'cell';
  private dirty = false;
  private parseToken = 0;
  private parsing = false;
  private lastCursorLine = 1;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async open(): Promise<void> {
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (notebookEditor && isPythonNotebook(notebookEditor.notebook)) {
      this.targetKind = 'notebook';
      this.notebookUri = notebookEditor.notebook.uri.toString();
      this.notebookCell = this.cellIndexFromSelection(notebookEditor);
      this.notebookMode = 'cell';
      if (this.panel) {
        this.panel.reveal(undefined, true);
        await this.refresh(undefined, false, this.notebookCell);
        return;
      }
      this.createPanel();
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
      if (this.panel && (this.documentUri || this.notebookUri)) {
        this.panel.reveal(undefined, true);
        await this.refresh();
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        'FlowCode 需要一个 Python 编辑器或 Jupyter Notebook。',
        '打开文件',
      );
      if (choice) {
        await vscode.commands.executeCommand('workbench.action.files.openFile');
      }
      return;
    }
    this.targetKind = 'text';
    this.documentUri = editor.document.uri.toString();
    this.lastCursorLine = editor.selection.active.line + 1;
    if (this.panel) {
      this.panel.reveal(undefined, true);
      await this.refresh();
      return;
    }
    this.createPanel();
  }

  private cellIndexFromSelection(editor: vscode.NotebookEditor): number {
    const cells = pythonCodeCells(editor.notebook);
    const selected = editor.notebook.cellAt(editor.selection.start);
    const index = cells.findIndex((cell) => cell.document.uri.toString() === selected.document.uri.toString());
    return index >= 0 ? index : 0;
  }

  private createPanel(): void {
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    this.panel = vscode.window.createWebviewPanel(
      'flowcode.panel',
      'FlowCode',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaRoot],
      },
    );
    const icon = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.png');
    this.panel.iconPath = { light: icon, dark: icon };
    this.panel.webview.html = this.html(this.panel.webview);

    this.panel.onDidDispose(() => this.disposePanel(), null, this.panelDisposables);
    this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message), null, this.panelDisposables);
    this.panel.onDidChangeViewState(
      () => {
        if (this.panel?.visible) this.updateTitle();
      },
      null,
      this.panelDisposables,
    );
    this.updateTitle();
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css'));
    const n = nonce();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${n}';" />
<link rel="stylesheet" href="${style}" />
<title>FlowCode</title>
</head>
<body>
<div id="root"><div class="boot">正在启动 FlowCode…</div></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }

  private updateTitle(): void {
    if (!this.panel) return;
    const uri = this.targetKind === 'notebook' ? this.notebookUri : this.documentUri;
    const file = uri ? path.basename(vscode.Uri.parse(uri).fsPath) : '未打开文件';
    this.panel.title = `FlowCode · ${file}`;
  }

  private post(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private toast(message: string, kind: 'info' | 'warn' | 'error' = 'info'): void {
    this.post({ type: 'toast', kind, message });
  }

  private async resolveTarget(): Promise<Target | undefined> {
    const notebookEditor = vscode.window.activeNotebookEditor;
    if (notebookEditor && isPythonNotebook(notebookEditor.notebook)) {
      this.targetKind = 'notebook';
      this.notebookUri = notebookEditor.notebook.uri.toString();
      return { kind: 'notebook', notebook: notebookEditor.notebook };
    }
    const active = vscode.window.activeTextEditor;
    if (active?.document.languageId === 'python') {
      this.targetKind = 'text';
      this.documentUri = active.document.uri.toString();
      return { kind: 'text', doc: active.document };
    }
    if (this.targetKind === 'notebook' && this.notebookUri) {
      const notebook = vscode.workspace.notebookDocuments.find(
        (item) => item.uri.toString() === this.notebookUri,
      );
      if (notebook) return { kind: 'notebook', notebook };
    }
    if (this.documentUri) {
      const doc = vscode.workspace.textDocuments.find((item) => item.uri.toString() === this.documentUri);
      if (doc && doc.languageId === 'python') return { kind: 'text', doc };
    }
    return undefined;
  }

  async refresh(entry?: string, quiet = false, cellIndex?: number): Promise<void> {
    const target = await this.resolveTarget();
    if (!target) {
      this.post({ type: 'error', message: '没有找到 Python 文档或 Notebook。请打开一个 .py 或 .ipynb 文件。', kind: 'missing' });
      return;
    }
    if (target.kind === 'notebook') {
      if (typeof cellIndex === 'number') {
        if (cellIndex < 0) {
          this.notebookMode = 'all';
          this.notebookCell = 0;
        } else {
          this.notebookMode = 'cell';
          this.notebookCell = cellIndex;
        }
      }
      await this.refreshNotebook(target.notebook, quiet);
      return;
    }
    await this.refreshText(target.doc, entry, quiet);
  }

  private async refreshNotebook(notebook: vscode.NotebookDocument, quiet: boolean): Promise<void> {
    const cells = pythonCodeCells(notebook);
    if (!cells.length) {
      this.post({ type: 'error', message: '这个 Notebook 没有 Python 代码单元。', kind: 'syntax' });
      return;
    }
    const index = Math.min(Math.max(this.notebookCell, 0), cells.length - 1);
    this.notebookCell = index;
    const selected = this.notebookMode === 'all' ? -1 : index;
    this.notebookUri = notebook.uri.toString();
    this.targetKind = 'notebook';
    this.updateTitle();
    const token = ++this.parseToken;
    this.parsing = true;
    this.post({ type: 'parseStart' });
    try {
      const result = await parseWithPython('', {
        filename: notebook.uri.fsPath,
        cells: cells.map((cell) => ({ source: cell.document.getText() })),
        cellIndex: selected,
        pythonPath: vscode.workspace.getConfiguration('flowcode').get<string>('pythonPath') || undefined,
      });
      if (token !== this.parseToken) return;
      this.lastParse = {
        graph: result.graph,
        methods: result.methods,
        targetKind: 'notebook',
        documentUri: notebook.uri.toString(),
        documentVersion: notebook.version,
        entryName: result.graph.name,
        entryKind: 'module',
        pythonVersion: result.pythonVersion,
        notebookUri: notebook.uri.toString(),
        cellIndex: selected,
        notebookMode: this.notebookMode,
      };
      this.dirty = false;
      this.post({
        type: 'graph',
        graph: result.graph,
        methods: result.methods,
        pythonVersion: result.pythonVersion,
        fileName: basename(notebook.uri),
        filePath: notebook.uri.fsPath,
        documentUri: notebook.uri.toString(),
        dirty: false,
        notebook: {
          mode: this.notebookMode,
          activeCell: index,
          count: cells.length,
          cells: result.graph.cells ?? [],
        },
      });
    } catch (error) {
      if (token !== this.parseToken) return;
      if (!quiet) {
        const kind = error instanceof PythonBridgeError ? error.kind : 'failed';
        this.post({ type: 'error', message: (error as Error).message, kind });
      }
    } finally {
      if (token === this.parseToken) {
        this.parsing = false;
        this.post({ type: 'parseEnd' });
      }
    }
  }

  private async refreshText(doc: vscode.TextDocument, entry: string | undefined, quiet: boolean): Promise<void> {
    this.targetKind = 'text';
    this.documentUri = doc.uri.toString();
    this.updateTitle();
    const token = ++this.parseToken;
    this.parsing = true;
    this.post({ type: 'parseStart' });
    try {
      const editor = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === doc.uri.toString());
      this.lastCursorLine = editor ? editor.selection.active.line + 1 : this.lastCursorLine;
      const result: ParseResult = await parseWithPython(doc.getText(), {
        filename: doc.uri.fsPath,
        cursorLine: entry ? undefined : this.lastCursorLine,
        entry,
        pythonPath: vscode.workspace.getConfiguration('flowcode').get<string>('pythonPath') || undefined,
      });
      if (token !== this.parseToken) return;
      this.lastParse = {
        graph: result.graph,
        methods: result.methods,
        targetKind: 'text',
        documentUri: doc.uri.toString(),
        documentVersion: doc.version,
        entryName: result.graph.name,
        entryKind: result.graph.entryKind,
        sourceRange: result.graph.sourceRange,
        pythonVersion: result.pythonVersion,
        cellIndex: 0,
      };
      this.dirty = false;
      this.post({
        type: 'graph',
        graph: result.graph,
        methods: result.methods,
        pythonVersion: result.pythonVersion,
        fileName: basename(doc.uri),
        filePath: doc.uri.fsPath,
        documentUri: doc.uri.toString(),
        dirty: false,
      });
    } catch (error) {
      if (token !== this.parseToken) return;
      if (!quiet) {
        const kind = error instanceof PythonBridgeError ? error.kind : 'failed';
        this.post({ type: 'error', message: (error as Error).message, kind });
      }
    } finally {
      if (token === this.parseToken) {
        this.parsing = false;
        this.post({ type: 'parseEnd' });
      }
    }
  }

  private async applyCode(code: string): Promise<void> {
    if (!this.lastParse) {
      this.toast('还没有可应用的流程图，请先刷新。', 'warn');
      return;
    }
    const target = await this.resolveTarget();
    if (!target) {
      this.toast('源文件已经关闭或切换，无法写入。', 'error');
      return;
    }
    if (target.kind === 'notebook') {
      await this.applyNotebookCode(target.notebook, code);
      return;
    }
    await this.applyTextCode(target.doc, code);
  }

  private async applyNotebookCode(notebook: vscode.NotebookDocument, code: string): Promise<void> {
    if (this.notebookMode === 'all' || this.lastParse?.cellIndex === -1) {
      this.toast('“全部 Cell”是汇总视图；请选择一个 Cell 再写回。', 'warn');
      return;
    }
    const cells = pythonCodeCells(notebook);
    const index = this.notebookCell;
    const cell = cells[index];
    if (!cell) {
      this.toast('找不到要写入的 Cell，请刷新后重试。', 'error');
      return;
    }
    try {
      const original = cell.document.getText();
      const prefix = cellPreamble(original);
      const nextCode = prefix ? `${prefix}\n\n${code}` : code;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        cell.document.uri,
        new vscode.Range(cell.document.positionAt(0), cell.document.positionAt(original.length)),
        nextCode,
      );
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        this.toast('VS Code 拒绝了这次 Cell 编辑。', 'error');
        return;
      }
      this.dirty = false;
      this.post({ type: 'applied' });
      this.toast(`已写入 Cell ${index + 1}，Ctrl+S 保存 Notebook。`, 'info');
      await this.refresh(undefined, true, index);
    } catch (error) {
      this.toast((error as Error).message, 'error');
    }
  }

  private async applyTextCode(doc: vscode.TextDocument, code: string): Promise<void> {
    if (!this.lastParse) return;
    if (doc.uri.toString() !== this.lastParse.documentUri) {
      this.toast('源文件已经关闭或切换，无法写入。', 'error');
      return;
    }
    try {
      const entryKind = this.lastParse.entryKind;
      let range = this.lastParse.sourceRange;
      if (entryKind === 'function') {
        const fresh = await parseWithPython(doc.getText(), {
          filename: doc.uri.fsPath,
          entry: this.lastParse.entryName,
          pythonPath: vscode.workspace.getConfiguration('flowcode').get<string>('pythonPath') || undefined,
        });
        if (fresh.graph.entryKind !== 'function' || fresh.graph.name !== this.lastParse.entryName) {
          throw new Error(`入口函数 ${this.lastParse.entryName}() 已不存在或已被重命名，请先刷新流程图。`);
        }
        range = fresh.graph.sourceRange;
      }
      const edit = new vscode.WorkspaceEdit();
      if (entryKind === 'function' && range) {
        edit.replace(
          doc.uri,
          new vscode.Range(
            range.start.line - 1,
            range.start.character,
            range.end.line - 1,
            range.end.character,
          ),
          code,
        );
      } else {
        const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
        edit.replace(doc.uri, full, code);
      }
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) {
        this.toast('VS Code 拒绝了这次编辑。', 'error');
        return;
      }
      this.dirty = false;
      this.post({ type: 'applied' });
      this.toast(
        entryKind === 'function'
          ? `已写入 ${this.lastParse.entryName}()，Ctrl+S 保存文件。`
          : '已写入模块级代码，Ctrl+S 保存文件。',
        'info',
      );
      if (entryKind === 'function') {
        await this.refresh(this.lastParse.entryName, true);
      }
    } catch (error) {
      this.toast((error as Error).message, 'error');
    }
  }

  private async reveal(line: number, character = 0): Promise<void> {
    const target = await this.resolveTarget();
    if (!target) return;
    if (target.kind === 'notebook') {
      const cells = pythonCodeCells(target.notebook);
      const index = Math.min(this.notebookCell, Math.max(0, cells.length - 1));
      await vscode.window.showNotebookDocument(target.notebook, {
        selections: [new vscode.NotebookRange(index, index + 1)],
      });
      await vscode.commands.executeCommand('notebook.cell.edit');
      return;
    }
    const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, character));
    const editor = await vscode.window.showTextDocument(target.doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: false,
      selection: new vscode.Range(position, position),
    });
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    void this.panel?.reveal(undefined, true);
  }

  private async exportGraph(json: string): Promise<void> {
    const name = this.lastParse?.entryName ?? 'flow';
    const uri = await vscode.window.showSaveDialog({
      title: '导出流程图',
      defaultUri: vscode.Uri.file(path.join(path.dirname(this.documentUri ? vscode.Uri.parse(this.documentUri).fsPath : ''), `${name}.flow.json`)),
      filters: { FlowCode: ['flow.json', 'json'] },
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));
    this.toast('流程图已导出。', 'info');
  }

  private async importGraph(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      title: '导入流程图',
      canSelectMany: false,
      filters: { FlowCode: ['json'] },
      openLabel: '导入',
    });
    if (!picked?.length) return;
    try {
      const data = Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8');
      this.post({ type: 'imported', data });
    } catch (error) {
      this.toast(`读取失败：${(error as Error).message}`, 'error');
    }
  }

  private async scanWorkspace(): Promise<void> {
    const activeUri = vscode.window.activeNotebookEditor?.notebook.uri
      ?? vscode.window.activeTextEditor?.document.uri
      ?? (this.notebookUri ? vscode.Uri.parse(this.notebookUri) : undefined)
      ?? (this.documentUri ? vscode.Uri.parse(this.documentUri) : undefined);
    const folder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
    const root = folder?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? (activeUri ? path.dirname(activeUri.fsPath) : '');
    try {
      let uris: vscode.Uri[];
      if (folder) {
        uris = await vscode.workspace.findFiles(
          '**/*.py',
          '**/{node_modules,.venv,venv,env,__pycache__,.git,dist,build}/**',
          300,
        );
      } else if (activeUri?.fsPath.endsWith('.py')) {
        uris = [activeUri];
      } else {
        uris = [];
      }
      const files: { relPath: string; source: string }[] = [];
      for (const uri of uris) {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > 350_000) continue;
        const relPath = path.relative(root, uri.fsPath).replace(/\\/g, '/');
        if (relPath.startsWith('..')) continue;
        const source = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        files.push({ relPath, source });
      }
      const graph: FileGraph = await scanImports(
        files,
        root,
        vscode.workspace.getConfiguration('flowcode').get<string>('pythonPath') || undefined,
      );
      this.post({ type: 'fileGraph', graph, root });
    } catch (error) {
      this.post({ type: 'toast', kind: 'error', message: `文件关系扫描失败：${(error as Error).message}` });
      this.post({
        type: 'fileGraph',
        root,
        graph: { root, nodes: [], edges: [], externals: [], warnings: [(error as Error).message] },
      });
    }
  }

  private readonly studioKeySecret = 'flowcode.apiKey';

  private async studioKeyStatus(): Promise<void> {
    const key = await this.context.secrets.get(this.studioKeySecret);
    this.post({ type: 'studioKeyStatus', hasKey: Boolean(key && key.trim()) });
  }

  /**
   * One-shot local bootstrap used by the installer agent: the setup file is
   * written to the OS temp directory, consumed on activation, and deleted.
   * The key never enters settings, workspace files, logs, or the webview.
   */
  async bootstrapStudio(): Promise<void> {
    const file = path.join(os.tmpdir(), 'flowcode-studio-setup.json');
    if (!fs.existsSync(file)) return;
    try {
      const payload = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        key?: string;
        baseUrl?: string;
        model?: string;
      };
      const key = String(payload.key ?? '').trim();
      if (!key) return;
      await this.context.secrets.store(this.studioKeySecret, key);
      const config = vscode.workspace.getConfiguration('flowcode');
      if (payload.baseUrl) await config.update('aiBaseUrl', String(payload.baseUrl), vscode.ConfigurationTarget.Global);
      if (payload.model) await config.update('aiModel', String(payload.model), vscode.ConfigurationTarget.Global);
      this.toast('方法工作室 API 已从本地一次性配置导入，并保存到 VS Code 密钥存储。', 'info');
    } catch {
      this.toast('方法工作室本地一次性配置读取失败。', 'warn');
    } finally {
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }

  private async generateStudio(requirements: string, code: string | undefined, apiKey: string | undefined): Promise<void> {
    const provided = apiKey?.trim();
    if (provided) await this.context.secrets.store(this.studioKeySecret, provided);
    const stored = provided || await this.context.secrets.get(this.studioKeySecret) || '';
    const local = localStudioDraft(requirements, code);
    if (!stored.trim()) {
      this.post({ type: 'studioResult', draft: local, source: 'local', error: '未配置 API Key，已使用本地生成。' });
      return;
    }
    try {
      const config = vscode.workspace.getConfiguration('flowcode');
      const baseUrl = (config.get<string>('aiBaseUrl') || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const model = config.get<string>('aiModel') || 'gpt-4o-mini';
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${stored}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '你是 FlowCode 的方法设计助手。只输出一个 JSON 对象，不要输出 Markdown。JSON 字段：name（snake_case 方法名）、effect（中文一句话，用于方法块）、description（中文说明）、code（完整可运行的 Python 函数源码）、inputs（数组，每项 name/type/defaultValue，type 只能是 number/int/string/boolean/list/dict/any/none）、outputs（数组，每项 name/type）。代码必须是 Python 3.9 兼容，函数名与 name 一致，返回类型与 outputs 对应。',
            },
            {
              role: 'user',
              content: `方法要求：\n${requirements}\n\n${code ? `已有代码（可以修改）：\n${code}\n` : ''}请生成方法。`,
            },
          ],
        }),
      });
      clearTimeout(timer);
      if (!response.ok) throw new Error(`AI API 返回 ${response.status}`);
      const data = await response.json() as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('AI API 没有返回内容');
      const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const draft = normalizeStudioDraft(JSON.parse(jsonText) as Partial<StudioDraft>, requirements, code);
      this.post({ type: 'studioResult', draft, source: 'ai' });
    } catch (error) {
      this.post({
        type: 'studioResult',
        draft: local,
        source: 'local',
        error: `AI 生成失败，已回退本地：${(error as Error).message}`,
      });
    }
  }

  private async setupAiFromClipboard(): Promise<void> {
    const key = (await vscode.env.clipboard.readText()).trim();
    if (!key) {
      this.toast('剪贴板为空：请先把 API Key 复制到剪贴板，再打开配置链接。', 'warn');
      return;
    }
    await this.context.secrets.store(this.studioKeySecret, key);
    await vscode.env.clipboard.writeText('');
    const config = vscode.workspace.getConfiguration('flowcode');
    await config.update('aiBaseUrl', 'https://api.deepseek.com', vscode.ConfigurationTarget.Global);
    await config.update('aiModel', 'deepseek-chat', vscode.ConfigurationTarget.Global);
    this.post({ type: 'studioKeyStatus', hasKey: true });
    this.toast('方法工作室 API 已保存到 VS Code 密钥存储，并配置为 DeepSeek。', 'info');
  }

  private async onMessage(message: { type: string; [key: string]: unknown }): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.refresh();
        break;
      case 'refresh':
        await this.refresh(
          typeof message.entry === 'string' ? message.entry : undefined,
          false,
          typeof message.cell === 'number' ? message.cell : undefined,
        );
        break;
      case 'apply':
        if (typeof message.code === 'string') await this.applyCode(message.code);
        break;
      case 'reveal':
        await this.reveal(Number(message.line) || 1, Number(message.character) || 0);
        break;
      case 'dirty':
        this.dirty = Boolean(message.dirty);
        break;
      case 'copy':
        if (typeof message.text === 'string') {
          await vscode.env.clipboard.writeText(message.text);
          this.toast('已复制到剪贴板。', 'info');
        }
        break;
      case 'toast':
        this.toast(String(message.message ?? ''), (message.kind as 'info' | 'warn' | 'error') ?? 'info');
        break;
      case 'export':
        if (typeof message.json === 'string') await this.exportGraph(message.json);
        break;
      case 'import':
        await this.importGraph();
        break;
      case 'scanFiles':
        await this.scanWorkspace();
        break;
      case 'studioKeyStatus':
        await this.studioKeyStatus();
        break;
      case 'studioSaveKey':
        if (typeof message.key === 'string') {
          if (message.key.trim()) await this.context.secrets.store(this.studioKeySecret, message.key.trim());
          else await this.context.secrets.delete(this.studioKeySecret);
          await this.studioKeyStatus();
        }
        break;
      case 'studioGenerate':
        await this.generateStudio(
          String(message.requirements ?? ''),
          typeof message.code === 'string' ? message.code : undefined,
          typeof message.apiKey === 'string' ? message.apiKey : undefined,
        );
        break;
      case 'parseSnippet': {
        // parse a code snippet (e.g. the AI-adjusted block) back into a graph
        const code = String(message.code ?? '');
        try {
          const parsed = await parseWithPython(code, { filename: 'block-adjust.py' });
          this.post({ type: 'snippetParsed', graph: parsed.graph });
        } catch (error) {
          this.post({ type: 'snippetParsed', error: (error as Error).message });
        }
        break;
      }
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:flowcode');
        break;
      case 'openFile':
        await vscode.commands.executeCommand('workbench.action.files.openFile');
        break;
      default:
        break;
    }
  }

  private onDidSave(document: vscode.TextDocument): void {
    if (!this.panel || !this.lastParse) return;
    if (this.lastParse.targetKind !== 'text') return;
    if (document.uri.toString() !== this.lastParse.documentUri) return;
    const auto = vscode.workspace.getConfiguration('flowcode').get<boolean>('autoRefresh', true);
    if (auto && !this.dirty && !this.parsing) {
      void this.refresh(undefined, true);
    }
  }

  private onDidSaveNotebook(notebook: vscode.NotebookDocument): void {
    if (!this.panel || !this.lastParse) return;
    if (this.lastParse.targetKind !== 'notebook') return;
    if (notebook.uri.toString() !== this.lastParse.notebookUri) return;
    const auto = vscode.workspace.getConfiguration('flowcode').get<boolean>('autoRefresh', true);
    if (auto && !this.dirty && !this.parsing) {
      void this.refresh(undefined, true, this.notebookMode === 'all' ? -1 : this.notebookCell);
    }
  }

  private onSelection(editor: vscode.TextEditor): void {
    if (!this.panel || !editor.selection) return;
    if (editor.document.uri.toString() !== this.documentUri) return;
    const line = editor.selection.active.line + 1;
    this.lastCursorLine = line;
    this.post({ type: 'cursor', line });
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!this.panel || !editor) return;
    if (editor.document.languageId !== 'python') return;
    this.post({ type: 'cursor', line: editor.selection.active.line + 1 });
  }

  register(): vscode.Disposable[] {
    this.commandDisposables.push(
      vscode.commands.registerCommand('flowcode.open', () => this.open()),
      vscode.commands.registerCommand('flowcode.refresh', () => this.refresh()),
      vscode.commands.registerCommand('flowcode.setupAi', () => this.setupAiFromClipboard()),
      vscode.workspace.onDidSaveTextDocument((doc) => this.onDidSave(doc)),
      vscode.workspace.onDidSaveNotebookDocument((notebook) => this.onDidSaveNotebook(notebook)),
      vscode.window.onDidChangeTextEditorSelection((event) => this.onSelection(event.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((editor) => this.onActiveEditor(editor)),
      vscode.window.registerUriHandler({
        handleUri: (uri) => {
          if (uri.path === '/setup-ai') {
            void this.setupAiFromClipboard();
            return;
          }
          if (!uri.path || uri.path === '/' || uri.path === '/open') {
            void this.open();
          }
        },
      }),
    );
    return this.commandDisposables;
  }

  private disposePanel(): void {
    this.panel = undefined;
    this.lastParse = undefined;
    while (this.panelDisposables.length) {
      try {
        this.panelDisposables.pop()?.dispose();
      } catch {
        // ignore
      }
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.disposePanel();
    while (this.commandDisposables.length) {
      try {
        this.commandDisposables.pop()?.dispose();
      } catch {
        // ignore
      }
    }
  }
}

let manager: FlowCodeManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  manager = new FlowCodeManager(context);
  context.subscriptions.push(...manager.register(), manager);
  void manager.bootstrapStudio();
  context.subscriptions.push(
    vscode.commands.registerCommand('flowcode.showOutput', () => {
      void vscode.window.showInformationMessage('FlowCode 已就绪：在 Python 编辑器或 Notebook 中点击右上角的流程图按钮。');
    }),
  );
}

export function deactivate(): void {
  manager?.dispose();
  manager = undefined;
}
