import { useEffect, useState } from 'react';
import type { FlowGraph, PortType } from '../../../src/core/types';
import { Check, Settings, X } from '../icons';

export interface ParamEditTarget {
  nodeId: string;
  side: 'in' | 'out';
  index: number;
  anchor: { x: number; y: number };
}

const TYPES: PortType[] = ['number', 'int', 'string', 'boolean', 'list', 'dict', 'any', 'none'];

export function ParamEditor({
  graph,
  target,
  onClose,
  onSave,
}: {
  graph: FlowGraph;
  target: ParamEditTarget | null;
  onClose: () => void;
  onSave: (target: ParamEditTarget, patch: { name: string; type: PortType; defaultValue?: string }) => void;
}) {
  const node = target ? graph.nodes.find((item) => item.id === target.nodeId) : undefined;
  const port = target && node ? (target.side === 'in' ? node.inputs[target.index] : node.outputs[target.index]) : undefined;
  const [name, setName] = useState('');
  const [type, setType] = useState<PortType>('any');
  const [defaultValue, setDefaultValue] = useState('');

  useEffect(() => {
    if (!port) return;
    setName(port.name);
    setType(port.type);
    setDefaultValue(port.defaultValue ?? '');
  }, [port?.id, port?.name, port?.type, port?.defaultValue]);

  if (!target || !node || !port) return null;

  const width = 276;
  const left = Math.min(Math.max(10, target.anchor.x + 10), window.innerWidth - width - 12);
  const top = Math.min(Math.max(10, target.anchor.y - 18), window.innerHeight - 286);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(target, {
      name: trimmed,
      type,
      defaultValue: target.side === 'in' ? defaultValue : undefined,
    });
  };

  return (
    <div className="param-editor-backdrop" onPointerDown={onClose}>
      <form
        className="param-editor"
        style={{ left, top, width }}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="param-editor-head">
          <span className="param-editor-icon"><Settings size={14} /></span>
          <div className="param-editor-title">
            <div>编辑{target.side === 'in' ? '输入' : '输出'}参数</div>
            <div className="param-editor-sub">{node.name} · {target.side === 'in' ? `第 ${target.index + 1} 个输入` : `第 ${target.index + 1} 个输出`}</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭"><X size={14} /></button>
        </div>

        <label className="param-field">
          <span>参数名</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.target.select()}
            autoFocus
            spellCheck={false}
          />
        </label>

        <label className="param-field">
          <span>类型</span>
          <select value={type} onChange={(event) => setType(event.target.value as PortType)}>
            {TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        {target.side === 'in' && (
          <label className="param-field">
            <span>默认值</span>
            <input
              value={defaultValue}
              onChange={(event) => setDefaultValue(event.target.value)}
              placeholder="留空表示没有默认值"
              spellCheck={false}
            />
          </label>
        )}

        <div className="param-editor-hint">点击模块参数行可再次编辑；改动只影响这个模块实例。</div>
        <div className="param-editor-actions">
          <button type="button" className="btn ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}><Check size={13} /> 保存</button>
        </div>
      </form>
    </div>
  );
}
