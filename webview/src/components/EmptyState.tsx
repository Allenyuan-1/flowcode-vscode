import { Plus, Refresh, Sparkles } from '../icons';

export function EmptyState({ onAddSample, onRefresh }: { onAddSample: () => void; onRefresh: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-art" aria-hidden="true">
        <svg viewBox="0 0 360 150" fill="none">
          <defs>
            <linearGradient id="empty-node" x1="0" y1="0" x2="1" y2="1">
              <stop stopColor="var(--fc-accent)" stopOpacity="0.22" />
              <stop offset="1" stopColor="var(--fc-accent-2)" stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <rect x="10" y="48" width="64" height="30" rx="9" fill="var(--fc-panel-2)" stroke="var(--fc-border-strong)" />
          <text x="42" y="67" textAnchor="middle" fill="var(--fc-muted)" fontSize="11" fontFamily="var(--fc-mono)">a</text>
          <rect x="10" y="86" width="64" height="30" rx="9" fill="var(--fc-panel-2)" stroke="var(--fc-border-strong)" />
          <text x="42" y="105" textAnchor="middle" fill="var(--fc-muted)" fontSize="11" fontFamily="var(--fc-mono)">b</text>
          <path d="M74 63 C 104 63, 112 78, 138 78" stroke="var(--fc-type-number)" strokeWidth="1.6" />
          <path d="M74 101 C 104 101, 112 86, 138 86" stroke="var(--fc-type-number)" strokeWidth="1.6" />
          <rect x="138" y="44" width="98" height="72" rx="13" fill="url(#empty-node)" stroke="var(--fc-accent)" strokeOpacity="0.5" />
          <text x="187" y="76" textAnchor="middle" fill="var(--fc-text)" fontSize="15" fontWeight="650" fontFamily="var(--fc-mono)">add</text>
          <text x="187" y="94" textAnchor="middle" fill="var(--fc-muted)" fontSize="9.5">加和 a、b 为 c</text>
          <path d="M236 80 C 270 80, 278 80, 306 80" stroke="var(--fc-type-number)" strokeWidth="1.6" />
          <rect x="306" y="65" width="44" height="30" rx="9" fill="var(--fc-panel-2)" stroke="var(--fc-border-strong)" />
          <text x="328" y="84" textAnchor="middle" fill="var(--fc-text)" fontSize="11" fontFamily="var(--fc-mono)">c</text>
          <circle cx="74" cy="63" r="3.4" fill="var(--fc-type-number)" />
          <circle cx="74" cy="101" r="3.4" fill="var(--fc-type-number)" />
          <circle cx="306" cy="80" r="3.4" fill="var(--fc-type-number)" />
        </svg>
      </div>
      <h1>把程序逻辑摆到画布上</h1>
      <p>
        方法就是积木，参数就是接口。把左侧方法拖进画布，再从输出端口拉一条线到下一个方法的输入端口。
      </p>
      <div className="empty-steps">
        <span><b>1</b> 拖入方法</span>
        <span><b>2</b> 连接参数</span>
        <span><b>3</b> 写回代码</span>
      </div>
      <div className="empty-actions">
        <button className="btn primary" onClick={onAddSample}>
          <Plus size={15} /> 放一个 add 试试
        </button>
        <button className="btn" onClick={onRefresh}>
          <Refresh size={14} /> 重新解析代码
        </button>
      </div>
      <div className="empty-tip">
        <Sparkles size={13} />
        也可以直接在右侧代码页签查看自动生成的 Python
      </div>
    </div>
  );
}
