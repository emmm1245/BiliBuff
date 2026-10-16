// 读取 B 站官方搜索联想，并按原站格式处理最近 20 条搜索历史。
export interface SearchHistoryEntry { value: string; timestamp: number }

export function parseSearchHistory(raw: unknown): SearchHistoryEntry[] {
  if (raw !== null && typeof raw !== 'string') throw new Error('暂时无法读取 B 站搜索历史。');
  const data: unknown = JSON.parse(raw || '[]');
  if (!Array.isArray(data) || data.some(item => typeof item?.value !== 'string' || typeof item?.timestamp !== 'number')) throw new Error('搜索历史格式已变化。');
  return data;
}

export function addSearchHistory(entries: SearchHistoryEntry[], value: string, timestamp = Date.now()): SearchHistoryEntry[] {
  return [{ value, timestamp }, ...entries.filter(item => item.value !== value)].slice(0, 20);
}

export async function requestSuggestions(term: string): Promise<string[]> {
  if (typeof term !== 'string' || term.length > 100) throw new Error('搜索词最多 100 字。');
  if (!term.trim()) return [];
  const url = new URL('https://api.bilibili.com/x/web-interface/suggest');
  url.searchParams.set('highlight', '0'); url.searchParams.set('term', term);
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  if (!response.ok || data?.code !== 0 || !Array.isArray(data.data?.result?.tag)) throw new Error('搜索联想暂不可用。');
  return [...new Set<string>(data.data.result.tag.map((item: { value?: unknown }) => item.value).filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())))].slice(0, 10);
}
