import { useState } from 'react';
import type { RequestRecord, ChatCompletionBody, ChatCompletionResponse, ChatMessage, ToolDef, ToolCall, ContentPart } from '../types';
import { fmtDur, cacheHitRate, fmtDateTime } from '../utils';
import { useT } from '../i18n';

interface Props {
  record: RequestRecord;
  onEditCustom: (hash: string, fillFromResponse?: boolean) => void;
}

type TabKey = 'messages' | 'tools' | 'summary' | 'upstream' | 'response';

const MSG_COLLAPSE_THRESHOLD = 5;
const TOOL_COLLAPSE_THRESHOLD = 5;

export function Detail({ record, onEditCustom }: Props) {
  const t = useT();
  const body: ChatCompletionBody = record.body || {};
  const hasTools = !!(body.tools && body.tools.length);
  const hasUpstream = !!(record.proxy_request || record.proxy_response);
  const msgCount = body.messages?.length || 0;

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'messages', label: `${t('tab.messages')} (${msgCount})` },
    ...(hasTools ? [{ key: 'tools' as TabKey, label: `${t('tab.tools')} (${body.tools!.length})` }] : []),
    { key: 'summary', label: t('tab.summary') },
    ...(hasUpstream ? [{ key: 'upstream' as TabKey, label: t('tab.upstream') }] : []),
    { key: 'response', label: t('tab.response') },
  ];

  const [tab, setTab] = useState<TabKey>('messages');

  return (
    <section className="detail">
      <div className="detail-tabs">
        {tabs.map(t2 => (
          <button
            key={t2.key}
            className={`tab-btn ${tab === t2.key ? 'active' : ''}`}
            onClick={() => setTab(t2.key)}
          >
            {t2.label}
          </button>
        ))}
      </div>
      <div className="detail-tab-body">
        {tab === 'messages' && (
          <MessagesBlock messages={body.messages || []} />
        )}
        {tab === 'tools' && hasTools && body.tools && (
          <ToolsBlock tools={body.tools} />
        )}
        {tab === 'summary' && (
          <>
            <SummaryBlock record={record} onEditCustom={onEditCustom} />
            <ParamsBlock body={body} />
          </>
        )}
        {tab === 'upstream' && (
          <>
            {record.proxy_request && <ProxyRequestBlock data={record.proxy_request} model={body.model} />}
            {record.proxy_response && <ProxyResponseBlock resp={record.proxy_response} status={record.proxy_status} />}
            {!record.proxy_request && !record.proxy_response && (
              <div className="empty">{t('msg.no_upstream')}</div>
            )}
          </>
        )}
        {tab === 'response' && (
          <>
            {record.error && <div className="error-box">⚠️ {record.error}</div>}
            {record.response ? (
              <ResponseBlock
                resp={record.response}
                promptTokens={record.prompt_tokens}
                completionTokens={record.completion_tokens}
                cachedTokens={record.cached_tokens}
                hash={record.hash}
                onEditCustom={onEditCustom}
              />
            ) : (
              !record.error && <div className="empty">{t('msg.no_response')}</div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ============ Block wrapper ============
function Block({ title, children, json, collapsed = false, summary = '', extra }: {
  title: string; children: React.ReactNode; json: unknown; collapsed?: boolean; summary?: string; extra?: React.ReactNode;
}) {
  const [isCollapsed, setIsCollapsed] = useState(collapsed);
  const [view, setView] = useState<'human' | 'json'>('human');

  return (
    <div className={`block ${isCollapsed ? 'collapsed' : ''}`} data-view={view}>
      <h3 onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setIsCollapsed(!isCollapsed); }}>
        <span className="caret">▾</span>
        {title} {extra}
        {summary && <span className="block-summary">{summary}</span>}
        <button className="view-toggle small" onClick={(e) => { e.stopPropagation(); setView(view === 'human' ? 'json' : 'human'); }}>
          {view === 'human' ? 'JSON' : 'Human'}
        </button>
      </h3>
      <div className="block-body">
        <div className="block-human">{children}</div>
        <div className="block-json"><pre>{JSON.stringify(json, null, 2)}</pre></div>
      </div>
    </div>
  );
}

// ============ Summary ============
function SummaryBlock({ record, onEditCustom }: { record: RequestRecord; onEditCustom: (h: string) => void }) {
  const t = useT();
  const model = record.body?.model;
  const dur = record.duration_ms ? fmtDur(record.duration_ms) : '-';
  const cacheRate = record.prompt_tokens && record.cached_tokens
    ? cacheHitRate(record.prompt_tokens, record.cached_tokens).toFixed(1) + '%' : '-';

  const summaryData = {
    id: record.id, hash: record.hash,
    [t('summary.request_time')]: fmtDateTime(record.timestamp),
    [t('summary.response_time')]: record.response_timestamp ? fmtDateTime(record.response_timestamp) : '-',
    [t('summary.duration')]: dur,
    [t('summary.input_tokens')]: record.prompt_tokens || 0,
    [t('summary.output_tokens')]: record.completion_tokens || 0,
    [t('summary.total_tokens')]: record.total_tokens || 0,
    [t('summary.cached_tokens')]: record.cached_tokens || 0,
    [t('summary.cache_rate')]: cacheRate,
    path: record.path, method: record.method, model, source: record.response_source, error: record.error,
  };

  return (
    <Block
      title={t('block.summary')}
      summary={`${model || '-'} · ${record.response_source}${record.error ? ' · err' : ''} · ${dur}`}
      extra={
        <>
          <span className="hash">{record.hash}</span>
          <span className={`tag ${record.response_source}`}>{record.response_source}</span>
          <button className="small" onClick={() => onEditCustom(record.hash)}>{t('btn.edit_custom')}</button>
        </>
      }
      json={summaryData}
    >
      <pre>{JSON.stringify(summaryData, null, 2)}</pre>
    </Block>
  );
}

// ============ Params ============
function ParamsBlock({ body }: { body: ChatCompletionBody }) {
  const t = useT();
  const params = { ...body };
  delete params.messages;
  delete params.tools;
  const keys = Object.keys(params).filter(k => params[k] != null);
  return (
    <Block title={t('block.params')} summary={keys.length ? keys.join(', ') : '(—)'} json={params}>
      <pre>{JSON.stringify(params, null, 2)}</pre>
    </Block>
  );
}

// ============ Tools ============
function ToolsBlock({ tools }: { tools: ToolDef[] }) {
  const t = useT();
  const defaultCollapsed = tools.length > TOOL_COLLAPSE_THRESHOLD;
  const names = tools.map(t2 => t2.function?.name || '?').join(', ');
  return (
    <Block title={`${t('block.tools')} (${tools.length})`} summary={names} json={tools}>
      {defaultCollapsed && (
        <div className="msg-collapse-hint">{t('tools.collapse_hint', { n: tools.length })}</div>
      )}
      {tools.map((tool, i) => <ToolDefCard key={i} tool={tool} defaultCollapsed={defaultCollapsed} />)}
    </Block>
  );
}

function ToolDefCard({ tool, defaultCollapsed = false }: { tool: ToolDef; defaultCollapsed?: boolean }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const fn = tool.function || {};
  const params = fn.parameters?.properties || {};
  const required = new Set(fn.parameters?.required || []);
  const hasParams = Object.keys(params).length > 0;

  return (
    <div className={`tool-card ${collapsed ? 'collapsed' : ''}`}>
      <div className="tool-card-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="tool-card-caret">▾</span>
        <span className="tool-card-name">{fn.name || ''}</span>
        {collapsed && <span className="tool-card-desc">{fn.description || ''}</span>}
      </div>
      <div className="tool-card-body">
        {fn.description && <div className="tool-card-desc">{fn.description}</div>}
        {hasParams && (
          <div>
            <div style={{ color: 'var(--text-mute)', fontSize: 11, marginBottom: 2 }}>{t('tools.parameters')}</div>
            {Object.entries(params).map(([name, schema]) => (
              <div key={name} className="param-row">
                <span className="param-name">{name}</span>
                <span className="param-type">{(schema as Record<string, unknown>).type as string || 'any'}</span>
                {required.has(name) && <span className="param-req">{t('tools.required')}</span>}
                <span className="param-desc">{(schema as Record<string, unknown>).description as string || ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============ Messages ============
type MsgGroup = { type: 'single'; msg: ChatMessage; index: number } | { type: 'batch'; msgs: { msg: ChatMessage; index: number }[] };

function groupMessages(messages: ChatMessage[]): MsgGroup[] {
  const groups: MsgGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      const batch: { msg: ChatMessage; index: number }[] = [{ msg, index: i }];
      i++;
      while (i < messages.length && messages[i].role === 'tool') {
        batch.push({ msg: messages[i], index: i });
        i++;
      }
      groups.push({ type: 'batch', msgs: batch });
    } else {
      groups.push({ type: 'single', msg, index: i });
      i++;
    }
  }
  return groups;
}

function MessagesBlock({ messages }: { messages: ChatMessage[] }) {
  const t = useT();
  const defaultCollapsed = messages.length > MSG_COLLAPSE_THRESHOLD;
  const groups = groupMessages(messages);
  const legend = <span style={{ fontSize: 10, color: 'var(--text-mute)', textTransform: 'none' }}>{t('msg.legend')}</span>;
  return (
    <Block title={`${t('block.messages')} (${messages.length}) ${legend}`} json={messages}>
      {defaultCollapsed && (
        <div className="msg-collapse-hint">{t('msg.collapse_hint', { n: messages.length })}</div>
      )}
      {groups.map((g, gi) => {
        if (g.type === 'batch') {
          return (
            <div key={gi} className="tool-batch">
              <div className="tool-batch-label">{t('msg.tool_batch')}</div>
              {g.msgs.map(({ msg, index }) => (
                <MessageCard key={index} msg={msg} index={index} defaultCollapsed={defaultCollapsed} />
              ))}
            </div>
          );
        }
        return <MessageCard key={gi} msg={g.msg} index={g.index} defaultCollapsed={defaultCollapsed} />;
      })}
    </Block>
  );
}

function MessageCard({ msg, index, defaultCollapsed = false }: { msg: ChatMessage; index: number; defaultCollapsed?: boolean }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [view, setView] = useState<'human' | 'json'>('human');
  const role = msg.role || '?';
  const summary = msgSummary(msg, t);

  return (
    <div className={`msg-card role-${role} ${collapsed ? 'collapsed' : ''}`} data-view={view}>
      <div className="msg-header" onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setCollapsed(!collapsed); }}>
        <span className="msg-caret">▾</span>
        <DirArrow role={role} />
        <span className={`role-badge role-${role}`}>{role}</span>
        <span className="msg-index">#{index}</span>
        <span className="msg-summary">{summary}</span>
        <button className="view-toggle small msg-view-toggle" onClick={(e) => { e.stopPropagation(); setView(view === 'human' ? 'json' : 'human'); }} title="Toggle JSON view">
          {view === 'human' ? 'JSON' : 'Human'}
        </button>
      </div>
      <div className="msg-body">
        <div className="msg-human">
          {msg.content != null && <Content content={msg.content} />}
          {msg.tool_calls?.map((tc: ToolCall, i: number) => <ToolCallCard key={i} tc={tc} />)}
          {msg.tool_call_id && <div className="tool-result-meta">tool_call_id: <code>{msg.tool_call_id}</code></div>}
          {msg.name && <div className="tool-result-meta">name: <code>{msg.name}</code></div>}
        </div>
        <div className="msg-json"><pre>{JSON.stringify(msg, null, 2)}</pre></div>
      </div>
    </div>
  );
}

function DirArrow({ role }: { role: string }) {
  if (role === 'assistant') return <span className="dir-arrow down" title="LLM response">↓</span>;
  return <span className="dir-arrow up" title="To LLM">↑</span>;
}

function msgSummary(m: ChatMessage, t: (k: string) => string): string {
  if (m.content != null) {
    let txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (txt.length > 60) txt = txt.substring(0, 60) + '...';
    return txt;
  }
  if (m.tool_calls) return 'tool_calls: ' + m.tool_calls.map((tc: ToolCall) => tc.function?.name).join(', ');
  return t('msg.empty');
}

function Content({ content }: { content: string | ContentPart[] }) {
  if (content == null) return null;
  if (typeof content === 'string') return <div className="msg-content">{content}</div>;
  if (Array.isArray(content)) {
    return <>{content.map((part, i) => {
      if (part.type === 'text') return <div key={i} className="msg-content">{part.text || ''}</div>;
      if (part.type === 'image_url') return <div key={i} className="msg-content" style={{ color: 'var(--accent)' }}>[image: {(part.image_url?.url || '').substring(0, 60)}]</div>;
      return <pre key={i}>{JSON.stringify(part, null, 2)}</pre>;
    })}</>;
  }
  return <pre>{JSON.stringify(content, null, 2)}</pre>;
}

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const t = useT();
  const fn = tc.function || {};
  let argsHtml: React.ReactNode;
  try {
    const parsed = JSON.parse(fn.arguments || '{}');
    argsHtml = Object.keys(parsed).length === 0
      ? <span style={{ color: 'var(--text-mute)' }}>{t('tools.empty')}</span>
      : Object.entries(parsed).map(([k, v]) => (
        <div key={k} className="arg-row"><span className="arg-key">{k}</span>: <span className="arg-val">{JSON.stringify(v)}</span></div>
      ));
  } catch {
    argsHtml = <pre style={{ margin: 0, maxHeight: 200, overflowY: 'auto' }}>{fn.arguments || ''}</pre>;
  }
  return (
    <div className="tool-call-card">
      <div className="tool-call-header">
        <span>🔧</span>
        <span className="tool-call-name">{fn.name || ''}</span>
        <span className="tool-call-id">{tc.id || ''}</span>
      </div>
      <div style={{ color: 'var(--text-mute)', fontSize: 11, marginBottom: 2 }}>{t('tools.arguments')}</div>
      {argsHtml}
    </div>
  );
}

// ============ Proxy ============
function ProxyRequestBlock({ data, model }: { data: ChatCompletionBody; model?: string }) {
  const t = useT();
  return (
    <Block title={t('block.proxy.request')} collapsed summary={`model: ${data.model || model || '-'}`} json={data}>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </Block>
  );
}

function ProxyResponseBlock({ resp, status }: { resp: ChatCompletionResponse; status?: number }) {
  const t = useT();
  return (
    <Block title={`${t('block.proxy.response')} (status=${status || '-'})`} json={resp}>
      <ResponseHuman resp={resp} />
    </Block>
  );
}

// ============ Response ============
function ResponseBlock({ resp, promptTokens, completionTokens, cachedTokens, hash, onEditCustom }: {
  resp: ChatCompletionResponse; promptTokens?: number; completionTokens?: number; cachedTokens?: number; hash: string;
  onEditCustom: (h: string, fill?: boolean) => void;
}) {
  const t = useT();
  const respMsg = resp.choices?.[0]?.message;
  const respSummary = respMsg?.content ? String(respMsg.content).substring(0, 40) : (respMsg?.tool_calls ? 'tool_calls' : '-');
  const tokExtra = promptTokens ? <span className="tag tok">↑{promptTokens} ↓{completionTokens}</span> : null;
  const cacheExtra = cachedTokens && cachedTokens > 0
    ? <span className="tag cache">cache {cacheHitRate(promptTokens, cachedTokens).toFixed(0)}%</span> : null;

  return (
    <Block
      title={t('block.response')}
      summary={respSummary}
      extra={<>{tokExtra}{cacheExtra}<button className="small" onClick={() => onEditCustom(hash, true)}>{t('btn.set_custom')}</button></>}
      json={resp}
    >
      <ResponseHuman resp={resp} />
    </Block>
  );
}

function ResponseHuman({ resp }: { resp: ChatCompletionResponse }) {
  const t = useT();
  if (!resp) return <span style={{ color: 'var(--text-mute)' }}>{t('response.no_response')}</span>;
  if (resp.error) return <div className="error-box">⚠️ {resp.error.message || JSON.stringify(resp.error)}</div>;
  const choice = resp.choices?.[0];
  if (!choice) return <div style={{ color: 'var(--text-mute)' }}>{t('response.no_choices')}</div>;
  const msg: ChatMessage = choice.message || { role: '' };
  return (
    <div className="response-card">
      <div className="msg-header">
        <span className="dir-arrow down" title="LLM response">↓</span>
        <span className="role-badge role-assistant">assistant</span>
        <span className="finish-reason">{t('response.finish')} {choice.finish_reason || ''}</span>
      </div>
      {msg.content != null && <Content content={msg.content} />}
      {msg.tool_calls?.map((tc: ToolCall, i: number) => <ToolCallCard key={i} tc={tc} />)}
      {resp.usage && (
        <div className="usage">
          {t('response.tokens')} prompt={resp.usage.prompt_tokens || 0} completion={resp.usage.completion_tokens || 0} total={resp.usage.total_tokens || 0}
          {resp.usage.prompt_tokens_details?.cached_tokens ? ` cached=${resp.usage.prompt_tokens_details.cached_tokens}` : ''}
        </div>
      )}
    </div>
  );
}
