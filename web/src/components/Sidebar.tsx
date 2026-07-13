import type { RequestListItem } from '../types';
import { fmtTime, fmtDur, cacheHitRate } from '../utils';

interface Props {
  items: RequestListItem[];
  currentId: string | null;
  onSelect: (id: string) => void;
  sidebarVisible: boolean;
  overlay: boolean;
}

export function Sidebar({ items, currentId, onSelect, sidebarVisible, overlay }: Props) {
  return (
    <aside className={`sidebar ${sidebarVisible ? '' : 'hidden'} ${overlay ? 'overlay' : ''}`}>
      {items.length === 0 ? (
        <div className="empty">暂无请求</div>
      ) : (
        items.map(it => {
          const dur = it.duration_ms ? fmtDur(it.duration_ms) : '';
          const tok = it.total_tokens ? `↑${it.prompt_tokens} ↓${it.completion_tokens}` : '';
          const cache = it.cached_tokens && it.cached_tokens > 0
            ? `cache ${cacheHitRate(it.prompt_tokens, it.cached_tokens).toFixed(0)}%` : '';
          return (
            <div
              key={it.id}
              className={`req-item ${it.id === currentId ? 'active' : ''}`}
              onClick={() => onSelect(it.id)}
            >
              <div className="row1">
                <span className="model">{it.model || '-'}</span>
                <span className="time">{fmtTime(it.timestamp)}</span>
              </div>
              <div className="meta">
                <span className={`tag ${it.response_source}`}>{it.response_source}</span>
                <span className="tag">{it.messages_count}msg</span>
                {dur && <span className="tag dur">{dur}</span>}
                {tok && <span className="tag tok">{tok}</span>}
                {cache && <span className="tag cache">{cache}</span>}
                <span className="tag">{it.hash}</span>
                {it.error && <span className="tag error">err</span>}
                {it.proxy_status && <span className="tag">{it.proxy_status}</span>}
              </div>
            </div>
          );
        })
      )}
    </aside>
  );
}
