import { useState, useEffect } from 'react';
import { listCustom, setCustom, deleteCustom } from '../api';
import type { RequestRecord, ChatCompletionResponse } from '../types';

interface Props {
  hash: string;
  currentRecord: RequestRecord | null;
  onClose: () => void;
  toast: (msg: string, ok?: boolean) => void;
}

export function CustomEditor({ hash, currentRecord, onClose, toast }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = await listCustom();
      if (cancelled) return;
      const existing = map[hash];
      if (existing) {
        setText(JSON.stringify(existing, null, 2));
      } else if (currentRecord?.response) {
        setText(JSON.stringify(currentRecord.response, null, 2));
      } else {
        setText(JSON.stringify({
          id: 'chatcmpl-mock', object: 'chat.completion', created: Math.floor(Date.now() / 1000),
          model: currentRecord?.body?.model || 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: '在此编辑' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }, null, 2));
      }
    })();
    return () => { cancelled = true; };
  }, [hash, currentRecord]);

  async function save() {
    try {
      const parsed: ChatCompletionResponse = JSON.parse(text);
      await setCustom(hash, parsed);
      toast('已保存自定义响应');
      onClose();
    } catch (e) {
      toast('JSON 解析失败: ' + (e instanceof Error ? e.message : String(e)), false);
    }
  }

  async function del() {
    try {
      await deleteCustom(hash);
      toast('已删除');
      onClose();
    } catch (e) {
      toast('删除失败: ' + (e instanceof Error ? e.message : String(e)), false);
    }
  }

  function fillFromResponse() {
    if (currentRecord?.response) setText(JSON.stringify(currentRecord.response, null, 2));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>自定义响应 <span style={{ color: 'var(--yellow)', fontFamily: 'monospace' }}>{hash}</span></h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 8 }}>
          相同 hash 的后续请求会直接返回这里设置的响应（优先级最高）。
        </p>
        <textarea className="editor" value={text} onChange={e => setText(e.target.value)} />
        <div className="actions">
          <button onClick={fillFromResponse}>用当前响应填充</button>
          <button className="danger" onClick={del}>删除自定义</button>
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  );
}
