import { useState } from 'react';

export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="json-tree">
      <JsonNode data={data} />
    </div>
  );
}

function JsonNode({ data, name, depth = 0 }: { data: unknown; name?: string; depth?: number }) {
  const autoOpen = depth < 2;
  const [open, setOpen] = useState(autoOpen);

  const keyEl = name !== undefined ? <><span className="json-key">"{name}"</span><span>: </span></> : null;

  if (data === null) return <div className="json-line">{keyEl}<span className="json-null">null</span></div>;
  if (data === undefined) return <div className="json-line">{keyEl}<span className="json-null">undefined</span></div>;
  if (typeof data === 'boolean') return <div className="json-line">{keyEl}<span className="json-bool">{String(data)}</span></div>;
  if (typeof data === 'number') return <div className="json-line">{keyEl}<span className="json-num">{data}</span></div>;
  if (typeof data === 'string') return <div className="json-line">{keyEl}<span className="json-str">"{data}"</span></div>;

  const isArray = Array.isArray(data);
  const entries: [string, unknown][] = isArray
    ? (data as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(data as Record<string, unknown>);
  const openBracket = isArray ? '[' : '{';
  const closeBracket = isArray ? ']' : '}';
  const count = entries.length;

  if (count === 0) return <div className="json-line">{keyEl}<span className="json-bracket">{openBracket}{closeBracket}</span></div>;

  return (
    <div className="json-node">
      <div className="json-line json-clickable" onClick={() => setOpen(!open)}>
        {keyEl}
        <span className="json-toggle">{open ? '▼' : '▶'}</span>
        <span className="json-bracket">{openBracket}</span>
        {!open && <span className="json-collapsed"> {count} {isArray ? 'items' : 'keys'} </span>}
        {!open && <span className="json-bracket">{closeBracket}</span>}
      </div>
      {open && (
        <div className="json-children">
          {entries.map(([k, v]) => (
            <JsonNode key={k} data={v} name={isArray ? k : k} depth={depth + 1} />
          ))}
          <div className="json-line"><span className="json-bracket">{closeBracket}</span></div>
        </div>
      )}
    </div>
  );
}
