import { useState } from 'react';
import type { ServerConfig, Provider } from '../types';
import { createProvider, updateProvider, deleteProvider, putConfig } from '../api';
import { useT } from '../i18n';

interface Props {
  config: ServerConfig;
  onClose: () => void;
  onUpdate: () => void;
  toast: (msg: string, ok?: boolean) => void;
}

export function SettingsModal({ config, onClose, onUpdate, toast }: Props) {
  const t = useT();
  const [tab, setTab] = useState<'providers' | 'general'>('providers');
  const [editId, setEditId] = useState<string>('');
  const [form, setForm] = useState<Omit<Provider, 'id'>>({
    name: '', base_url: 'https://api.openai.com/v1', api_key: '', override_model: '', passthrough_auth: false,
  });
  const [maxRecords, setMaxRecords] = useState(config.max_records || 50);

  async function saveProvider() {
    if (!form.name) { toast(t('settings.name_required'), false); return; }
    try {
      if (editId) {
        await updateProvider(editId, form);
      } else {
        await createProvider(form);
      }
      resetForm();
      onUpdate();
      toast(t('settings.saved'));
    } catch (e) {
      toast(t('settings.save_fail'), false);
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
    if (!confirm(t('settings.delete_confirm'))) return;
    await deleteProvider(id);
    onUpdate();
    toast(t('settings.deleted'));
  }

  async function selectProvider(id: string) {
    await putConfig({ mode: config.mode, selected_provider_id: id, max_records: maxRecords });
    onUpdate();
    toast(t('provider.switched'));
  }

  async function saveMaxRecords() {
    await putConfig({ mode: config.mode, selected_provider_id: config.selected_provider_id, max_records: maxRecords });
    onUpdate();
    toast(t('settings.saved'));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{t('settings.title')}</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className={tab === 'providers' ? 'primary' : ''} onClick={() => setTab('providers')}>{t('settings.providers')}</button>
          <button className={tab === 'general' ? 'primary' : ''} onClick={() => setTab('general')}>{t('settings.general')}</button>
        </div>

        {tab === 'providers' && (
          <>
            <div className="provider-list">
              {config.providers.length === 0 ? (
                <div style={{ color: 'var(--text-mute)', padding: 8 }}>{t('settings.no_providers')}</div>
              ) : config.providers.map(p => (
                <div key={p.id} className={`provider-item ${p.id === config.selected_provider_id ? 'selected' : ''}`}>
                  <span className="name">{p.name}</span>
                  <span className="url">{p.base_url}</span>
                  {p.override_model && <span className="tag">{'->'}{p.override_model}</span>}
                  <div className="actions">
                    <button className="small" onClick={() => selectProvider(p.id)}>{t('settings.select')}</button>
                    <button className="small" onClick={() => editProvider(p)}>{t('settings.edit')}</button>
                    <button className="small danger" onClick={() => delProvider(p.id)}>{t('settings.delete')}</button>
                  </div>
                </div>
              ))}
            </div>
            <fieldset>
              <legend>{editId ? t('settings.edit_provider') : t('settings.new_provider')}</legend>
              <div className="row"><label>{t('settings.name')}</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="OpenAI / DeepSeek / ..." /></div>
              <div className="row"><label>{t('settings.base_url')}</label><input type="text" value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} placeholder="https://api.openai.com/v1" /></div>
              <div className="row"><label>{t('settings.api_key')}</label><input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." /></div>
              <div className="row"><label>{t('settings.override_model')}</label><input type="text" value={form.override_model} onChange={e => setForm({ ...form, override_model: e.target.value })} placeholder="gpt-4o-mini" /></div>
              <div className="row"><label><input type="checkbox" checked={form.passthrough_auth} onChange={e => setForm({ ...form, passthrough_auth: e.target.checked })} /> {t('settings.passthrough_auth')}</label></div>
              <div className="actions">
                {editId && <button onClick={resetForm}>{t('settings.cancel_edit')}</button>}
                <button className="primary" onClick={saveProvider}>{t('settings.save')}</button>
              </div>
            </fieldset>
          </>
        )}

        {tab === 'general' && (
          <fieldset>
            <legend>{t('settings.max_records')}</legend>
            <div className="row">
              <label>{t('settings.max_records_label')}</label>
              <input type="number" value={maxRecords} min={1} max={10000} onChange={e => setMaxRecords(Number(e.target.value))} />
            </div>
            <div className="actions">
              <button className="primary" onClick={saveMaxRecords}>{t('settings.save')}</button>
            </div>
          </fieldset>
        )}

        <div className="actions">
          <button onClick={onClose}>{t('settings.close')}</button>
        </div>
      </div>
    </div>
  );
}
