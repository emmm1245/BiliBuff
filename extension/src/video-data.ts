// 提供字幕导出、章节校验、完整输入分块及视频工作台的纯数据处理。
import type { SubtitleRow, VideoCache, VideoChapter, VideoSource, VideoTimelineChapter } from './video-types';
import { estimateVideoTokens, videoInputBudget } from './video-ai.ts';
export function nativeVideoChapters(value: unknown, duration: number): VideoTimelineChapter[] {
  if (!Array.isArray(value)) return [];
  const chapters = value.filter(row => row?.type === 2 && Number.isFinite(row.from) && Number.isFinite(row.to) && row.from >= 0 && row.to > row.from && row.from < duration && typeof row.content === 'string' && row.content.trim())
    .map(row => ({ start: row.from as number, end: Math.min(row.to,duration), title: row.content.trim() as string, summary: '', ad: false })).sort((a,b) => a.start-b.start);
  return chapters.some((chapter,i) => i > 0 && chapter.start < chapters[i-1]!.end) ? [] : chapters;
}
export function videoTimeline(source: VideoSource | null, cache: VideoCache | null): VideoTimelineChapter[] {
  if (source?.nativeChapters?.length) return source.nativeChapters;
  if (!cache || cache.source.cid !== source?.cid) return [];
  return cache.chapters?.value.map(chapter => ({ start: cache.rows[chapter.first]!.start, end: cache.rows[chapter.last]!.end, title: chapter.title, summary: chapter.summary, ad: chapter.ad })) ?? [];
}
const videoReference = /\[\[\s*(\d+(?:\s*[-–—]\s*\d+)?(?:\s*,\s*\d+(?:\s*[-–—]\s*\d+)?)*)\s*\]\]/g;
export function videoAnswerText(text: string, streaming = false) {
  const answer = text.replace(videoReference,'');
  return streaming ? answer.replace(/\[\[[\d,\s–—-]*\]?$|\[$/g,'') : answer;
}
export function videoAnswer(text: string, first: number, last: number, allowedRefs?: ReadonlySet<number>) {
  // 区间仅生成起始字幕的定位入口，避免连续多行挤占六条来源名额。
  const refs = [...new Set([...text.matchAll(videoReference)].flatMap(match => match[1]!.split(',').flatMap(ref => {
    const [start, end = start] = ref.split(/[-–—]/).map(Number) as [number, number?];
    return start >= first && end >= start && end <= last ? [start] : [];
  })))]
    .filter(id => id >= first && id <= last && (!allowedRefs || allowedRefs.has(id))).slice(0,6);
  const answer = videoAnswerText(text).trim();
  if (!answer) throw new Error('模型未返回有效正文，请重试。');
  return { answer, refs };
}

export function videoKey(bvid: string, cid: number, language: string) { return `${bvid}:${cid}:${language}`; }
export function videoRoute(pathname: string, search: string) {
  const params = new URLSearchParams(search);
  const bvid = pathname.match(/^\/video\/(BV\w+)\/?$/)?.[1] || (/^\/list\/(?:watchlater|ml\d+)\/?$/.test(pathname) ? params.get('bvid') || '' : '');
  const page = Number(params.get('p') || 1), cid = Number(params.get('cid') || 0);
  return { bvid: /^BV\w+$/.test(bvid) ? bvid : '', page: Number.isSafeInteger(page) && page > 0 ? page : 1, ...(Number.isSafeInteger(cid) && cid > 0 ? { cid } : {}) };
}
export function clock(seconds: number) {
  const n = Math.max(0,Math.floor(seconds));
  return `${n >= 3600 ? `${Math.floor(n/3600)}:` : ''}${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
}
export function subtitleRows(value: unknown): SubtitleRow[] {
  if (!Array.isArray(value)) throw new Error('字幕正文格式异常，请重新读取。');
  return value.map(row => ({ start: Number(row.from), end: Number(row.to), text: String(row.content ?? '').trim() }))
    .filter(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.start >= 0 && row.end > row.start && row.text)
    .sort((a,b) => a.start-b.start);
}
export async function subtitleFingerprint(rows: SubtitleRow[]) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)));
  return Array.from(new Uint8Array(digest),n => n.toString(16).padStart(2,'0')).join('');
}
export function subtitleText(cache: VideoCache, format: 'text' | 'timed' | 'srt') {
  const time = (n: number) => {
    const ms = Math.round(n*1000), s = Math.floor(ms/1000);
    return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;
  };
  if (format === 'srt') return cache.rows.map((r,i) => `${i+1}\n${time(r.start)} --> ${time(r.end)}\n${r.text}\n`).join('\n');
  return [cache.source.part && cache.source.part !== cache.source.title ? `${cache.source.title} · ${cache.source.part}` : cache.source.title,`https://www.bilibili.com/video/${cache.source.bvid}/?p=${cache.source.page}`,'',
    ...cache.rows.map(r => format === 'timed' ? `[${clock(r.start)}] ${r.text}` : r.text)].join('\n');
}
export function indexedChunks(rows: SubtitleRow[], maxTokens = videoInputBudget({ providerId: '', model: '' })) {
  const chunks: { first: number; last: number; text: string }[] = []; let text = '', first = 0, size = 0;
  rows.forEach((r,i) => {
    const line = `${i} [${clock(r.start)}–${clock(r.end)}] ${r.text}\n`;
    const tokens = estimateVideoTokens(JSON.stringify(line));
    if (tokens > maxTokens) throw new Error('单句字幕超过当前输入预算，请核对上下文容量或降低输出上限。');
    if (text && size+tokens > maxTokens) { chunks.push({ first, last: i-1, text }); text = ''; first = i; size = 0; }
    text += line; size += tokens;
  });
  if (text) chunks.push({ first, last: rows.length-1, text });
  return chunks;
}
export function validateChapters(value: unknown, rows: SubtitleRow[]): VideoChapter[] {
  if (!Array.isArray(value) || !value.length) throw new Error('模型未返回有效章节，请重试。');
  const chapters = value.map(item => {
    if (!item || !Number.isInteger(item.first) || !Number.isInteger(item.last) || item.first < 0 || item.last < item.first || item.last >= rows.length ||
        typeof item.title !== 'string' || !item.title.trim() || typeof item.summary !== 'string' || typeof item.ad !== 'boolean') throw new Error('章节引用不属于当前字幕，未保存结果。');
    return { first: item.first, last: item.last, title: item.title.trim(), summary: item.summary, ad: item.ad };
  }).sort((a,b) => a.first-b.first);
  if (chapters.some((c,i) => i > 0 && c.first <= chapters[i-1]!.last)) throw new Error('章节范围重叠，未保存结果，请重试。');
  return chapters;
}
export function safeFilename(value: string) { return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,100) || 'B站视频'; }
export function activeSubtitle(rows: SubtitleRow[], seconds: number) {
  let low = 0, high = rows.length-1, index = -1;
  while (low <= high) { const mid = (low+high)>>>1; if (rows[mid]!.start <= seconds) { index = mid; low = mid+1; } else high = mid-1; }
  return index >= 0 && seconds < rows[index]!.end ? index : -1;
}
