// 解析播放身份、时长与真实观看增量，不依赖页面节点。
export function isListPlayback(pathname: string) { return /^\/list\/(?:watchlater|ml\d+)\/?$/.test(pathname); }
export function playbackBvid(pathname: string, search = '') {
  const id = pathname.match(/^\/video\/(BV\w+)\/?$/)?.[1] ||
    (isListPlayback(pathname) ? new URLSearchParams(search).get('bvid') || '' : '');
  return /^BV\w+$/.test(id) ? id : '';
}
export function playbackSeconds(previous: number, current: number, wallSeconds: number, rate: number) {
  const delta = current - previous;
  if (delta <= 0 || wallSeconds <= 0 || delta > wallSeconds * rate + 1) return 0;
  return Math.min(delta / rate, wallSeconds);
}
export function parseDuration(text: string): number | null {
  if (!/^\d+:\d{2}(?::\d{2})?$/.test(text.trim())) return null;
  const parts = text.trim().split(':').map(Number);
  if (parts.slice(1).some(part => part > 59)) return null;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}
