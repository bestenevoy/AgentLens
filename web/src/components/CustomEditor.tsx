import { useState, useEffect } from 'react';
import { listCustom, setCustom, deleteCustom } from '../api';
import type { RequestRecord, ChatCompletionResponse } from '../types';
import { useT } from '../i18n';

interface Props {
  hash: string;
  currentRecord: RequestRecord | null;
  onClose: () => void;
  toast: (msg: string, ok?: boolean) => void;
}

export function CustomEditor({ hash, currentRecord, onClose, toast }: Props) {
  const t = useT();
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
          choices: [{ index: 0, message: { role: 'assistant', content: t('custom.placeholder') }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }, null, 2));
      }
    })();
    return () => { cancelled = true; };
  }, [hash, currentRecord, t]);

  async function save() {
    try {
      const parsed: ChatCompletionResponse = JSON.parse(text);
      await setCustom(hash, parsed);
      toast(t('custom.saved'));
      onClose();
    } catch (e) {
      toast(t('custom.json_fail') + (e instanceof Error ? e.message : String(e)), false);
    }
  }

  async function del() {
    try {
      await deleteCustom(hash);
      toast(t('custom.deleted'));
      onClose();
    } catch (e) {
      toast(t('custom.delete_fail') + (e instanceof Error ? e.message : String(e)), false);
    }
  }

  function fillFromResponse() {
    if (currentRecord?.response) setText(JSON.stringify(currentRecord.response, null, 2));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{t('custom.title')} <span style={{ color: 'var(--yellow)', fontFamily: 'monospace' }}>{hash}</span></h2>
        <p style={{ color: 'var(--text-dim)', fontSize: 12, marginBottom: 8 }}>
          {t('custom.desc')}
        </p>
        <textarea className="editor" value={text} onChange={e => setText(e.target.value)} />
        <div className="actions">
          <button onClick={fillFromResponse}>{t('custom.fill')}</button>
          <button className="danger" onClick={del}>{t('custom.delete')}</button>
          <button onClick={onClose}>{t('custom.cancel')}</button>
          <button className="primary" onClick={save}>{t('settings.save')}</button>
        </div>
      </div>
    </div>
  );
}
