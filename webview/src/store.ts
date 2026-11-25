import { collectWarnings, foldSourceValues, syncSignature } from '../../src/core/graph';
import { demoGraph, demoMethods } from '../../src/core/sample';
import { enrichGraph } from '../../src/core/enrich';
import { layoutGraph } from '../../src/core/layout';
import type { FlowOrientation } from '../../src/core/layout';
import type { FileGraph, FlowGraph, MethodSpec } from '../../src/core/types';
import type { NotebookInfo } from './messages';

export type RightTab = 'params' | 'code';
export type LibraryTab = 'all' | 'builtin' | 'file';
export type ViewMode = 'flow' | 'files';
export type ToastKind = 'info' | 'warn' | 'error' | 'success';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'value'; id: string }
  | { kind: 'edge'; id: string }
  /** A port dot: keeps the graph readable by following its downstream usage. */
  | { kind: 'port'; node: string; port: string }
  | null;

export interface AppState {
  graph: FlowGraph | null;
  userMethods: MethodSpec[];
  notebook?: NotebookInfo;
  viewMode: ViewMode;
  fileGraph: FileGraph | null;
  fileRoot: string;
  selectedFile: string | null;
  filesLoading: boolean;
  fileName: string;
  filePath: string;
  documentUri: string;
  pythonVersion?: string;
  entryName: string;
  selected: Selection;
  viewport: Viewport;
  rightCollapsed: boolean;
  rightTab: RightTab;
  libraryTab: LibraryTab;
  query: string;
  dirty: boolean;
  syncing: boolean;
  applying: boolean;
  error: { message: string; kind?: string } | null;
  toasts: ToastItem[];
  past: FlowGraph[];
  future: FlowGraph[];
  fitSignal: number;
  layoutSignal: number;
  orientation: FlowOrientation;
  orientationMode: 'auto' | 'manual';
  demo: boolean;
  applyOpen: boolean;
  helpOpen: boolean;
  menuOpen: boolean;
  parsedOnce: boolean;
  cursorLine?: number;
  lastHistoryKey?: string;
  lastHistoryAt: number;
}

export function initialState(): AppState {
  return {
    graph: null,
    userMethods: [],
    notebook: undefined,
    viewMode: 'flow',
    fileGraph: null,
    fileRoot: '',
    selectedFile: null,
    filesLoading: false,
    fileName: '未打开文件',
    filePath: '',
    documentUri: '',
    entryName: '',
    selected: null,
    viewport: { x: 80, y: 80, zoom: 1 },
    rightCollapsed: false,
    rightTab: 'params',
    libraryTab: 'all',
    query: '',
    dirty: false,
    syncing: false,
    applying: false,
    error: null,
    toasts: [],
    past: [],
    future: [],
    fitSignal: 0,
    layoutSignal: 0,
    orientation: 'horizontal',
    orientationMode: 'auto',
    demo: false,
    applyOpen: false,
    helpOpen: false,
    menuOpen: false,
    parsedOnce: false,
    lastHistoryAt: 0,
  };
}

let toastSeq = 0;
function toast(state: AppState, kind: ToastKind, message: string): ToastItem[] {
  toastSeq += 1;
  return [...state.toasts, { id: `t${toastSeq}`, kind, message }].slice(-4);
}

export type Action =
  | {
      type: 'loadGraph';
      graph: FlowGraph;
      methods: MethodSpec[];
      fileName: string;
      filePath: string;
      documentUri: string;
      pythonVersion?: string;
      fit: boolean;
      demo?: boolean;
      notebook?: NotebookInfo;
    }
  | { type: 'loadDemo' }
  | { type: 'addUserMethod'; method: MethodSpec }
  | { type: 'viewMode'; mode: ViewMode }
  | { type: 'loadFileGraph'; graph: FileGraph; root: string }
  | { type: 'selectFile'; path: string | null }
  | { type: 'filesLoading'; loading: boolean }
  | { type: 'select'; selection: Selection }
  | { type: 'viewport'; viewport: Viewport }
  | { type: 'toggleRight'; collapsed?: boolean }
  | { type: 'rightTab'; tab: RightTab }
  | { type: 'libraryTab'; tab: LibraryTab }
  | { type: 'query'; query: string }
  | { type: 'mutate'; mutate: (graph: FlowGraph) => void; history?: boolean; historyKey?: string }
  | { type: 'pushHistory'; snapshot: FlowGraph }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'toast'; kind: ToastKind; message: string }
  | { type: 'dismissToast'; id: string }
  | { type: 'parseStart' }
  | { type: 'parseEnd' }
  | { type: 'error'; message: string; kind?: string }
  | { type: 'dirty'; dirty: boolean }
  | { type: 'fit' }
  | { type: 'reflow'; width: number; height: number; orientation: FlowOrientation }
  | { type: 'orientation'; orientation: FlowOrientation; mode: 'auto' | 'manual' }
  | { type: 'applyOpen'; open: boolean }
  | { type: 'helpOpen'; open: boolean }
  | { type: 'menuOpen'; open: boolean }
  | { type: 'applied' }
  | { type: 'cursor'; line: number }
  | { type: 'setApplying'; applying: boolean }
  | { type: 'entryName'; name: string };

function selectionAlive(graph: FlowGraph, selection: Selection): boolean {
  if (!selection) return true;
  if (selection.kind === 'edge') return graph.edges.some((edge) => edge.id === selection.id);
  if (selection.kind === 'port') {
    const node = graph.nodes.find((item) => item.id === selection.node);
    if (!node) return graph.values.some((item) => item.id === selection.node);
    return [...node.inputs, ...node.outputs].some((port) => port.id === selection.port);
  }
  return [...graph.nodes, ...graph.values].some((item) => item.id === selection.id);
}

function withHistory(state: AppState, next: FlowGraph, historyKey?: string): Pick<AppState, 'past' | 'future' | 'lastHistoryKey' | 'lastHistoryAt'> {
  const now = Date.now();
  const coalesce = Boolean(historyKey) && historyKey === state.lastHistoryKey && now - state.lastHistoryAt < 700;
  return {
    past: coalesce ? state.past : [...state.past, structuredClone(state.graph!)].slice(-80),
    future: [],
    lastHistoryKey: historyKey,
    lastHistoryAt: now,
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'loadGraph':
      return {
        ...state,
        graph: action.graph,
        userMethods: action.methods,
        notebook: action.notebook,
        viewMode: 'flow',
        fileName: action.fileName,
        filePath: action.filePath,
        documentUri: action.documentUri,
        pythonVersion: action.pythonVersion,
        entryName: action.graph.name,
        selected: null,
        dirty: false,
        syncing: false,
        error: null,
        past: [],
        future: [],
        fitSignal: state.fitSignal + (action.fit ? 1 : 0),
        layoutSignal: state.layoutSignal + 1,
        parsedOnce: true,
        applyOpen: false,
        demo: action.demo ?? false,
      };
    case 'addUserMethod':
      return {
        ...state,
        userMethods: [...state.userMethods.filter((method) => method.id !== action.method.id), action.method],
        libraryTab: 'file',
      };
    case 'loadDemo': {
      const methods = demoMethods();
      const graph = enrichGraph(demoGraph(), methods);
      return {
        ...state,
        graph,
        userMethods: methods,
        notebook: undefined,
        viewMode: 'flow',
        fileName: 'demo.py',
        filePath: '',
        documentUri: '',
        pythonVersion: '3.13',
        entryName: 'main',
        selected: { kind: 'node', id: graph.nodes[0]?.id ?? '' },
        dirty: false,
        syncing: false,
        error: null,
        past: [],
        future: [],
        fitSignal: state.fitSignal + 1,
        layoutSignal: state.layoutSignal + 1,
        parsedOnce: true,
        demo: true,
      };
    }
    case 'select':
      return { ...state, selected: action.selection };
    case 'viewMode':
      return { ...state, viewMode: action.mode, selected: null };
    case 'loadFileGraph':
      return {
        ...state,
        fileGraph: action.graph,
        fileRoot: action.root,
        selectedFile: action.graph.nodes[0]?.path ?? null,
        filesLoading: false,
        viewMode: 'files',
        selected: null,
      };
    case 'selectFile':
      return { ...state, selectedFile: action.path };
    case 'filesLoading':
      return { ...state, filesLoading: action.loading };
    case 'viewport':
      return { ...state, viewport: action.viewport };
    case 'toggleRight':
      return { ...state, rightCollapsed: action.collapsed ?? !state.rightCollapsed };
    case 'rightTab':
      return { ...state, rightTab: action.tab, rightCollapsed: false };
    case 'libraryTab':
      return { ...state, libraryTab: action.tab };
    case 'query':
      return { ...state, query: action.query };
    case 'mutate': {
      if (!state.graph) return state;
      const graph = structuredClone(state.graph);
      action.mutate(graph);
      foldSourceValues(graph);
      syncSignature(graph);
      graph.warnings = collectWarnings(graph);
      const history = action.history === false ? {} : withHistory(state, graph, action.historyKey);
      const selectedStillExists = selectionAlive(graph, state.selected);
      return {
        ...state,
        graph,
        ...history,
        dirty: true,
        selected: selectedStillExists ? state.selected : null,
      };
    }
    case 'pushHistory':
      if (!state.graph) return state;
      return {
        ...state,
        past: [...state.past, action.snapshot].slice(-80),
        future: [],
        dirty: true,
      };
    case 'undo': {
      if (!state.graph || !state.past.length) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        graph: previous,
        past: state.past.slice(0, -1),
        future: [structuredClone(state.graph), ...state.future].slice(0, 80),
        dirty: true,
        selected: null,
      };
    }
    case 'redo': {
      if (!state.graph || !state.future.length) return state;
      const next = state.future[0];
      return {
        ...state,
        graph: next,
        past: [...state.past, structuredClone(state.graph)].slice(-80),
        future: state.future.slice(1),
        dirty: true,
        selected: null,
      };
    }
    case 'toast':
      return { ...state, toasts: toast(state, action.kind, action.message) };
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'parseStart':
      return { ...state, syncing: true };
    case 'parseEnd':
      return { ...state, syncing: false };
    case 'error':
      if (!action.message) return { ...state, syncing: false, applying: false, error: null };
      return { ...state, syncing: false, applying: false, error: { message: action.message, kind: action.kind } };
    case 'dirty':
      return { ...state, dirty: action.dirty };
    case 'fit':
      return { ...state, fitSignal: state.fitSignal + 1 };
    case 'reflow': {
      if (!state.graph) return state;
      const graph = structuredClone(state.graph);
      layoutGraph(graph, { width: action.width, height: action.height, orientation: action.orientation });
      return {
        ...state,
        graph,
        orientation: action.orientation,
        fitSignal: state.fitSignal + 1,
      };
    }
    case 'orientation':
      return { ...state, orientation: action.orientation, orientationMode: action.mode };
    case 'applyOpen':
      return { ...state, applyOpen: action.open };
    case 'helpOpen':
      return { ...state, helpOpen: action.open };
    case 'menuOpen':
      return { ...state, menuOpen: action.open };
    case 'applied':
      return {
        ...state,
        dirty: false,
        applying: false,
        applyOpen: false,
        toasts: toast(state, 'success', '已写入编辑器，Ctrl+S 保存文件。'),
      };
    case 'cursor':
      return { ...state, cursorLine: action.line };
    case 'setApplying':
      return { ...state, applying: action.applying };
    case 'entryName':
      return { ...state, entryName: action.name };
    default:
      return state;
  }
}
