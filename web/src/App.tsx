import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { ServerConfig, RequestListItem, RequestRecord } from './types';
import { getConfig, putConfig, listRequests, getRequest, clearRequests } from './api';
import { ApiError } from './api';
import { Sidebar } from './components/Sidebar';
import { Detail } from './components/Detail';
import { SettingsModal } from './components/SettingsModal';
import { CustomEditor } from './components/CustomEditor';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useT, useLang } from './i18n';
import { useTheme } from './theme';
import type { Theme } from './theme';

function toast(msg: string, ok = true) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (!ok) t.style.borderLeftColor = 'var(--red)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

export default function App() {
  const t = useT();
  const [lang, setLang] = useLang();
  const [theme, setTheme] = useTheme();
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
      toast(t('config.load.fail') + (e instanceof Error ? e.message : String(e)), false);
    }
  }, [t]);

  // Load list (with diff check to avoid unnecessary re-renders)
  const loadList = useCallback(async () => {
    try {
      const data = await listRequests();
      const next = data || [];
      setItems(prev => {
        if (prev.length !== next.length) return next;
        if (prev.length === 0) return next;
        for (let i = 0; i < prev.length; i++) {
          if (prev[i].id !== next[i].id || prev[i].timestamp !== next[i].timestamp) {
            return next;
          }
        }
        return prev;
      });
    } catch (e) {
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
      if (window.innerWidth >= 768) return;
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
      toast(t('detail.load.fail') + (e instanceof Error ? e.message : String(e)), false);
    }
  }, [t]);

  // Mode change
  async function changeMode(mode: 'mock' | 'proxy') {
    const newConfig = { ...config, mode };
    setConfig(newConfig);
    try {
      await putConfig({ mode, selected_provider_id: config.selected_provider_id, max_records: config.max_records });
      toast(t('mode.switched') + mode);
    } catch (e) {
      toast(t('mode.switch.fail'), false);
      setConfig(config);
    }
  }

  // Provider change
  async function changeProvider(id: string) {
    const pid = id || null;
    try {
      await putConfig({ mode: config.mode, selected_provider_id: pid, max_records: config.max_records });
      await loadConfig();
      toast(t('provider.switched'));
    } catch (e) {
      toast(t('provider.switch.fail'), false);
    }
  }

  // Clear
  async function doClear() {
    if (!confirm(t('clear.confirm'))) return;
    try {
      await clearRequests();
      setCurrentId(null);
      setCurrentRecord(null);
      loadList();
    } catch (e) {
      toast(t('clear.fail'), false);
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
            if (overlay) setSidebarHover(!sidebarHover);
            else setSidebarVisible(!sidebarVisible);
          }} title="Toggle sidebar">☰</button>
          <select value={config.mode} onChange={e => changeMode(e.target.value as 'mock' | 'proxy')} title={t('mode')}>
            <option value="mock">mock</option>
            <option value="proxy">proxy</option>
          </select>
          {config.mode === 'proxy' && (
            <select value={config.selected_provider_id || ''} onChange={e => changeProvider(e.target.value)} title={t('provider')}>
              <option value="">(—)</option>
              {config.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={() => setShowSettings(true)}>⚙ {t('settings')}</button>
          {(stats.inTok > 0 || stats.outTok > 0) && (
            <span className="stats">
              <span className="stat-item"><span className="stat-label">↑</span><span className="stat-val in">{stats.inTok}</span></span>
              <span className="sep">|</span>
              <span className="stat-item"><span className="stat-label">↓</span><span className="stat-val out">{stats.outTok}</span></span>
              {stats.cached > 0 && (<>
                <span className="sep">|</span>
                <span className="stat-item"><span className="stat-label">{t('stats.cache')}</span><span className="stat-val cache">{stats.cached} ({stats.cacheRate}%)</span></span>
              </>)}
            </span>
          )}
          <button className={autoRefresh ? 'toggle active' : 'toggle'} onClick={() => setAutoRefresh(!autoRefresh)}>{t('auto')}</button>
          <button onClick={loadList}>{t('refresh')}</button>
          <button className="danger" onClick={doClear}>{t('clear')}</button>
          <select value={theme} onChange={e => setTheme(e.target.value as Theme)} title={t('theme')}>
            <option value="auto">{t('theme.auto')}</option>
            <option value="light">{t('theme.light')}</option>
            <option value="dark">{t('theme.dark')}</option>
          </select>
          <select value={lang} onChange={e => setLang(e.target.value as 'en' | 'cn')} title={t('language')}>
            <option value="en">EN</option>
            <option value="cn">中文</option>
          </select>
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
          <section className="detail"><div className="empty">{t('select.request')}</div></section>
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
