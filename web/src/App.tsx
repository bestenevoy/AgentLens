import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ServerConfig, RequestListItem, RequestRecord } from './types';
import { getConfig, putConfig, listRequests, getRequest, clearRequests } from './api';
import { ApiError } from './api';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { SettingsModal } from './components/SettingsModal';
import { CustomEditor } from './components/CustomEditor';
import { ErrorBoundary } from './components/ErrorBoundary';

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
    try {
      const c = await getConfig();
      setConfig(c);
    } catch (e) {
      toast('加载配置失败: ' + (e instanceof Error ? e.message : String(e)), false);
    }
  }, []);

  // Load list (with diff check to avoid unnecessary re-renders)
  const loadList = useCallback(async () => {
    try {
      const data = await listRequests();
      const next = data || [];
      // 简单 diff：比较 JSON 字符串，避免完全相同的列表触发重渲染
      setItems(prev => {
        if (prev.length !== next.length) return next;
        if (prev.length === 0) return next;
        // 比较每条记录的 id + timestamp（足够检测变化）
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].id !== next[i].id || prev[i].timestamp !== next[i].timestamp) {
            return next;
          }
        }
        return prev; // 无变化，返回旧引用
      });
    } catch (e) {
      // 静默处理轮询错误，避免刷屏
      if (e instanceof ApiError && e.status >= 500) {
        console.error('Failed to load requests:', e.message);
      }
    }
  }, []);

  useEffect(() => { loadConfig(); loadList(); }, [loadConfig, loadList]);

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
  const selectRecord = useCallback(async (id: string) => {
    setCurrentId(id);
    try {
      const r = await getRequest(id);
      setCurrentRecord(r);
    } catch (e) {
      toast('加载详情失败: ' + (e instanceof Error ? e.message : String(e)), false);
    }
  }, []);

  // Mode change
  async function changeMode(mode: 'mock' | 'proxy') {
    const newConfig = { ...config, mode };
    setConfig(newConfig);
    try {
      await putConfig({ mode, selected_provider_id: config.selected_provider_id, max_records: config.max_records });
      toast('模式: ' + mode);
    } catch (e) {
      toast('切换模式失败', false);
      setConfig(config); // rollback
    }
  }

  // Provider change
  async function changeProvider(id: string) {
    const pid = id || null;
    try {
      await putConfig({ mode: config.mode, selected_provider_id: pid, max_records: config.max_records });
      await loadConfig();
      toast('已切换 Provider');
    } catch (e) {
      toast('切换 Provider 失败', false);
    }
  }

  // Clear
  async function doClear() {
    if (!confirm('清空所有请求记录？')) return;
    try {
      await clearRequests();
      setCurrentId(null);
      setCurrentRecord(null);
      loadList();
    } catch (e) {
      toast('清空失败', false);
    }
  }

  // Stats (memoized)
  const stats = useMemo(() => {
    let inTok = 0, outTok = 0, cached = 0;
    for (const it of items) {
      inTok += it.prompt_tokens || 0;
      outTok += it.completion_tokens || 0;
      cached += it.cached_tokens || 0;
    }
    const cacheRate = inTok > 0 ? (cached / inTok * 100).toFixed(1) : '0.0';
    return { inTok, outTok, cached, cacheRate };
  }, [items]);

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
          {(stats.inTok > 0 || stats.outTok > 0) && (
            <span className="stats">
              <span className="stat-item"><span className="stat-label">↑</span><span className="stat-val in">{stats.inTok}</span></span>
              <span className="sep">|</span>
              <span className="stat-item"><span className="stat-label">↓</span><span className="stat-val out">{stats.outTok}</span></span>
              {stats.cached > 0 && (<>
                <span className="sep">|</span>
                <span className="stat-item"><span className="stat-label">cache</span><span className="stat-val cache">{stats.cached} ({stats.cacheRate}%)</span></span>
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
          <ErrorBoundary key={currentRecord.id}>
            <Detail record={currentRecord} onEditCustom={(hash, fill) => setCustomEditor({ hash, fill: !!fill })} />
          </ErrorBoundary>
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
