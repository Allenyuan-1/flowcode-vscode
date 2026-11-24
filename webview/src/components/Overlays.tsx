import { useEffect } from 'react';
import type { FlowGraph } from '../../../src/core/types';
import type { GenerateResult } from '../../../src/core/generate';
import { CodeBlock } from './CodeBlock';
import {
  ArrowDownToLine, Check, Copy, Help, Refresh, Settings, Warning, X,
} from '../icons';
import type { ToastItem } from '../store';

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: string) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3800);
    return () => clearTimeout(timer);
  }, [onDismiss]);
  return (
    <div className={`toast toast-${toast.kind}`}>
      <span className="toast-icon">
        {toast.kind === 'success' ? <Check size={13} /> : toast.kind === 'error' || toast.kind === 'warn' ? <Warning size={13} /> : <span className="toast-dot" />}
      </span>
      <span className="toast-text">{toast.message}</span>
      <button className="toast-close" onClick={onDismiss} aria-label="关闭提示">
        <X size={12} />
      </button>
    </div>
  );
}

export function ErrorBanner({
  message,
  kind,
  onClose,
  onSettings,
  onOpenFile,
  onRefresh,
}: {
  message: string;
  kind?: string;
  onClose: () => void;
  onSettings: () => void;
  onOpenFile: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className={`error-banner ${kind === 'syntax' ? 'is-syntax' : ''}`}>
      <Warning size={16} />
      <div className="error-banner-body">
        <div className="error-banner-title">{kind === 'syntax' ? '代码暂时无法解析' : kind === 'missing' ? '还没有连接 Python' : '解析失败'}</div>
        <div className="error-banner-message">{message}</div>
      </div>
      <div className="error-banner-actions">
        {kind === 'missing' ? (
          <>
            <button className="btn small" onClick={onSettings}><Settings size={12} /> 设置解释器</button>
            <button className="btn small" onClick={onOpenFile}>打开文件</button>
          </>
        ) : (
          <button className="btn small" onClick={onRefresh}><Refresh size={12} /> 重试</button>
        )}
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export function ApplyDialog({
  graph,
  generated,
  demo,
  applying,
  onClose,
  onConfirm,
  onCopy,
}: {
  graph: FlowGraph;
  generated: GenerateResult;
  demo: boolean;
  applying: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCopy: (text: string) => void;
}) {
  const controlFlow = graph.warnings.filter((w) => w.code === 'control-flow');
  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal apply-modal" role="dialog" aria-modal="true" aria-label="应用代码">
        <div className="modal-head">
          <div className="modal-title">
            <span className="modal-icon"><ArrowDownToLine size={16} /></span>
            <div>
              <div className="modal-title-text">应用到 Python 代码</div>
              <div className="modal-sub">
                {graph.cells
                  ? graph.cellIndex === -1
                    ? '“全部 Cell”是汇总视图，不能直接写回；请在顶部选择单个 Cell。'
                    : `将替换 Cell ${(graph.cellIndex ?? 0) + 1} 的全部代码。`
                  : graph.entryKind === 'function'
                    ? <>将替换 <code>{graph.name}()</code> 的完整函数体，保留文件里的其他内容。</>
                    : '将替换当前模块级代码。'}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>

        {graph.cells && (
          <div className="modal-warning">
            <Warning size={15} />
            <div>
              <b>这是 Notebook Cell。</b>
              写回会整体替换当前 Cell；FlowCode 会保留顶部 import / 魔法命令和顶层 def/class，但 if/for 控制流会被展开。
            </div>
          </div>
        )}

        {controlFlow.length > 0 && (
          <div className="modal-warning">
            <Warning size={15} />
            <div>
              <b>代码里包含分支或循环。</b>
              当前流程图把控制流展开成了顺序数据流，直接写回会丢失条件结构。建议先复制代码，在编辑器中手动合并。
            </div>
          </div>
        )}

        <div className="modal-code">
          <CodeBlock code={generated.code} showLineNumbers />
        </div>

        {generated.warnings.length > 0 && (
          <div className="modal-warnings">
            {generated.warnings.slice(0, 3).map((warning, index) => (
              <div className="modal-warning-row" key={index}><Warning size={12} /> {warning.message}</div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={() => onCopy(generated.code)}>
            <Copy size={14} /> 复制代码
          </button>
          <div className="modal-actions-right">
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn primary" onClick={onConfirm} disabled={applying}>
              {applying ? <span className="spinner" /> : <ArrowDownToLine size={14} />}
              {demo ? '演示模式：仅预览' : applying ? '正在写入…' : '写入编辑器'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal help-modal" role="dialog" aria-modal="true" aria-label="帮助">
        <div className="modal-head">
          <div className="modal-title">
            <span className="modal-icon"><Help size={16} /></span>
            <div>
              <div className="modal-title-text">FlowCode 使用指南</div>
              <div className="modal-sub">程序逻辑 ↔ 积木流程图，双向转换。</div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={15} />
          </button>
        </div>
        <div className="help-grid">
          <section>
            <h3>搭建</h3>
            <p>左侧方法库列出内置方法与当前文件里的函数。拖到画布，或点 <b>+</b> 放到视图中央。</p>
            <p>每个模块左侧是输入参数，右侧是输出参数。未接线的输入会自动生成参数胶囊；有默认值的参数直接显示默认值。</p>
            <p><b>直接点击参数行</b>可以改参数名、类型和默认值；右侧面板保留完整编辑与删除操作。</p>
            <p><b>Alt / Option + 拖动模块</b> 可以复制一个实例，复制后参数、效果都能独立修改。</p>
          </section>
          <section>
            <h3>连线</h3>
            <p>从输出圆点拖到下一个模块的输入圆点；也可以直接拖动参数胶囊到输入端口。松手在空白处，会创建流程输出。</p>
            <p>点击连线可以删除；拖动模块可以重新布局。滚轮平移，Ctrl/⌘ + 滚轮缩放。</p>
          </section>
          <section>
            <h3>同步</h3>
            <p><b>从代码刷新</b>重新读取当前函数；<b>应用到代码</b>把流程图生成 Python 并替换入口函数。</p>
            <p>宽窗口自动横向排列：按参数依赖分层，独立方法同列、消费者后一列；竖窗口自动纵向排列。调整窗口大小也会重新排版。</p>
          </section>
        </div>
        <div className="shortcut-grid">
          <div><kbd>Ctrl</kbd><kbd>Z</kbd><span>撤销</span></div>
          <div><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd><span>重做</span></div>
          <div><kbd>Delete</kbd><span>删除选中</span></div>
          <div><kbd>F</kbd><span>适应窗口</span></div>
          <div><kbd>Ctrl</kbd><kbd>Enter</kbd><span>预览应用</span></div>
          <div><kbd>Esc</kbd><span>取消 / 关闭</span></div>
        </div>
        <div className="modal-actions">
          <div className="help-note">支持 Python 3.9+；分支与循环会被线性展开并给出提示。</div>
          <button className="btn primary" onClick={onClose}>知道了</button>
        </div>
      </div>
    </div>
  );
}
