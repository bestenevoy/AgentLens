import { useState, useEffect, useRef, useCallback } from 'react';
import type { ServerConfig, RequestListItem, RequestRecord } from './types';
import { getConfig, putConfig, listRequests, getRequest, clearRequests } from './api';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { SettingsModal } from './components/SettingsModal';
import { CustomEditor } from './components/CustomEditor';

function toast(msg: string, ok = true) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (!ok) t.style.borderLeftColor = 'var(--red)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

export default function App() {
  const [config, setConfig] = useState<ServerConfig>({ mode: 'mock', selected_provider_id: null, providers: [], max_records: 50 });
  const [items, setItems] = useState<RequestListItem[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentRecord, setCurrentRecord] = useState<RequestRecord | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [customEditor, setCustomEditor] = useState<{ hash: string; fill: boolean } | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [overlay, setOverlay] = useState(false);
  const [sidebarHover, setSidebarHover] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load config
  const loadConfig = useCallback(async () => {
    const c = await getConfig();
    setConfig(c);
  }, []);

  // Load list
  const loadList = useCallback(async () => {
    const data = await listRequests();
    setItems(data || []);
  }, []);

  useEffect(() => { loadConfig(); loadList(); }, []);

  // Auto refresh
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (autoRefresh) timerRef.current = setInterval(loadList, 2000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, loadList]);

  // Window resize: hide sidebar on narrow screens
  useEffect(() => {
    function checkWidth() {
      if (window.innerWidth < 768) {
        setSidebarVisible(false);
        setOverlay(true);
      } else {
        setOverlay(false);
        setSidebarVisible(true);
      }
    }
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  // Mouse near left edge: show sidebar as overlay
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (window.innerWidth >= 768) return; // only on narrow
      if (e.clientX < 8) {
        setSidebarHover(true);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else if (e.clientX > 320) {
        setSidebarHover(false);
      }
    }
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const showSidebar = sidebarVisible || (overlay && sidebarHover);

  // Select record
  async function selectRecord(id: string) {
    setCurrentId(id);
    const r = await getRequest(id);
    setCurrentRecord(r);
  }

  // Mode change
  async function changeMode(mode: 'mock' | 'proxy') {
    const newConfig = { ...config, mode };
    setConfig(newConfig);
    await putConfig({ mode, selected_provider_id: config.selected_provider_id, max_records: config.max_records });
    toast('模式: ' + mode);
  }

  // Provider change
  async function changeProvider(id: string) {
    const pid = id || null;
    await putConfig({ mode: config.mode, selected_provider_id: pid, max_records: config.max_records });
    await loadConfig();
    toast('已切换 Provider');
  }

  // Clear
  async function doClear() {
    if (!confirm('清空所有请求记录？')) return;
    await clearRequests();
    setCurrentId(null);
    setCurrentRecord(null);
    loadList();
  }

  // Stats
  let inTok = 0, outTok = 0, cached = 0;
  for (const it of items) {
    inTok += it.prompt_tokens || 0;
    outTok += it.completion_tokens || 0;
    cached += it.cached_tokens || 0;
  }
  const cacheRate = inTok > 0 ? (cached / inTok * 100).toFixed(1) : '0.0';

  return (
    <div className="app">
      <header className="topbar">
        <h1>OpenAI Mock Inspector</h1>
        <div className="controls">
          <button className="icon" onClick={() => {
            if (overlay) {
              setSidebarHover(!sidebarHover);
            } else {
              setSidebarVisible(!sidebarVisible);
            }
          }} title="切换侧边栏">
            ☰
          </button>
          <label>模式:
            <select value={config.mode} onChange={e => changeMode(e.target.value as 'mock' | 'proxy')}>
              <option value="mock">mock</option>
              <option value="proxy">proxy</option>
            </select>
          </label>
          {config.mode === 'proxy' && (
            <label>Provider:
              <select value={config.selected_provider_id || ''} onChange={e => changeProvider(e.target.value)}>
                <option value="">(未选择)</option>
                {config.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button onClick={() => setShowSettings(true)}>⚙ 设置</button>
          {(inTok > 0 || outTok > 0) && (
            <span className="stats">
              <span className="stat-item"><span className="stat-label">↑</span><span className="stat-val in">{inTok}</span></span>
              <span className="sep">|</span>
              <span className="stat-item"><span className="stat-label">↓</span><span className="stat-val out">{outTok}</span></span>
              {cached > 0 && (<>
                <span className="sep">|</span>
                <span className="stat-item"><span className="stat-label">cache</span><span className="stat-val cache">{cached} ({cacheRate}%)</span></span>
              </>)}
            </span>
          )}
          <label><input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} /> 自动</label>
          <button onClick={loadList}>刷新</button>
          <button className="danger small" onClick={doClear}>清空</button>
        </div>
      </header>

      <div className="main">
        {overlay && !showSidebar && <div className="sidebar-trigger" onMouseEnter={() => setSidebarHover(true)} />}
        <Sidebar
          items={items}
          currentId={currentId}
          onSelect={selectRecord}
          sidebarVisible={showSidebar}
          overlay={overlay}
        />
        {currentRecord ? (
          <Detail record={currentRecord} onEditCustom={(hash, fill) => setCustomEditor({ hash, fill: !!fill })} />
        ) : (
          <section className="detail"><div className="empty">选择左侧的请求查看详情</div></section>
        )}
      </div>

      {showSettings && (
        <SettingsModal config={config} onClose={() => setShowSettings(false)} onUpdate={loadConfig} toast={toast} />
      )}
      {customEditor && (
        <CustomEditor
          hash={customEditor.hash}
          currentRecord={currentRecord}
          onClose={() => setCustomEditor(null)}
          toast={toast}
        />
      )}
    </div>
  );
}
