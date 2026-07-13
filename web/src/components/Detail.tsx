import { useState } from 'react';
import type { RequestRecord, ChatCompletionBody, ChatCompletionResponse, ChatMessage, ToolDef, ToolCall, ContentPart } from '../types';
import { fmtDur, cacheHitRate, fmtDateTime } from '../utils';

interface Props {
  record: RequestRecord;
  onEditCustom: (hash: string, fillFromResponse?: boolean) => void;
}

export function Detail({ record, onEditCustom }: Props) {
  const body: ChatCompletionBody = record.body || {};
  return (
    <section className="detail">
      <SummaryBlock record={record} onEditCustom={onEditCustom} />
      <ParamsBlock body={body} />
      {body.tools && <ToolsBlock tools={body.tools} />}
      <MessagesBlock messages={body.messages || []} />
      {record.proxy_request && <ProxyRequestBlock data={record.proxy_request} model={body.model} />}
      {record.proxy_response && <ProxyResponseBlock resp={record.proxy_response} status={record.proxy_status} />}
      {record.response && (
        <ResponseBlock
          resp={record.response}
          promptTokens={record.prompt_tokens}
          completionTokens={record.completion_tokens}
          cachedTokens={record.cached_tokens}
          hash={record.hash}
          onEditCustom={onEditCustom}
        />
      )}
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
          {view === 'human' ? '查看 JSON' : '查看 Human'}
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
  const model = record.body?.model;
  const dur = record.duration_ms ? fmtDur(record.duration_ms) : '-';
  const cacheRate = record.prompt_tokens && record.cached_tokens
    ? cacheHitRate(record.prompt_tokens, record.cached_tokens).toFixed(1) + '%' : '-';

  const summaryData = {
    id: record.id, hash: record.hash,
    '请求时间': fmtDateTime(record.timestamp),
    '响应时间': record.response_timestamp ? fmtDateTime(record.response_timestamp) : '-',
    '耗时': dur,
    '输入token': record.prompt_tokens || 0,
    '输出token': record.completion_tokens || 0,
    '总token': record.total_tokens || 0,
    '缓存token': record.cached_tokens || 0,
    '缓存命中率': cacheRate,
    path: record.path, method: record.method, model, source: record.response_source, error: record.error,
  };

  return (
    <Block
      title="请求概要"
      collapsed
      summary={`${model || '-'} · ${record.response_source}${record.error ? ' · err' : ''} · ${dur}`}
      extra={
        <>
          <span className="hash">{record.hash}</span>
          <span className={`tag ${record.response_source}`}>{record.response_source}</span>
          <button className="small" onClick={() => onEditCustom(record.hash)}>编辑自定义响应</button>
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
  const params = { ...body };
  delete params.messages;
  delete params.tools;
  const keys = Object.keys(params).filter(k => params[k] != null);
  return (
    <Block title="请求参数" collapsed summary={keys.length ? keys.join(', ') : '(无)'} json={params}>
      <pre>{JSON.stringify(params, null, 2)}</pre>
    </Block>
  );
}

// ============ Tools ============
function ToolsBlock({ tools }: { tools: ToolDef[] }) {
  const names = tools.map(t => t.function?.name || '?').join(', ');
  return (
    <Block title={`Tools (${tools.length})`} collapsed summary={names} json={tools}>
      {tools.map((tool, i) => <ToolDefCard key={i} tool={tool} />)}
    </Block>
  );
}

function ToolDefCard({ tool }: { tool: ToolDef }) {
  const fn = tool.function || {};
  const params = fn.parameters?.properties || {};
  const required = new Set(fn.parameters?.required || []);
  return (
    <div className="tool-card">
      <div className="tool-card-name">{fn.name || ''}</div>
      <div className="tool-card-desc">{fn.description || ''}</div>
      {Object.keys(params).length > 0 && (
        <div>
          <div style={{ color: 'var(--text-mute)', fontSize: 11, marginBottom: 2 }}>Parameters:</div>
          {Object.entries(params).map(([name, schema]) => (
            <div key={name} className="param-row">
              <span className="param-name">{name}</span>
              <span className="param-type">{(schema as Record<string, unknown>).type as string || 'any'}</span>
              {required.has(name) && <span className="param-req">必填</span>}
              <span className="param-desc">{(schema as Record<string, unknown>).description as string || ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ Messages ============
function MessagesBlock({ messages }: { messages: ChatMessage[] }) {
  const legend = <span style={{ fontSize: 10, color: 'var(--text-mute)', textTransform: 'none' }}>↑ 发给 LLM · ↓ LLM 返回 · 点击 header 折叠</span>;
  return (
    <Block title={`Messages (${messages.length}) ${legend}`} json={messages}>
      {messages.map((m, i) => <MessageCard key={i} msg={m} index={i} />)}
    </Block>
  );
}

function MessageCard({ msg, index }: { msg: ChatMessage; index: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const role = msg.role || '?';
  const summary = msgSummary(msg);

  return (
    <div className={`msg-card role-${role} ${collapsed ? 'collapsed' : ''}`}>
      <div className="msg-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="msg-caret">▾</span>
        <DirArrow role={role} />
        <span className={`role-badge role-${role}`}>{role}</span>
        <span className="msg-index">#{index}</span>
        <span className="msg-summary">{summary}</span>
      </div>
      <div className="msg-body">
        {msg.content != null && <Content content={msg.content} />}
        {msg.tool_calls?.map((tc: ToolCall, i: number) => <ToolCallCard key={i} tc={tc} />)}
        {msg.tool_call_id && <div className="tool-result-meta">tool_call_id: <code>{msg.tool_call_id}</code></div>}
        {msg.name && <div className="tool-result-meta">name: <code>{msg.name}</code></div>}
      </div>
    </div>
  );
}

function DirArrow({ role }: { role: string }) {
  if (role === 'assistant') return <span className="dir-arrow down" title="LLM 返回">↓</span>;
  return <span className="dir-arrow up" title="发给 LLM">↑</span>;
}

function msgSummary(m: ChatMessage): string {
  if (m.content != null) {
    let txt = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (txt.length > 60) txt = txt.substring(0, 60) + '...';
    return txt;
  }
  if (m.tool_calls) return 'tool_calls: ' + m.tool_calls.map((tc: ToolCall) => tc.function?.name).join(', ');
  return '(空)';
}

function Content({ content }: { content: string | ContentPart[] }) {
  if (content == null) return null;
  if (typeof content === 'string') return <div className="msg-content">{content}</div>;
  if (Array.isArray(content)) {
    return <>{content.map((part, i) => {
      if (part.type === 'text') return <div key={i} className="msg-content">{part.text || ''}</div>;
      if (part.type === 'image_url') return <div key={i} className="msg-content" style={{ color: 'var(--accent)' }}>[图片: {(part.image_url?.url || '').substring(0, 60)}]</div>;
      return <pre key={i}>{JSON.stringify(part, null, 2)}</pre>;
    })}</>;
  }
  return <pre>{JSON.stringify(content, null, 2)}</pre>;
}

function ToolCallCard({ tc }: { tc: ToolCall }) {
  const fn = tc.function || {};
  let argsHtml: React.ReactNode;
  try {
    const parsed = JSON.parse(fn.arguments || '{}');
    argsHtml = Object.keys(parsed).length === 0
      ? <span style={{ color: 'var(--text-mute)' }}>(空)</span>
      : Object.entries(parsed).map(([k, v]) => (
        <div key={k} className="arg-row"><span className="arg-key">{k}</span>: <span className="arg-val">{JSON.stringify(v)}</span></div>
      ));
  } catch {
    argsHtml = <pre style={{ margin: 0 }}>{fn.arguments || ''}</pre>;
  }
  return (
    <div className="tool-call-card">
      <div className="tool-call-header">
        <span>🔧</span>
        <span className="tool-call-name">{fn.name || ''}</span>
        <span className="tool-call-id">{tc.id || ''}</span>
      </div>
      <div style={{ color: 'var(--text-mute)', fontSize: 11, marginBottom: 2 }}>arguments:</div>
      {argsHtml}
    </div>
  );
}

// ============ Proxy ============
function ProxyRequestBlock({ data, model }: { data: ChatCompletionBody; model?: string }) {
  return (
    <Block title="转发到上游的请求" collapsed summary={`model: ${data.model || model || '-'}`} json={data}>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </Block>
  );
}

function ProxyResponseBlock({ resp, status }: { resp: ChatCompletionResponse; status?: number }) {
  return (
    <Block title={`上游响应 (status=${status || '-'})`} json={resp}>
      <ResponseHuman resp={resp} />
    </Block>
  );
}

// ============ Response ============
function ResponseBlock({ resp, promptTokens, completionTokens, cachedTokens, hash, onEditCustom }: {
  resp: ChatCompletionResponse; promptTokens?: number; completionTokens?: number; cachedTokens?: number; hash: string;
  onEditCustom: (h: string, fill?: boolean) => void;
}) {
  const respMsg = resp.choices?.[0]?.message;
  const respSummary = respMsg?.content ? String(respMsg.content).substring(0, 40) : (respMsg?.tool_calls ? 'tool_calls' : '-');
  const tokExtra = promptTokens ? <span className="tag tok">↑{promptTokens} ↓{completionTokens}</span> : null;
  const cacheExtra = cachedTokens && cachedTokens > 0
    ? <span className="tag cache">cache {cacheHitRate(promptTokens, cachedTokens).toFixed(0)}%</span> : null;

  return (
    <Block
      title="返回给客户端的响应"
      summary={respSummary}
      extra={<>{tokExtra}{cacheExtra}<button className="small" onClick={() => onEditCustom(hash, true)}>用此响应设置自定义</button></>}
      json={resp}
    >
      <ResponseHuman resp={resp} />
    </Block>
  );
}

function ResponseHuman({ resp }: { resp: ChatCompletionResponse }) {
  if (!resp) return <span style={{ color: 'var(--text-mute)' }}>(无响应)</span>;
  if (resp.error) return <div className="error-box">⚠️ {resp.error.message || JSON.stringify(resp.error)}</div>;
  const choice = resp.choices?.[0];
  if (!choice) return <div style={{ color: 'var(--text-mute)' }}>无 choices</div>;
  const msg: ChatMessage = choice.message || { role: '' };
  return (
    <div className="response-card">
      <div className="msg-header">
        <span className="dir-arrow down" title="LLM 返回">↓</span>
        <span className="role-badge role-assistant">assistant</span>
        <span className="finish-reason">finish: {choice.finish_reason || ''}</span>
      </div>
      {msg.content != null && <Content content={msg.content} />}
      {msg.tool_calls?.map((tc: ToolCall, i: number) => <ToolCallCard key={i} tc={tc} />)}
      {resp.usage && (
        <div className="usage">
          tokens: prompt={resp.usage.prompt_tokens || 0} completion={resp.usage.completion_tokens || 0} total={resp.usage.total_tokens || 0}
          {resp.usage.prompt_tokens_details?.cached_tokens ? ` cached=${resp.usage.prompt_tokens_details.cached_tokens}` : ''}
        </div>
      )}
    </div>
  );
}
