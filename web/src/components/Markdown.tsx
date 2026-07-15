import React from 'react';

export function Markdown({ text }: { text: string }) {
  if (!text || !text.trim()) return null;
  const segments = text.split(/```/);
  return (
    <div className="markdown-body">
      {segments.map((seg, i) => {
        if (i % 2 === 1) {
          const lines = seg.split('\n');
          const firstLine = lines[0].trim();
          const isLang = /^[a-zA-Z0-9+#-]+$/.test(firstLine) && lines.length > 1;
          const code = isLang ? lines.slice(1).join('\n').replace(/\n$/, '') : seg.replace(/^\n/, '').replace(/\n$/, '');
          const lang = isLang ? firstLine : '';
          return (
            <pre key={i} className="md-code-block">
              {lang && <span className="md-code-lang">{lang}</span>}
              <code>{code}</code>
            </pre>
          );
        }
        return <MdBlock key={i} text={seg} />;
      })}
    </div>
  );
}

function MdBlock({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listItems: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  let key = 0;

  function flushPara() {
    if (para.length > 0) {
      elements.push(<p key={`p-${key++}`}>{renderInline(para.join(' '))}</p>);
      para = [];
    }
  }
  function flushList() {
    if (listItems.length > 0) {
      if (listType === 'ol') elements.push(<ol key={`ol-${key++}`}>{listItems}</ol>);
      else elements.push(<ul key={`ul-${key++}`}>{listItems}</ul>);
      listItems = [];
      listType = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') { flushPara(); flushList(); continue; }

    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushPara(); flushList();
      const level = headerMatch[1].length;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      elements.push(<Tag key={`h-${key++}`}>{renderInline(headerMatch[2])}</Tag>);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushPara(); flushList();
      elements.push(<blockquote key={`b-${key++}`}>{renderInline(trimmed.substring(2))}</blockquote>);
      continue;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushPara();
      if (listType && listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(<li key={`li-${key++}`}>{renderInline(ulMatch[1])}</li>);
      continue;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      flushPara();
      if (listType && listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(<li key={`li-${key++}`}>{renderInline(olMatch[1])}</li>);
      continue;
    }

    flushList();
    para.push(trimmed);
  }
  flushPara(); flushList();
  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/;

  while (remaining) {
    const match = remaining.match(pattern);
    if (!match || match.index === undefined) { tokens.push(remaining); break; }
    const idx = match.index;
    if (idx > 0) tokens.push(remaining.substring(0, idx));
    const token = match[0];
    if (token.startsWith('`')) {
      tokens.push(<code key={key++} className="md-inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      tokens.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      tokens.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('[')) {
      const lm = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (lm) tokens.push(<a key={key++} href={lm[2]} target="_blank" rel="noopener noreferrer">{lm[1]}</a>);
      else tokens.push(token);
    } else { tokens.push(token); }
    remaining = remaining.substring(idx + token.length);
  }
  return <>{tokens}</>;
}
