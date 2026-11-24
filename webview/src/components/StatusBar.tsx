import type { FileGraph, FlowGraph } from '../../../src/core/types';
import type { GenerateResult } from '../../../src/core/generate';
import { Code, FileCode, Help, PanelRight, Warning } from '../icons';
import type { ViewMode } from '../store';

export function StatusBar({
  graph,
  fileGraph,
  viewMode,
  generated,
  pythonVersion,
  zoom,
  rightCollapsed,
  rightTab,
  demo,
  syncing,
  onWarnings,
  onCode,
  onToggleRight,
  onHelp,
}: {
  graph: FlowGraph | null;
  fileGraph: FileGraph | null;
  viewMode: ViewMode;
  generated: GenerateResult | null;
  pythonVersion?: string;
  zoom: number;
  rightCollapsed: boolean;
  rightTab: 'params' | 'code';
  demo: boolean;
  syncing: boolean;
  onWarnings: () => void;
  onCode: () => void;
  onToggleRight: () => void;
  onHelp: () => void;
}) {
  const filesMode = viewMode === 'files';
  const warnings = filesMode ? fileGraph?.warnings.length ?? 0 : graph?.warnings.length ?? 0;
  return (
    <footer className="statusbar">
      <div className="status-left">
        {filesMode ? (
          fileGraph ? (
            <>
              <span className="status-item"><span className="status-dot blue" />{fileGraph.nodes.length} 个文件</span>
              <span className="status-sep" />
              <span className="status-item">{fileGraph.edges.length} 条 import</span>
              <span className="status-sep" />
              <span className="status-item">{fileGraph.externals.length} 个外部依赖</span>
            </>
          ) : (
            <span className="status-item">正在扫描工作区…</span>
          )
        ) : graph ? (
          <>
            <span className="status-item"><span className="status-dot blue" />{graph.nodes.length} 个方法</span>
            <span className="status-sep" />
            <span className="status-item">{graph.edges.length} 条连线</span>
            <span className="status-sep" />
            <span className="status-item">{graph.values.filter((v) => v.kind === 'input').length} 输入 / {graph.values.filter((v) => v.kind === 'output').length} 输出</span>
            {warnings > 0 && (
              <>
                <span className="status-sep" />
                <button className="status-warn" onClick={onWarnings}>
                  <Warning size={11} /> {warnings} 条提示
                </button>
              </>
            )}
          </>
        ) : (
          <span className="status-item">等待打开 Python 文件…</span>
        )}
        {demo && !filesMode && <span className="status-demo">演示模式 · 不会写回文件</span>}
      </div>
      <div className="status-right">
        {filesMode ? (
          <>
            <span className="status-item status-sync"><span className="status-dot green" />import 图</span>
            <span className="status-sep" />
            <span className="status-item">本地扫描</span>
            <span className="status-sep" />
            <button className="status-btn icon-only" onClick={onHelp} title="帮助">
              <Help size={12} />
            </button>
          </>
        ) : (
          <>
            <span className="status-item status-sync">
              <span className={`status-dot ${syncing ? 'amber pulse' : 'green'}`} />
              {syncing ? '解析中' : generated?.ok ? '代码就绪' : '待解析'}
            </span>
            <span className="status-sep" />
            <span className="status-item">Python {pythonVersion ?? '—'}</span>
            <span className="status-sep" />
            <span className="status-item">{Math.round(zoom * 100)}%</span>
            <button className={`status-btn ${rightTab === 'code' && !rightCollapsed ? 'is-active' : ''}`} onClick={onCode} title="查看生成代码">
              <Code size={12} /> 代码
            </button>
            <button className={`status-btn ${!rightCollapsed ? 'is-active' : ''}`} onClick={onToggleRight} title="参数面板">
              <PanelRight size={12} /> 参数
            </button>
            <button className="status-btn icon-only" onClick={onHelp} title="帮助">
              <Help size={12} />
            </button>
          </>
        )}
      </div>
    </footer>
  );
}
