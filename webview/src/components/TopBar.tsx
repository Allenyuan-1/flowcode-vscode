import type { MethodSpec } from '../../../src/core/types';
import type { FlowOrientation } from '../../../src/core/layout';
import type { NotebookInfo } from '../messages';
import type { ViewMode } from '../store';
import {
  ArrowDownToLine, ChevronDown, Code, Download, FileCode, Fit, Help, Layout, Logo, More,
  Refresh, Settings, Undo, Redo, Upload,
} from '../icons';

interface Props {
  fileName: string;
  filePath: string;
  entryName: string;
  entryKind: 'function' | 'module';
  methods: MethodSpec[];
  notebook?: NotebookInfo;
  viewMode: ViewMode;
  orientation: FlowOrientation;
  orientationMode: 'auto' | 'manual';
  dirty: boolean;
  syncing: boolean;
  demo: boolean;
  rightCollapsed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  menuOpen: boolean;
  onEntry: (name: string) => void;
  onCell: (cell: number) => void;
  onViewMode: (mode: ViewMode) => void;
  onOrientation: (mode: 'auto' | 'horizontal' | 'vertical') => void;
  onRefresh: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onLayout: () => void;
  onFit: () => void;
  onApply: () => void;
  onToggleRight: () => void;
  onExport: () => void;
  onImport: () => void;
  onHelp: () => void;
  onMenu: (open: boolean) => void;
  onSettings: () => void;
}

export function TopBar(props: Props) {
  const entries = props.methods.filter((m) => m.origin === 'user' && (m.qualifiedName ?? m.name) === m.name);
  const hasEntry = entries.some((m) => m.name === props.entryName);
  const filesMode = props.viewMode === 'files';
  return (
    <header className="topbar">
      <div className="brand">
        <Logo size={26} />
        <div className="brand-text">
          <span className="brand-name">FlowCode</span>
          <span className="brand-sub">可视化程序逻辑</span>
        </div>
      </div>

      <div className="crumbs">
        <span className="file-name" title={props.filePath || props.fileName}>
          {props.fileName}
        </span>
        <span className="crumb-slash">/</span>
        {filesMode ? (
          <span className="entry-static">文件关系</span>
        ) : props.notebook ? (
          <label className="entry-select-wrap" title="选择要展示的 Cell">
            <select
              className="entry-select"
              value={props.notebook.mode === 'all' ? -1 : props.notebook.activeCell}
              onChange={(event) => props.onCell(Number(event.target.value))}
            >
              <option value={-1}>全部 Cell（{props.notebook.count}）</option>
              {Array.from({ length: props.notebook.count }, (_, index) => (
                <option key={index} value={index}>Cell {index + 1}</option>
              ))}
            </select>
            <ChevronDown size={12} className="select-chevron" />
          </label>
        ) : props.entryKind === 'function' ? (
          <label className="entry-select-wrap" title="选择要展示的函数">
            <select
              className="entry-select"
              value={props.entryName}
              onChange={(event) => props.onEntry(event.target.value)}
            >
              {!hasEntry && <option value={props.entryName}>{props.entryName}()</option>}
              {entries.map((method) => (
                <option key={method.id} value={method.name}>
                  {method.name}()
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="select-chevron" />
          </label>
        ) : (
          <span className="entry-static">模块级</span>
        )}
        <span className="lang-badge">{props.notebook ? 'Jupyter' : 'Python'}</span>
        {props.demo && <span className="demo-badge">演示</span>}
      </div>

      <div className="top-actions">
        <button
          className={`view-toggle ${filesMode ? 'is-files' : ''}`}
          onClick={() => props.onViewMode(filesMode ? 'flow' : 'files')}
          title={filesMode ? '返回数据流' : '查看文件 import 关系'}
        >
          {filesMode ? <Code size={14} /> : <FileCode size={14} />}
          <span>{filesMode ? '流程图' : '文件关系'}</span>
        </button>
        {!filesMode && (
          <div className="orientation-toggle" role="group" aria-label="流程图方向">
            <button
              className={props.orientationMode === 'auto' ? 'is-active' : ''}
              onClick={() => props.onOrientation('auto')}
              title="根据窗口宽高自动选择"
            >自动</button>
            <button
              className={props.orientationMode === 'manual' && props.orientation === 'horizontal' ? 'is-active' : ''}
              onClick={() => props.onOrientation('horizontal')}
              title="从左到右；输入在左，输出在右"
            >横</button>
            <button
              className={props.orientationMode === 'manual' && props.orientation === 'vertical' ? 'is-active' : ''}
              onClick={() => props.onOrientation('vertical')}
              title="从上到下；输入在上，输出在下"
            >竖</button>
          </div>
        )}
        <div className={`sync-pill ${props.dirty ? 'is-dirty' : 'is-clean'}`} title={props.dirty ? '流程图有未写回代码的修改' : '流程图与代码一致'}>
          <span className="sync-dot" />
          {props.dirty ? '未应用' : '已同步'}
        </div>
        <div className="icon-group">
          <button className="icon-btn" title="撤销 (Ctrl+Z)" onClick={props.onUndo} disabled={!props.canUndo || filesMode}>
            <Undo size={15} />
          </button>
          <button className="icon-btn" title="重做 (Ctrl+Shift+Z)" onClick={props.onRedo} disabled={!props.canRedo || filesMode}>
            <Redo size={15} />
          </button>
        </div>
        <div className="icon-group">
          <button className={`icon-btn ${props.syncing ? 'spinning' : ''}`} title="从代码重新解析" onClick={props.onRefresh} disabled={props.syncing || filesMode}>
            <Refresh size={15} />
          </button>
          <button className="icon-btn" title="自动布局" onClick={props.onLayout} disabled={filesMode}>
            <Layout size={15} />
          </button>
          <button className="icon-btn" title="适应窗口 (F)" onClick={props.onFit}>
            <Fit size={15} />
          </button>
        </div>
        <button className="apply-btn" onClick={props.onApply} title="把流程图转换成 Python 并写回编辑器" disabled={filesMode}>
          <ArrowDownToLine size={15} />
          <span>应用到代码</span>
        </button>
        <button
          className={`icon-btn ${props.rightCollapsed ? 'is-active' : ''}`}
          title={props.rightCollapsed ? '展开参数面板' : '收起参数面板'}
          onClick={props.onToggleRight}
        >
          <Code size={15} />
        </button>
        <div className="menu-anchor">
          <button className={`icon-btn ${props.menuOpen ? 'is-active' : ''}`} title="更多" onClick={() => props.onMenu(!props.menuOpen)}>
            <More size={16} />
          </button>
          {props.menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => props.onMenu(false)} />
              <div className="menu" role="menu">
                <button className="menu-item" onClick={() => { props.onMenu(false); props.onExport(); }}>
                  <Download size={14} /> 导出流程图 JSON
                </button>
                <button className="menu-item" onClick={() => { props.onMenu(false); props.onImport(); }}>
                  <Upload size={14} /> 导入流程图 JSON
                </button>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { props.onMenu(false); props.onHelp(); }}>
                  <Help size={14} /> 快捷键与帮助
                </button>
                <button className="menu-item" onClick={() => { props.onMenu(false); props.onSettings(); }}>
                  <Settings size={14} /> 插件设置
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
