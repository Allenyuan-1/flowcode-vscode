import { useMemo } from 'react';
import type { FlowGraph } from '../../../src/core/types';
import { segmentMembers } from '../../../src/core/merge';
import { ExternalLink } from '../icons';

interface Props {
  /** The ORIGINAL (structure) graph: segments and their member nodes live here. */
  graph: FlowGraph;
  /** Selected block node id (`blk:<segmentId>`). */
  selectedId: string;
  /** Jump back to the structure view and reveal the member. */
  onLocate: (nodeId: string, line?: number) => void;
}

/**
 * Drill-down for 「按功能合并」: the selected block lists its member methods
 * (line + name + effect). Clicking a member leaves the merged view and
 * selects that node in the structure view, so the merged diagram finally
 * works as a navigator instead of a dead end.
 */
export function MergedBlockPanel({ graph, selectedId, onLocate }: Props) {
  const segment = useMemo(() => {
    const segmentId = selectedId.startsWith('blk:') ? selectedId.slice(4) : '';
    return (graph.segments ?? []).find((item) => item.id === segmentId) ?? null;
  }, [graph, selectedId]);

  if (!segment) return null;
  const members = segmentMembers(graph, segment);
  return (
    <aside className="merged-panel" aria-label="块成员">
      <header className="merged-panel-head">
        <b>{segment.label}</b>
        <span>{segment.size} 个成员 · L{segment.startLine}–{segment.endLine}</span>
      </header>
      <div className="merged-panel-list">
        {members.map((node) => {
          const line = node.sourceRange?.start.line;
          return (
            <button
              type="button"
              key={node.id}
              className="merged-panel-row"
              title={line !== undefined ? `回到结构视图并定位第 ${line} 行` : '回到结构视图并选中'}
              onClick={() => onLocate(node.id, line)}
            >
              <span className="merged-panel-line">{line ?? '—'}</span>
              <span className="merged-panel-name">{node.name}</span>
              <span className="merged-panel-effect">{node.effect}</span>
              <ExternalLink size={11} />
            </button>
          );
        })}
      </div>
      <footer className="merged-panel-foot">点成员 → 回到结构视图并选中该节点</footer>
    </aside>
  );
}
