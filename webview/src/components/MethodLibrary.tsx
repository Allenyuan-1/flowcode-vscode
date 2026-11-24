import { useMemo, useState } from 'react';
import { CATEGORY_ORDER, categoryColor } from '../../../src/core/registry';
import type { MethodSpec } from '../../../src/core/types';
import { ChevronDown, Plus, Search, Sparkles } from '../icons';
import { kindLabel, methodGlyph } from '../utils';
import type { LibraryTab } from '../store';

interface Props {
  methods: MethodSpec[];
  tab: LibraryTab;
  query: string;
  onTab: (tab: LibraryTab) => void;
  onQuery: (query: string) => void;
  onAdd: (method: MethodSpec) => void;
  onStudio: () => void;
}

export function MethodLibrary({ methods, tab, query, onTab, onQuery, onAdd, onStudio }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const fileCount = methods.filter((m) => m.origin === 'user').length;
  const all = useMemo(() => {
    const filtered = methods.filter((m) => {
      if (tab === 'builtin' && m.origin !== 'builtin') return false;
      if (tab === 'file' && m.origin !== 'user') return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        (m.qualifiedName ?? '').toLowerCase().includes(q) ||
        m.signature.toLowerCase().includes(q) ||
        m.effect.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
      );
    });
    const groups = new Map<string, MethodSpec[]>();
    for (const method of filtered) {
      if (!groups.has(method.category)) groups.set(method.category, []);
      groups.get(method.category)!.push(method);
    }
    return [...groups.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [methods, tab, query]);

  const total = all.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <aside className="library">
      <div className="library-head">
        <div className="library-title">
          <span>方法库</span>
          <span className="count-badge">{methods.length}</span>
        </div>
        <div className="library-sub">拖入画布，像积木一样组合</div>
      </div>

      <button className="studio-launch" onClick={onStudio}>
        <Sparkles size={14} />
        <span>方法工作室</span>
        <span className="studio-launch-sub">API · AI</span>
      </button>

      <div className="search-box">
        <Search size={14} className="search-icon" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="搜索方法、参数或效果…"
          spellCheck={false}
          aria-label="搜索方法"
        />
        {query && (
          <button className="search-clear" onClick={() => onQuery('')} aria-label="清空搜索">
            ×
          </button>
        )}
      </div>

      <div className="segmented" role="tablist" aria-label="方法来源">
        <button className={tab === 'all' ? 'active' : ''} onClick={() => onTab('all')} role="tab">
          全部<span>{methods.length}</span>
        </button>
        <button className={tab === 'builtin' ? 'active' : ''} onClick={() => onTab('builtin')} role="tab">
          内置<span>{methods.length - fileCount}</span>
        </button>
        <button className={tab === 'file' ? 'active' : ''} onClick={() => onTab('file')} role="tab">
          当前文件<span>{fileCount}</span>
        </button>
      </div>

      <div className="library-list">
        {total === 0 && (
          <div className="library-empty">
            <Search size={22} />
            <p>{query ? '没有匹配的方法' : '当前文件里还没有函数'}</p>
            <span>{query ? '换一个关键词试试' : '在 Python 文件里写一个 def，刷新后即可拖入'}</span>
          </div>
        )}
        {all.map(([category, list]) => {
          const isCollapsed = Boolean(collapsed[category]) && !query;
          return (
            <section className="method-group" key={category}>
              <button className="group-head" onClick={() => setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}>
                <span className="group-dot" style={{ background: categoryColor(category) }} />
                <span className="group-name">{category}</span>
                <span className="group-count">{list.length}</span>
                <ChevronDown size={12} className={`group-chevron ${isCollapsed ? 'collapsed' : ''}`} />
              </button>
              {!isCollapsed && (
                <div className="group-items">
                  {list.map((method) => (
                    <div
                      key={method.id}
                      className={`method-card ${method.origin === 'user' ? 'is-user' : ''}`}
                      style={{ ['--cat-color' as string]: categoryColor(category) }}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData('application/x-flowcode-method', method.id);
                        event.dataTransfer.setData('text/plain', method.id);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      onDoubleClick={() => onAdd(method)}
                      title={`${method.signature}\n${method.effect}`}
                    >
                      <div className="method-card-top">
                        <span className="method-glyph">{methodGlyph(method)}</span>
                        <span className="method-name">{method.name}</span>
                        <span className="method-kind">{kindLabel(method)}</span>
                        <button
                          className="method-add"
                          onClick={(event) => {
                            event.stopPropagation();
                            onAdd(method);
                          }}
                          title="添加到画布"
                          aria-label={`添加 ${method.name}`}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                      <div className="method-sig">{method.signature}</div>
                      <div className="method-effect">{method.effect}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="library-foot">
        <Sparkles size={13} />
        <span>拖入画布会复制一个实例；点击 <b>+</b> 放到中央</span>
      </div>
    </aside>
  );
}
