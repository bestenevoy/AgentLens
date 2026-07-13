export function fmtDur(ms?: number): string {
  if (!ms) return '';
  if (ms >= 500) return (ms / 1000).toFixed(2) + 's';
  return ms + 'ms';
}

export function cacheHitRate(prompt?: number, cached?: number): number {
  if (!prompt || prompt === 0) return 0;
  return (cached || 0) / prompt * 100;
}

export function esc(s: unknown): string {
  return String(s ?? '');
}

export function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false });
}
