import { useEffect, useMemo, useState } from 'react';
import type { FlowGraph, MethodSpec, PortType } from '../../../src/core/types';
import {
  localStudioDraft, parseSignatureFromCode, pythonType, STUDIO_TYPES, syncSignatureInCode,
} from '../../../src/core/studio';
import type { StudioDraft, StudioInput, StudioOutput } from '../../../src/core/studio';
import { isVsCode, post, subscribe } from '../host';
import { Check, Plus, Sparkles, Trash, X } from '../icons';
import type { HostToWebview } from '../messages';

interface Props {
  graph: FlowGraph;
  onClose: () => void;
  onComplete: (draft: StudioDraft) => void;
}

function nextId(): string {
  return `studio_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function MethodStudio({ onClose, onComplete }: Props) {
  const [requirements, setRequirements] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [source, setSource] = useState<'ai' | 'local'>('local');
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<StudioDraft>(() => localStudioDraft(''));
  const [name, setName] = useState(draft.name);
  const [effect, setEffect] = useState(draft.effect);
  const [description, setDescription] = useState(draft.description);
  const [code, setCode] = useState(draft.code);
  const [inputs, setInputs] = useState<StudioInput[]>(draft.inputs);
  const [outputs, setOutputs] = useState<StudioOutput[]>(draft.outputs);

  const apply = (next: StudioDraft) => {
    setDraft(next);
    setName(next.name);
    setEffect(next.effect);
    setDescription(next.description);
    setCode(next.code);
    setInputs(next.inputs);
    setOutputs(next.outputs);
  };

  useEffect(() => {
    const unsubscribe = subscribe((message: HostToWebview) => {
      if (message.type === 'studioKeyStatus') {
        setHasKey(message.hasKey);
        if (message.hasKey) setApiKey('');
      }
      if (message.type === 'studioResult') {
        apply(message.draft);
        setSource(message.source);
        setError(message.error ?? '');
        setGenerating(false);
      }
    });
    if (isVsCode) post({ type: 'studioKeyStatus' });
    return unsubscribe;
  }, []);

  const syncCode = (nextName: string, nextInputs: StudioInput[], nextOutputs: StudioOutput[]) => {
    setCode((current) => syncSignatureInCode(current, nextName, nextInputs, nextOutputs));
  };

  const changeName = (value: string) => {
    setName(value);
    syncCode(value, inputs, outputs);
  };

  const changeInput = (index: number, patch: Partial<StudioInput>) => {
    const next = inputs.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setInputs(next);
    syncCode(name, next, outputs);
  };

  const changeOutput = (index: number, patch: Partial<StudioOutput>) => {
    const next = outputs.map((item, i) => (i === index ? { ...item, ...patch } : item));
    setOutputs(next);
    syncCode(name, inputs, next);
  };

  const addInput = () => {
    const next = [...inputs, { name: `arg${inputs.length + 1}`, type: 'any' as PortType }];
    setInputs(next);
    syncCode(name, next, outputs);
  };

  const removeInput = (index: number) => {
    const next = inputs.filter((_, i) => i !== index);
    setInputs(next);
    syncCode(name, next, outputs);
  };

  const addOutput = () => {
    const next = [...outputs, { name: outputs.length ? `out${outputs.length + 1}` : 'result', type: 'any' as PortType }];
    setOutputs(next);
    syncCode(name, inputs, next);
  };

  const removeOutput = (index: number) => {
    if (outputs.length <= 1) return;
    const next = outputs.filter((_, i) => i !== index);
    setOutputs(next);
    syncCode(name, inputs, next);
  };

  const changeCode = (value: string) => {
    setCode(value);
    const parsed = parseSignatureFromCode(value);
    if (!parsed) return;
    setName(parsed.name);
    setInputs(parsed.inputs);
    setOutputs(parsed.outputs);
  };

  const saveApiKey = () => {
    if (!isVsCode || !apiKey.trim()) return;
    post({ type: 'studioSaveKey', key: apiKey.trim() });
    setApiKey('');
    setHasKey(true);
    setError('');
  };

  const generate = () => {
    setError('');
    if (!isVsCode) {
      apply(localStudioDraft(requirements, code));
      setSource('local');
      return;
    }
    if (apiKey.trim()) {
      post({ type: 'studioSaveKey', key: apiKey.trim() });
      setHasKey(true);
    }
    setGenerating(true);
    post({
      type: 'studioGenerate',
      requirements,
      code,
      apiKey: apiKey.trim() || undefined,
    });
    setApiKey('');
  };

  const complete = () => {
    const finalName = name.trim() || 'new_method';
    const finalInputs = inputs.filter((input) => input.name.trim());
    const finalOutputs = outputs.filter((output) => output.name.trim());
    const finalCode = syncSignatureInCode(code, finalName, finalInputs, finalOutputs);
    onComplete({
      name: finalName,
      effect: effect.trim() || '由方法工作室创建',
      description: description.trim() || effect.trim(),
      code: finalCode,
      inputs: finalInputs.length ? finalInputs : [{ name: 'arg1', type: 'any' }],
      outputs: finalOutputs.length ? finalOutputs : [{ name: 'result', type: 'any' }],
    });
  };

  const signature = useMemo(() => {
    const params = inputs.map((input) => `${input.name}: ${pythonType(input.type)}`).join(', ');
    return `${name || 'new_method'}(${params}) -> ${pythonType(outputs[0]?.type ?? 'any')}`;
  }, [inputs, name, outputs]);

  return (
    <div className="studio-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="studio" role="dialog" aria-modal="true" aria-label="方法工作室">
        <header className="studio-head">
          <div className="studio-title"><Sparkles size={17} /><div><b>方法工作室</b><span>从 API / 需求生成一个可编辑的方法块</span></div></div>
          <button className="icon-btn" onClick={onClose} title="关闭"><X size={15} /></button>
        </header>

        <div className="studio-top">
          <div className="studio-api">
            <label>API Key <span>仅保存在 VS Code 密钥存储</span></label>
            <div className="studio-api-row">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasKey ? '已保存，输入可替换' : '可选：OpenAI 兼容 API Key'}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="mini-btn" onClick={saveApiKey} disabled={!apiKey.trim() || !isVsCode}>保存</button>
              <span className={`studio-key-state ${hasKey ? 'ok' : ''}`}>{hasKey ? '已保密保存' : '未保存'}</span>
            </div>
          </div>
          <div className="studio-requirement">
            <label>方法要求</label>
            <textarea
              value={requirements}
              onChange={(event) => setRequirements(event.target.value)}
              placeholder="例如：输入两个浮点数，返回它们的加权和；权重可配置，默认 0.5；要求类型检查。"
              rows={2}
            />
            <button className="btn primary studio-generate" onClick={generate} disabled={generating}>
              <Sparkles size={13} /> {generating ? '生成中…' : 'AI 生成'}
            </button>
          </div>
        </div>

        <div className="studio-main">
          <section className="studio-params">
            <div className="studio-section-head"><span>输入参数</span><button className="mini-btn" onClick={addInput}><Plus size={11} /> 添加</button></div>
            <div className="studio-param-list">
              {inputs.map((input, index) => (
                <div className="studio-param" key={index}>
                  <input value={input.name} onChange={(event) => changeInput(index, { name: event.target.value })} spellCheck={false} aria-label="输入参数名" />
                  <select value={input.type} onChange={(event) => changeInput(index, { type: event.target.value as PortType })} aria-label="输入参数类型">
                    {STUDIO_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <input className="studio-default" value={input.defaultValue ?? ''} onChange={(event) => changeInput(index, { defaultValue: event.target.value })} placeholder="默认值" spellCheck={false} aria-label="输入默认值" />
                  <button className="studio-remove" onClick={() => removeInput(index)} title="删除输入"><Trash size={11} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="studio-code">
            <div className="studio-section-head"><span>完成后的代码</span><span className="studio-code-hint">可编辑；签名与参数同步</span></div>
            <textarea
              value={code}
              onChange={(event) => changeCode(event.target.value)}
              spellCheck={false}
              wrap="off"
              aria-label="方法代码"
            />
          </section>

          <section className="studio-params">
            <div className="studio-section-head"><span>输出参数</span><button className="mini-btn" onClick={addOutput}><Plus size={11} /> 添加</button></div>
            <div className="studio-param-list">
              {outputs.map((output, index) => (
                <div className="studio-param output" key={index}>
                  <input value={output.name} onChange={(event) => changeOutput(index, { name: event.target.value })} spellCheck={false} aria-label="输出参数名" />
                  <select value={output.type} onChange={(event) => changeOutput(index, { type: event.target.value as PortType })} aria-label="输出参数类型">
                    {STUDIO_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <button className="studio-remove" onClick={() => removeOutput(index)} disabled={outputs.length <= 1} title="删除输出"><Trash size={11} /></button>
                </div>
              ))}
            </div>
          </section>

          <aside className="studio-preview">
            <div className="studio-section-head"><span>方法块预览</span><span className="studio-ai-badge">AI 默认值</span></div>
            <div className="studio-preview-card">
              <div className="studio-preview-title"><span className="studio-preview-glyph">ƒ</span><span>{name || 'new_method'}</span><span className="studio-preview-origin">工作室</span></div>
              <div className="studio-preview-effect">{effect || '方法介绍'}</div>
              <div className="studio-preview-signature">{signature}</div>
              <div className="studio-preview-ports">
                <div>{inputs.map((input) => <span key={input.name} className="studio-preview-port">{input.name}</span>)}</div>
                <span className="studio-preview-arrow">→</span>
                <div>{outputs.map((output) => <span key={output.name} className="studio-preview-port out">{output.name}</span>)}</div>
              </div>
            </div>
            <label className="studio-field">方法介绍<input value={effect} onChange={(event) => setEffect(event.target.value)} /></label>
            <label className="studio-field">详细说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></label>
            <div className={`studio-source ${source}`}>{source === 'ai' ? 'AI 生成' : '本地生成'}{hasKey ? ' · 密钥已保存' : ''}</div>
          </aside>
        </div>

        <footer className="studio-foot">
          <div className="studio-foot-status">
            {error ? <span className="studio-error">{error}</span> : <span>签名：<code>{signature}</code></span>}
          </div>
          <div className="studio-foot-actions">
            <button className="btn ghost" onClick={onClose}>取消</button>
            <button className="btn primary" onClick={complete}><Check size={13} /> 完成并建立方法块</button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function studioMethodSpec(draft: StudioDraft): MethodSpec {
  return {
    id: nextId(),
    name: draft.name,
    qualifiedName: draft.name,
    kind: 'function',
    category: '方法工作室',
    signature: `${draft.name}(${draft.inputs.map((input) => `${input.name}: ${pythonType(input.type)}`).join(', ')})`,
    effect: draft.effect,
    params: draft.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      annotation: pythonType(input.type),
      defaultValue: input.defaultValue,
    })),
    returns: draft.outputs.map((output) => ({
      name: output.name,
      type: output.type,
      annotation: pythonType(output.type),
    })),
    origin: 'user',
    doc: draft.description,
  };
}
