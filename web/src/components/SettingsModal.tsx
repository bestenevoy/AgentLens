import { useState } from 'react';
import type { ServerConfig, Provider } from '../types';
import { createProvider, updateProvider, deleteProvider, putConfig } from '../api';

interface Props {
  config: ServerConfig;
  onClose: () => void;
  onUpdate: () => void;
  toast: (msg: string, ok?: boolean) => void;
}

export function SettingsModal({ config, onClose, onUpdate, toast }: Props) {
  const [tab, setTab] = useState<'providers' | 'general'>('providers');
  const [editId, setEditId] = useState<string>('');
  const [form, setForm] = useState<Omit<Provider, 'id'>>({
    name: '', base_url: 'https://api.openai.com/v1', api_key: '', override_model: '', passthrough_auth: false,
  });
  const [maxRecords, setMaxRecords] = useState(config.max_records || 50);

  async function saveProvider() {
    if (!form.name) { toast('请填写名称', false); return; }
    try {
      if (editId) {
        await updateProvider(editId, form);
      } else {
        await createProvider(form);
      }
      resetForm();
      onUpdate();
      toast('已保存');
    } catch (e) {
      toast('保存失败', false);
    }
  }

  function editProvider(p: Provider) {
    setEditId(p.id);
    setForm({ name: p.name, base_url: p.base_url, api_key: p.api_key, override_model: p.override_model, passthrough_auth: p.passthrough_auth });
  }

  function resetForm() {
    setEditId('');
    setForm({ name: '', base_url: 'https://api.openai.com/v1', api_key: '', override_model: '', passthrough_auth: false });
  }

  async function delProvider(id: string) {
    if (!confirm('删除此 Provider？')) return;
    await deleteProvider(id);
    onUpdate();
    toast('已删除');
  }

  async function selectProvider(id: string) {
    await putConfig({ mode: config.mode, selected_provider_id: id, max_records: maxRecords });
    onUpdate();
    toast('已切换 Provider');
  }

  async function saveMaxRecords() {
    await putConfig({ mode: config.mode, selected_provider_id: config.selected_provider_id, max_records: maxRecords });
    onUpdate();
    toast('已保存');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>设置</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className={tab === 'providers' ? 'primary' : ''} onClick={() => setTab('providers')}>Provider 管理</button>
          <button className={tab === 'general' ? 'primary' : ''} onClick={() => setTab('general')}>通用设置</button>
        </div>

        {tab === 'providers' && (
          <>
            <div className="provider-list">
              {config.providers.length === 0 ? (
                <div style={{ color: 'var(--text-mute)', padding: 8 }}>暂无 Provider，在下方添加</div>
              ) : config.providers.map(p => (
                <div key={p.id} className={`provider-item ${p.id === config.selected_provider_id ? 'selected' : ''}`}>
                  <span className="name">{p.name}</span>
                  <span className="url">{p.base_url}</span>
                  {p.override_model && <span className="tag">{'->'}{p.override_model}</span>}
                  <div className="actions">
                    <button className="small" onClick={() => selectProvider(p.id)}>选用</button>
                    <button className="small" onClick={() => editProvider(p)}>编辑</button>
                    <button className="small danger" onClick={() => delProvider(p.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
            <fieldset>
              <legend>{editId ? '编辑 Provider' : '新增 Provider'}</legend>
              <div className="row"><label>名称</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="如 OpenAI / DeepSeek" /></div>
              <div className="row"><label>Base URL</label><input type="text" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.openai.com/v1" /></div>
              <div className="row"><label>API Key</label><input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." /></div>
              <div className="row"><label>Override Model（留空保持原样）</label><input type="text" value={form.override_model} onChange={e => setForm({ ...form, override_model: e.target.value })} placeholder="如 gpt-4o-mini" /></div>
              <div className="row"><label><input type="checkbox" checked={form.passthrough_auth} onChange={e => setForm({ ...form, passthrough_auth: e.target.checked })} /> 透传客户端原始 Authorization</label></div>
              <div className="actions">
                {editId && <button onClick={resetForm}>取消编辑</button>}
                <button className="primary" onClick={saveProvider}>保存</button>
              </div>
            </fieldset>
          </>
        )}

        {tab === 'general' && (
          <fieldset>
            <legend>日志保留条数</legend>
            <div className="row">
              <label>最大保存记录数（日志会持久化到 logs.jsonl）</label>
              <input type="number" value={maxRecords} min={1} max={10000} onChange={e => setMaxRecords(Number(e.target.value))} />
            </div>
            <div className="actions">
              <button className="primary" onClick={saveMaxRecords}>保存</button>
            </div>
          </fieldset>
        )}

        <div className="actions">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
