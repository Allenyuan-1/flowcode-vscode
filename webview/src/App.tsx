import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { BUILTIN_METHODS } from '../../src/core/registry';
import {
  autoWire, cloneMethodNode, createMethodNode, createValueNode, findFreeSpot, graphBounds, NODE_HEADER, NODE_WIDTH,
  nodeHeight, removeEdge, removeNodes, uid,
} from '../../src/core/graph';
import { generatePython } from '../../src/core/generate';
import { hydrateGraph } from '../../src/core/enrich';
import type { FlowGraph, MethodSpec, Point, PortType } from '../../src/core/types';
import { isVsCode, post, subscribe } from './host';
import { initialState, reducer } from './store';
import type { Selection } from './store';
import { TopBar } from './components/TopBar';
import { MethodLibrary } from './components/MethodLibrary';
import { FlowCanvas } from './components/FlowCanvas';
import type { CanvasApi } from './components/FlowCanvas';
import { Inspector } from './components/Inspector';
import { FileCanvas, FileInspector, FileLibrary, layoutFileGraph } from './components/FilesView';
import { StatusBar } from './components/StatusBar';
import { ApplyDialog, ErrorBanner, HelpDialog, Toasts } from './components/Overlays';
import { ParamEditor } from './components/ParamEditor';
import type { ParamEditTarget } from './components/ParamEditor';
import { MethodStudio, studioMethodSpec } from './components/MethodStudio';
import type { StudioDraft } from '../../src/core/studio';
import { Logo } from './icons';
import type { HostToWebview } from './messages';
import { uniqueName } from './utils';

export default function App() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const canvasApi = useRef<CanvasApi | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bootRef = useRef(false);
  const importedRef = useRef<(data: string) => void>(() => {});
  const [fileQuery, setFileQuery] = useState('');
  const [fileFitSignal, setFileFitSignal] = useState(0);
  const [paramEdit, setParamEdit] = useState<ParamEditTarget | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);

  const allMethods = useMemo(() => [...state.userMethods, ...BUILTIN_METHODS], [state.userMethods]);
  const fileGraph = useMemo(
    () => (state.fileGraph ? layoutFileGraph(structuredClone(state.fileGraph)) : null),
    [state.fileGraph],
  );

  const generated = useMemo(() => {
    if (!state.graph) return null;
    try {
      return generatePython(state.graph);
    } catch (error) {
      return {
        ok: false,
        code: '',
        warnings: [],
        imports: [],
        error: (error as Error).message,
      };
    }
  }, [state.graph]);

  const handleHostMessage = useCallback((message: HostToWebview) => {
    switch (message.type) {
      case 'graph': {
        const previous = stateRef.current;
        const sameEntry =
          previous.graph?.name === message.graph.name &&
          previous.graph?.entryKind === message.graph.entryKind &&
          previous.fileName === message.fileName;
        try {
          const graph = hydrateGraph(message.graph, message.methods, sameEntry && previous.graph ? previous.graph : undefined);
          dispatch({
            type: 'loadGraph',
            graph,
            methods: message.methods,
            fileName: message.fileName,
            filePath: message.filePath,
            documentUri: message.documentUri,
            pythonVersion: message.pythonVersion,
            fit:
              !sameEntry ||
              previous.notebook?.mode !== message.notebook?.mode ||
              previous.notebook?.activeCell !== message.notebook?.activeCell,
            notebook: message.notebook,
          });
        } catch (error) {
          dispatch({ type: 'error', message: `无法构建流程图：${(error as Error).message}`, kind: 'failed' });
        }
        break;
      }
      case 'error':
        dispatch({ type: 'error', message: message.message, kind: message.kind });
        if (message.kind === 'missing') {
          dispatch({ type: 'toast', kind: 'error', message: message.message });
        }
        break;
      case 'parseStart':
        dispatch({ type: 'parseStart' });
        break;
      case 'parseEnd':
        dispatch({ type: 'parseEnd' });
        break;
      case 'toast':
        dispatch({ type: 'toast', kind: message.kind, message: message.message });
        break;
      case 'applied':
        dispatch({ type: 'applied' });
        break;
      case 'cursor':
        dispatch({ type: 'cursor', line: message.line });
        break;
      case 'imported':
        importedRef.current(message.data);
        break;
      case 'fileGraph':
        dispatch({ type: 'loadFileGraph', graph: message.graph, root: message.root });
        break;
      default:
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImported = useCallback((data: string) => {
    try {
      const parsed = JSON.parse(data) as { graph?: FlowGraph; methods?: MethodSpec[] } & FlowGraph;
      const raw = parsed.graph ?? parsed;
      const methods = Array.isArray(parsed.methods) ? parsed.methods : stateRef.current.userMethods;
      const graph = hydrateGraph(raw, methods);
      dispatch({
        type: 'loadGraph',
        graph,
        methods,
        fileName: `${graph.name}.flow.json`,
        filePath: '',
        documentUri: '',
        fit: true,
        demo: true,
      });
      dispatch({ type: 'toast', kind: 'info', message: '流程图已导入（演示模式，可用“代码”页签复制）。' });
    } catch (error) {
      dispatch({ type: 'toast', kind: 'error', message: `导入失败：${(error as Error).message}` });
    }
  }, []);

  importedRef.current = handleImported;

  useEffect(() => {
    const unsubscribe = subscribe(handleHostMessage);
    if (isVsCode) {
      if (!bootRef.current) {
        bootRef.current = true;
        post({ type: 'ready' });
      }
    } else {
      dispatch({ type: 'loadDemo' });
    }
    return unsubscribe;
  }, [handleHostMessage]);

  useEffect(() => {
    if (state.parsedOnce) post({ type: 'dirty', dirty: state.dirty });
  }, [state.dirty, state.parsedOnce]);

  useEffect(() => {
    setParamEdit(null);
  }, [state.graph?.id]);

  const autoCollapsed = useRef(false);
  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 1300 && !autoCollapsed.current) {
        autoCollapsed.current = true;
        dispatch({ type: 'toggleRight', collapsed: true });
        window.setTimeout(() => dispatch({ type: 'fit' }), 280);
      } else if (window.innerWidth >= 1400 && autoCollapsed.current) {
        autoCollapsed.current = false;
        dispatch({ type: 'toggleRight', collapsed: false });
        window.setTimeout(() => dispatch({ type: 'fit' }), 280);
      }
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleMutate = useCallback(
    (mutate: (graph: FlowGraph) => void, options?: { history?: boolean; historyKey?: string }) => {
      dispatch({ type: 'mutate', mutate, history: options?.history, historyKey: options?.historyKey });
    },
    [],
  );

  const handleSelect = useCallback((selection: Selection) => {
    dispatch({ type: 'select', selection });
  }, []);

  const editParam = useCallback(
    (nodeId: string, side: 'in' | 'out', index: number, anchor: { x: number; y: number }) => {
      setParamEdit({ nodeId, side, index, anchor });
    },
    [],
  );

  const saveParam = useCallback(
    (target: ParamEditTarget, patch: { name: string; type: PortType; defaultValue?: string }) => {
      handleMutate((graph) => {
        const node = graph.nodes.find((item) => item.id === target.nodeId);
        if (!node) return;
        const ports = target.side === 'in' ? node.inputs : node.outputs;
        const port = ports[target.index];
        if (!port) return;
        if (port.type !== patch.type) port.annotation = undefined;
        port.name = patch.name;
        port.type = patch.type;
        if (target.side === 'in') {
          port.defaultValue = patch.defaultValue?.trim() ? patch.defaultValue : undefined;
          port.optional = port.defaultValue !== undefined;
        }
      });
      setParamEdit(null);
    },
    [handleMutate],
  );

  const completeStudio = useCallback((draft: StudioDraft) => {
    const current = stateRef.current;
    const used = new Set(current.userMethods.map((method) => method.name));
    let name = draft.name;
    let suffix = 2;
    while (used.has(name)) {
      name = `${draft.name}_${suffix}`;
      suffix += 1;
    }
    const spec = studioMethodSpec({ ...draft, name });
    dispatch({ type: 'addUserMethod', method: spec });
    if (current.graph) {
      const center = canvasApi.current?.center() ?? { x: 380, y: 260 };
      const node = createMethodNode(spec, {
        x: center.x - NODE_WIDTH / 2,
        y: center.y - NODE_HEADER / 2,
      });
      node.position = findFreeSpot(current.graph, node.position, NODE_WIDTH, nodeHeight(node));
      dispatch({
        type: 'mutate',
        mutate: (graph) => {
          graph.nodes.push(node);
          autoWire(graph, node, node.position.x);
        },
      });
      dispatch({ type: 'select', selection: { kind: 'node', id: node.id } });
      window.requestAnimationFrame(() => canvasApi.current?.reflow());
    }
    setStudioOpen(false);
    dispatch({ type: 'toast', kind: 'success', message: `已建立方法块「${name}」，可在方法库「当前文件」中找到。` });
  }, []);

  const addMethodAt = useCallback(
    (methodId: string, point?: Point) => {
      const current = stateRef.current;
      if (!current.graph) return;
      const method = [...current.userMethods, ...BUILTIN_METHODS].find((m) => m.id === methodId);
      if (!method) {
        dispatch({ type: 'toast', kind: 'error', message: '找不到这个方法定义，请先刷新。' });
        return;
      }
      const center = point ?? canvasApi.current?.center() ?? { x: 320, y: 240 };
      const node = createMethodNode(method, {
        x: center.x - NODE_WIDTH / 2,
        y: center.y - NODE_HEADER / 2,
      });
      node.position = findFreeSpot(current.graph, node.position, NODE_WIDTH, nodeHeight(node));
      dispatch({
        type: 'mutate',
        mutate: (graph) => {
          graph.nodes.push(node);
          autoWire(graph, node, node.position.x);
        },
      });
      dispatch({ type: 'select', selection: { kind: 'node', id: node.id } });
      if (!point) {
        window.requestAnimationFrame(() => canvasApi.current?.reflow());
      }
    },
    [],
  );

  const duplicateNode = useCallback((id: string) => {
    const graph = stateRef.current.graph;
    const source = graph?.nodes.find((node) => node.id === id);
    if (!graph || !source) return;
    const clone = cloneMethodNode(source, uid('n'));
    clone.position = findFreeSpot(graph, clone.position, NODE_WIDTH, nodeHeight(clone));
    dispatch({
      type: 'mutate',
      mutate: (draft) => {
        draft.nodes.push(clone);
      },
    });
    dispatch({ type: 'select', selection: { kind: 'node', id: clone.id } });
  }, []);

  const addMethodById = useCallback(
    (methodId: string, point: Point) => addMethodAt(methodId, point),
    [addMethodAt],
  );

  const addSample = useCallback(() => {
    addMethodAt('op.add');
  }, [addMethodAt]);

  const deleteNode = useCallback((id: string) => {
    dispatch({
      type: 'mutate',
      mutate: (graph) => {
        removeNodes(graph, [id]);
      },
    });
    dispatch({ type: 'select', selection: null });
  }, []);

  const deleteValue = useCallback((id: string) => {
    dispatch({
      type: 'mutate',
      mutate: (graph) => {
        removeNodes(graph, [id]);
      },
    });
    dispatch({ type: 'select', selection: null });
  }, []);

  const deleteEdgeById = useCallback((id: string) => {
    dispatch({
      type: 'mutate',
      mutate: (graph) => {
        removeEdge(graph, id);
      },
    });
    dispatch({ type: 'select', selection: null });
  }, []);

  const deleteSelection = useCallback(() => {
    const selection = stateRef.current.selected;
    if (!selection) return;
    if (selection.kind === 'edge') deleteEdgeById(selection.id);
    else if (selection.kind === 'port') return;
    else deleteNode(selection.id);
  }, [deleteEdgeById, deleteNode]);

  const addInput = useCallback(() => {
    const graph = stateRef.current.graph;
    if (!graph) return;
    const bounds = graphBounds(graph);
    const value = createValueNode({
      kind: 'input',
      name: uniqueName(graph, 'input'),
      type: 'any',
      position: { x: bounds.x - 160, y: bounds.y + 30 + graph.values.filter((v) => v.kind === 'input').length * 58 },
      id: uid('v'),
    });
    dispatch({
      type: 'mutate',
      mutate: (draft) => {
        draft.values.push(value);
      },
    });
    dispatch({ type: 'select', selection: { kind: 'value', id: value.id } });
    dispatch({ type: 'rightTab', tab: 'params' });
  }, []);

  const addOutput = useCallback(() => {
    const graph = stateRef.current.graph;
    if (!graph) return;
    const bounds = graphBounds(graph);
    const outputs = graph.values.filter((v) => v.kind === 'output').length;
    const value = createValueNode({
      kind: 'output',
      name: uniqueName(graph, 'result'),
      type: 'any',
      position: { x: bounds.x + bounds.width + 80, y: bounds.y + 30 + outputs * 58 },
      id: uid('v'),
    });
    dispatch({
      type: 'mutate',
      mutate: (draft) => {
        draft.values.push(value);
      },
    });
    dispatch({ type: 'select', selection: { kind: 'value', id: value.id } });
    dispatch({ type: 'rightTab', tab: 'params' });
  }, []);

  const refresh = useCallback(() => {
    if (stateRef.current.demo) {
      dispatch({ type: 'toast', kind: 'info', message: '演示模式：代码是内置示例。打开 Python 文件后可以重新解析。' });
      return;
    }
    post({ type: 'refresh' });
  }, []);

  const changeEntry = useCallback((name: string) => {
    dispatch({ type: 'entryName', name });
    if (stateRef.current.demo) {
      dispatch({ type: 'toast', kind: 'info', message: '演示模式只有 main() 一个入口。' });
      return;
    }
    post({ type: 'refresh', entry: name });
  }, []);

  const changeCell = useCallback((cell: number) => {
    dispatch({ type: 'viewMode', mode: 'flow' });
    if (stateRef.current.demo) {
      dispatch({ type: 'toast', kind: 'info', message: '演示模式没有 Notebook；打开 .ipynb 后可切换 Cell。' });
      return;
    }
    post({ type: 'refresh', cell });
  }, []);

  const changeViewMode = useCallback((mode: 'flow' | 'files') => {
    if (mode === 'files' && !isVsCode) {
      dispatch({ type: 'toast', kind: 'info', message: '演示模式没有工作区文件可扫描。打开 VS Code 后可用文件关系。' });
      return;
    }
    dispatch({ type: 'viewMode', mode });
    if (mode === 'files') {
      dispatch({ type: 'filesLoading', loading: true });
      post({ type: 'scanFiles' });
    }
  }, []);

  const reflow = useCallback(
    (width: number, height: number, orientation: 'horizontal' | 'vertical') => {
      dispatch({ type: 'reflow', width, height, orientation });
    },
    [],
  );

  const autoLayout = useCallback(() => {
    canvasApi.current?.reflow();
  }, []);

  const setOrientation = useCallback((mode: 'auto' | 'horizontal' | 'vertical') => {
    if (mode === 'auto') {
      dispatch({ type: 'orientation', orientation: stateRef.current.orientation, mode: 'auto' });
      window.requestAnimationFrame(() => canvasApi.current?.reflow());
      return;
    }
    dispatch({ type: 'orientation', orientation: mode, mode: 'manual' });
    canvasApi.current?.reflow(mode);
  }, []);

  const apply = useCallback(() => {
    const current = stateRef.current;
    if (!current.graph) return;
    if (current.notebook?.mode === 'all') {
      dispatch({ type: 'toast', kind: 'warn', message: '“全部 Cell”是汇总视图；请在顶部选择一个 Cell 再写回。' });
      return;
    }
    if (!generated?.ok) {
      dispatch({ type: 'toast', kind: 'error', message: generated?.error ?? '暂时无法生成代码' });
      return;
    }
    dispatch({ type: 'applyOpen', open: true });
  }, [generated]);

  const confirmApply = useCallback(() => {
    const current = stateRef.current;
    if (!generated?.ok) return;
    if (current.notebook?.mode === 'all') {
      dispatch({ type: 'applyOpen', open: false });
      dispatch({ type: 'toast', kind: 'warn', message: '请选择一个 Cell 再写回。' });
      return;
    }
    if (current.demo) {
      dispatch({ type: 'applyOpen', open: false });
      dispatch({ type: 'toast', kind: 'info', message: '演示模式：代码已生成，可复制到编辑器中使用。' });
      dispatch({ type: 'rightTab', tab: 'code' });
      return;
    }
    dispatch({ type: 'setApplying', applying: true });
    post({ type: 'apply', code: generated.code });
  }, [generated]);

  const copy = useCallback((text: string) => {
    if (isVsCode) {
      post({ type: 'copy', text });
      return;
    }
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(text);
      dispatch({ type: 'toast', kind: 'success', message: '已复制到剪贴板。' });
    }
  }, []);

  const reveal = useCallback((line: number, character = 0) => {
    if (isVsCode) post({ type: 'reveal', line, character });
    else dispatch({ type: 'toast', kind: 'info', message: `第 ${line} 行（演示模式无法跳转）` });
  }, []);

  const exportJson = useCallback(() => {
    const graph = stateRef.current.graph;
    if (!graph) return;
    const json = JSON.stringify({ version: 1, graph, methods: stateRef.current.userMethods }, null, 2);
    if (isVsCode) {
      post({ type: 'export', json });
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${graph.name || 'flow'}.flow.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const importJson = useCallback(() => {
    if (isVsCode) {
      post({ type: 'import' });
      return;
    }
    fileInputRef.current?.click();
  }, []);

  const settings = useCallback(() => {
    if (isVsCode) post({ type: 'openSettings' });
    else dispatch({ type: 'toast', kind: 'info', message: '在 VS Code 中可以通过设置搜索 FlowCode。' });
  }, []);

  const openFile = useCallback(() => {
    if (isVsCode) post({ type: 'openFile' });
    else dispatch({ type: 'toast', kind: 'info', message: '演示模式：请直接运行插件的开发版。' });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const editing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable;
      if (event.key === 'Escape') {
        dispatch({ type: 'applyOpen', open: false });
        dispatch({ type: 'helpOpen', open: false });
        dispatch({ type: 'menuOpen', open: false });
        if (stateRef.current.selected) dispatch({ type: 'select', selection: null });
        return;
      }
      if (editing) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        if (stateRef.current.applyOpen) confirmApply();
        else apply();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (stateRef.current.selected) {
          event.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (!mod && event.key.toLowerCase() === 'f') {
        if (stateRef.current.viewMode === 'files') setFileFitSignal((value) => value + 1);
        else dispatch({ type: 'fit' });
        return;
      }
      if (!mod && (event.key === '?' || event.key === 'h')) {
        dispatch({ type: 'helpOpen', open: true });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [apply, confirmApply, deleteSelection]);

  if (!state.graph) {
    return (
      <div className="app boot-screen">
        <Logo size={42} />
        <div className="boot-title">FlowCode</div>
        <div className="boot-sub">{state.error?.message ?? '正在读取 Python 文件并构建流程图…'}</div>
        {state.error && (
          <div className="boot-actions">
            <button className="btn" onClick={refresh}>
              重试
            </button>
            {state.error.kind === 'missing' && (
              <>
                <button className="btn" onClick={settings}>设置解释器</button>
                <button className="btn" onClick={openFile}>打开 Python 文件</button>
              </>
            )}
          </div>
        )}
        <div className="boot-bar"><span /></div>
        <Toasts toasts={state.toasts} onDismiss={(id) => dispatch({ type: 'dismissToast', id })} />
      </div>
    );
  }

  const graph = state.graph;

  return (
    <div className="app">
      <TopBar
        fileName={state.fileName}
        filePath={state.filePath}
        entryName={state.entryName}
        entryKind={graph.entryKind}
        methods={state.userMethods}
        notebook={state.notebook}
        viewMode={state.viewMode}
        orientation={state.orientation}
        orientationMode={state.orientationMode}
        dirty={state.dirty}
        syncing={state.syncing}
        demo={state.demo}
        rightCollapsed={state.rightCollapsed}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        menuOpen={state.menuOpen}
        onEntry={changeEntry}
        onCell={changeCell}
        onViewMode={changeViewMode}
        onOrientation={setOrientation}
        onRefresh={refresh}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onLayout={autoLayout}
        onFit={() => {
          if (state.viewMode === 'files') setFileFitSignal((value) => value + 1);
          else dispatch({ type: 'fit' });
        }}
        onApply={apply}
        onToggleRight={() => dispatch({ type: 'toggleRight' })}
        onExport={exportJson}
        onImport={importJson}
        onHelp={() => dispatch({ type: 'helpOpen', open: true })}
        onMenu={(open) => dispatch({ type: 'menuOpen', open })}
        onSettings={settings}
      />

      <div className={`workspace ${state.rightCollapsed ? 'right-is-collapsed' : ''}`}>
        {state.viewMode === 'files' ? (
          <>
            <FileLibrary
              graph={fileGraph}
              selected={state.selectedFile}
              query={fileQuery}
              onQuery={setFileQuery}
              onSelect={(path) => dispatch({ type: 'selectFile', path })}
            />
            <div className="canvas-column">
              <FileCanvas
                graph={fileGraph}
                selected={state.selectedFile}
                fitSignal={fileFitSignal}
                onSelect={(path) => dispatch({ type: 'selectFile', path })}
              />
            </div>
            <FileInspector
              graph={fileGraph}
              selected={state.selectedFile}
              collapsed={state.rightCollapsed}
              onSelect={(path) => dispatch({ type: 'selectFile', path })}
              onClose={() => dispatch({ type: 'toggleRight' })}
            />
          </>
        ) : (
          <>
            <MethodLibrary
              methods={allMethods}
              tab={state.libraryTab}
              query={state.query}
              onTab={(tab) => dispatch({ type: 'libraryTab', tab })}
              onQuery={(query) => dispatch({ type: 'query', query })}
              onAdd={(method) => addMethodAt(method.id)}
              onStudio={() => setStudioOpen(true)}
            />

            <div className="canvas-column">
              {state.error && (
                <ErrorBanner
                  message={state.error.message}
                  kind={state.error.kind}
                  onClose={() => dispatch({ type: 'error', message: '', kind: '' })}
                  onSettings={settings}
                  onOpenFile={openFile}
                  onRefresh={refresh}
                />
              )}
              <FlowCanvas
                graph={graph}
                selected={state.selected}
                viewport={state.viewport}
                fitSignal={state.fitSignal}
                layoutSignal={state.layoutSignal}
                orientation={state.orientation}
                orientationMode={state.orientationMode}
                syncing={state.syncing}
                apiRef={canvasApi}
                onViewport={(viewport) => dispatch({ type: 'viewport', viewport })}
                onReflow={reflow}
                onSelect={handleSelect}
                onMutate={handleMutate}
                onPushHistory={(snapshot) => dispatch({ type: 'pushHistory', snapshot })}
                onReveal={reveal}
                onDeleteNode={deleteNode}
                onDeleteValue={deleteValue}
                onDeleteEdge={deleteEdgeById}
                onAddMethod={addMethodById}
                onEditParam={editParam}
                onError={(message) => dispatch({ type: 'toast', kind: 'warn', message })}
                onAddSample={addSample}
                onRefresh={refresh}
              />
            </div>

            <Inspector
              graph={graph}
              selected={state.selected}
              collapsed={state.rightCollapsed}
              tab={state.rightTab}
              generated={generated}
              dirty={state.dirty}
              demo={state.demo}
              onToggle={() => dispatch({ type: 'toggleRight' })}
              onTab={(tab) => dispatch({ type: 'rightTab', tab })}
              onSelect={handleSelect}
              onMutate={handleMutate}
              onDeleteSelection={deleteSelection}
              onDuplicate={duplicateNode}
              onReveal={reveal}
              onAddInput={addInput}
              onAddOutput={addOutput}
              onApply={apply}
              onCopy={copy}
              onToast={(message, kind = 'info') => dispatch({ type: 'toast', kind, message })}
            />
          </>
        )}
      </div>

      <StatusBar
        graph={graph}
        fileGraph={fileGraph}
        viewMode={state.viewMode}
        generated={generated}
        pythonVersion={state.pythonVersion}
        zoom={state.viewport.zoom}
        rightCollapsed={state.rightCollapsed}
        rightTab={state.rightTab}
        demo={state.demo}
        syncing={state.syncing}
        onWarnings={() => {
          dispatch({ type: 'select', selection: null });
          dispatch({ type: 'rightTab', tab: 'params' });
          dispatch({ type: 'toggleRight', collapsed: false });
        }}
        onCode={() => dispatch({ type: 'rightTab', tab: 'code' })}
        onToggleRight={() => dispatch({ type: 'toggleRight' })}
        onHelp={() => dispatch({ type: 'helpOpen', open: true })}
      />

      {state.viewMode === 'flow' && (
        <ParamEditor
          graph={graph}
          target={paramEdit}
          onClose={() => setParamEdit(null)}
          onSave={saveParam}
        />
      )}

      {studioOpen && <MethodStudio graph={graph} onClose={() => setStudioOpen(false)} onComplete={completeStudio} />}

      <Toasts toasts={state.toasts} onDismiss={(id) => dispatch({ type: 'dismissToast', id })} />

      {state.applyOpen && generated?.ok && (
        <ApplyDialog
          graph={graph}
          generated={generated}
          demo={state.demo}
          applying={state.applying}
          onClose={() => dispatch({ type: 'applyOpen', open: false })}
          onConfirm={confirmApply}
          onCopy={copy}
        />
      )}
      {state.helpOpen && <HelpDialog onClose={() => dispatch({ type: 'helpOpen', open: false })} />}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => handleImported(String(reader.result ?? ''));
          reader.readAsText(file);
          event.target.value = '';
        }}
      />
    </div>
  );
}
