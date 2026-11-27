import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlowGraph } from '../../../src/core/types';
import { blockSubGraph, segmentMembers } from '../../../src/core/merge';
import { describeSegment } from '../../../src/core/describe';
import { generatePython } from '../../../src/core/generate';
import { isVsCode, post, subscribe } from '../host';
import { ExternalLink, Sparkles, Trash } from '../icons';
import type { HostToWebview } from '../messages';

interface Props {
  /** The ORIGINAL (structure) graph: segments and their member nodes live here. */
  graph: FlowGraph;
  /** Selected block node id (`blk:<segmentId>`). */
  selectedId: string;
  /** Jump back to the structure view and reveal the member. */
  onLocate: (nodeId: string, line?: number) => void;
  /** Remove one member node from the block. */
  onDeleteMember: (nodeId: string) => void;
  /** Remove the whole block (all members). */
  onDeleteBlock: () => void;
  /** Apply an AI-adjusted replacement graph for the block's members. */
  onSplice: (replacement: FlowGraph) => void;
}

/**
 * 「按功能合并」块面板：点块下钻成员，成员可删除、整块可删除，还能用
 * AI 调整——把块的代码和你的要求发给 AI，返回的新代码解析后替换块内
 * 成员（边界按端口名重新接线），再「应用到代码」写回源码。
 */
export function MergedBlockPanel({ graph, selectedId, onLocate, onDeleteMember, onDeleteBlock, onSplice }: Props) {
  const segment = useMemo(() => {
    const segmentId = selectedId.startsWith('blk:') ? selectedId.slice(4) : '';
    return (graph.segments ?? []).find((item) => item.id === segmentId) ?? null;
  }, [graph, selectedId]);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState('');
  const [adjustPreview, setAdjustPreview] = useState('');
  const [tab, setTab] = useState<'members' | 'code'>('members');
  const [source, setSource] = useState('');
  const [sourceError, setSourceError] = useState('');
  // stable ref so the host-message subscription always sees the current
  // dialog state (a plain object recreated per render would go stale in
  // the effect closure)
  const adjustRef = useRef({ open: false, busy: false });
  adjustRef.current.open = adjustOpen;
  adjustRef.current.busy = adjusting;

  // AI adjustment round trip: studioGenerate -> studioResult -> parseSnippet -> splice
  useEffect(() => {
    const unsubscribe = subscribe((message: HostToWebview) => {
      if (message.type === 'sourceLines') {
        setSource(message.text);
        if (message.error) setSourceError(message.error);
        return;
      }
      if (message.type === 'studioResult') {
        if (!adjustRef.current.open) return;
        const code = message.draft?.code;
        if (code) {
          setAdjustPreview(code);
          if (isVsCode) post({ type: 'parseSnippet', code });
        } else {
          setAdjusting(false);
          setAdjustError(message.error ?? 'AI 没有返回代码');
        }
        return;
      }
      if (message.type === 'snippetParsed') {
        if (!adjustRef.current.open || !adjustRef.current.busy) return;
        if (message.graph) {
          setAdjusting(false);
          setAdjustOpen(false);
          setAdjustError('');
          onSplice(message.graph);
        } else {
          setAdjusting(false);
          setAdjustError(message.error ?? '解析失败');
        }
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSplice]);

  if (!segment) return null;
  const members = segmentMembers(graph, segment);
  // 从代码本身推导的语义描述（无需 AI）：将 xx 通过 xx 算法转化为 xx，适用于 xx；限制
  const note = useMemo(() => describeSegment(graph, segment), [graph, segment]);
  const blockCode = useMemo(() => {
    try {
      return generatePython(blockSubGraph(graph, segment)).code ?? '';
    } catch {
      return '';
    }
  }, [graph, segment]);

  // fall the block back to the real source lines of the current document
  useEffect(() => {
    setSource('');
    setSourceError('');
    setTab('members');
    if (segment.startLine > 0 && isVsCode) {
      post({ type: 'sourceLines', start: segment.startLine, end: segment.endLine });
    }
  }, [segment.id, segment.startLine, segment.endLine]);

  const runAdjust = () => {
    setAdjustError('');
    setAdjustPreview('');
    setAdjusting(true);
    post({
      type: 'studioGenerate',
      requirements: `调整这段代码。要求：${requirement || '保持行为不变，改进实现'}\n代码块名：${segment.label}`,
      code: blockCode,
    });
  };

  return (
    <>
      <aside className="merged-panel" aria-label="块成员">
        <header className="merged-panel-head">
          <b>{segment.label}</b>
          <span>{segment.size} 个成员 · L{segment.startLine}–{segment.endLine}</span>
          <div className="merged-panel-actions">
            <button
              type="button"
              className="merged-panel-btn"
              title="让 AI 调整这个块的实现（返回的新代码替换块内成员）"
              onClick={() => { setAdjustOpen(true); setRequirement(''); setAdjustError(''); }}
            >
              <Sparkles size={12} /> AI 调整
            </button>
            <button
              type="button"
              className="merged-panel-btn danger"
              title="删除整块（块内所有方法节点）"
              onClick={onDeleteBlock}
            >
              <Trash size={12} />
            </button>
          </div>
        </header>
        {note && (
          <div className="merged-panel-note" title={note.full}>
            <b>语义</b>
            <span>{note.full}</span>
          </div>
        )}
        <div className="merged-panel-tabs">
          <button type="button" className={tab === 'members' ? 'is-on' : ''} onClick={() => setTab('members')}>
            成员（{members.length}）
          </button>
          <button type="button" className={tab === 'code' ? 'is-on' : ''} onClick={() => setTab('code')}>
            代码
          </button>
        </div>
        {tab === 'members' ? (
          <div className="merged-panel-list">
            {members.map((node) => {
              const line = node.sourceRange?.start.line;
              return (
                <div className="merged-panel-row" key={node.id}>
                  <button
                    type="button"
                    className="merged-panel-locate"
                    title={line !== undefined ? `回到结构视图并定位第 ${line} 行` : '回到结构视图并选中'}
                    onClick={() => onLocate(node.id, line)}
                  >
                    <span className="merged-panel-line">{line ?? '—'}</span>
                    <span className="merged-panel-name">{node.name}</span>
                    <span className="merged-panel-effect">{node.effect}</span>
                  </button>
                  <button
                    type="button"
                    className="merged-panel-del"
                    title={`从块中删除 ${node.name}`}
                    onClick={() => onDeleteMember(node.id)}
                  >
                    <Trash size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <pre className="merged-panel-code">
            {sourceError ? `无法读取源码：${sourceError}` : source || blockCode || '（该块没有可回落的代码）'}
          </pre>
        )}
        <footer className="merged-panel-foot">点成员 → 回结构视图选中 · 代码页回落真实源码 · 删除与 AI 调整即时生效</footer>
      </aside>

      {adjustOpen && (
        <div className="merged-adjust-backdrop" onClick={() => !adjusting && setAdjustOpen(false)}>
          <div className="merged-adjust" onClick={(event) => event.stopPropagation()}>
            <header className="merged-adjust-head">
              <b>AI 调整 · {segment.label}</b>
              <button type="button" className="icon-btn" onClick={() => setAdjustOpen(false)} title="关闭">×</button>
            </header>
            <label className="merged-adjust-label">调整要求（留空 = 保持行为不变，改进实现）</label>
            <textarea
              className="merged-adjust-req"
              value={requirement}
              onChange={(event) => setRequirement(event.target.value)}
              placeholder="例如：改成向量化实现；修复可能的除零；把循环换成列表推导…"
              rows={2}
            />
            <label className="merged-adjust-label">当前代码（AI 上下文）</label>
            <pre className="merged-adjust-code">{blockCode || '（该块没有可生成的代码）'}</pre>
            {adjustPreview && (
              <>
                <label className="merged-adjust-label">AI 返回的新代码</label>
                <pre className="merged-adjust-code new">{adjustPreview}</pre>
              </>
            )}
            {adjustError && <div className="merged-adjust-error">{adjustError}</div>}
            <div className="merged-adjust-foot">
              <button type="button" className="btn ghost" onClick={() => setAdjustOpen(false)} disabled={adjusting}>
                取消
              </button>
              <button type="button" className="btn primary" onClick={runAdjust} disabled={adjusting || !isVsCode}>
                <Sparkles size={13} /> {adjusting ? '调整中…' : 'AI 调整'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
