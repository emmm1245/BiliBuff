// 读取B站候选、完整分P目录和时长，只抽样第一P字幕作为内容证据。
import { requestTags } from './tags';
import { subtitleResource } from './video-api';
import type { BrowseEvidence, BrowseVideo } from './browse-types';

interface RawVideo {
  bvid?: string; title?: string; author?: string; mid?: number; owner?: { name: string; mid: number };
  pic?: string; duration?: number | string; pubdate?: number; description?: string; desc?: string;
  tag?: string; goto?: string; type?: string; is_pay?: number; is_charge_video?: boolean;
}
export function plainBrowseText(value = '') {
  const entities: Record<string,string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/<[^>]*>/g,'').replace(/&(amp|quot|apos|lt|gt|nbsp);/g,(_,key: string) => entities[key]!).trim();
}
export function browseDuration(value: number | string = 0) {
  if (typeof value === 'number') return Math.max(0,value);
  if (!/^\d+(?::\d{1,2}){1,2}$/.test(value)) return 0;
  return value.split(':').reduce((total,part) => total*60+Number(part),0);
}
function coverURL(value = '') {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.protocol === 'https:' && (url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com')) ? url.href : '';
  } catch { return ''; }
}
export function browseVideo(value: RawVideo, source: BrowseVideo['sources'][number]): BrowseVideo | null {
  if (!/^BV\w+$/.test(value.bvid ?? '') || !value.title || (value.goto && value.goto !== 'av') ||
      (value.type && value.type !== 'video') || value.is_pay || value.is_charge_video) return null;
  return { bvid: value.bvid!, title: plainBrowseText(value.title), author: value.owner?.name ?? value.author ?? '',
    authorId: String(value.owner?.mid ?? value.mid ?? ''), cover: coverURL(value.pic), duration: browseDuration(value.duration),
    published: value.pubdate ?? 0, description: plainBrowseText(value.desc || value.description).slice(0,2000),
    tags: (value.tag ?? '').split(',').map(tag => tag.trim()).filter(Boolean).slice(0,20), sources: [source] };
}
async function json<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`https://api.bilibili.com${path}`,{ credentials: 'include', signal: AbortSignal.any([signal,AbortSignal.timeout(15000)]) });
  if (!response.ok) throw new Error(`B站读取失败（${response.status}）。`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(`B站返回：${result.message || result.code}。`);
  return result.data as T;
}
function videos(items: RawVideo[], source: BrowseVideo['sources'][number]) {
  return items.map(item => browseVideo(item,source)).filter((item): item is BrowseVideo => item !== null);
}
export async function browseHome(signal: AbortSignal) {
  const data = await json<{ item: RawVideo[] }>('/x/web-interface/wbi/index/top/feed/rcmd?fresh_type=3&ps=20',signal);
  return videos(data.item,'home');
}
export async function browseSearch(keyword: string, order: 'totalrank' | 'pubdate', page: number, signal: AbortSignal) {
  const params = new URLSearchParams({ search_type: 'video', keyword, order, page: String(page) });
  const data = await json<{ result: RawVideo[] }>(`/x/web-interface/search/type?${params}`,signal);
  return videos(data.result,'search');
}
export async function browseRelated(bvid: string, signal: AbortSignal) {
  return videos(await json<RawVideo[]>(`/x/web-interface/archive/related?bvid=${encodeURIComponent(bvid)}`,signal),'related');
}
export function subtitleExcerpt(rows: { content: string }[]) {
  // 均匀抽取整段字幕，不把开场白当作全部内容；明确保留抽样范围。
  const count = Math.min(rows.length,60);
  return Array.from({ length: count },(_,i) => rows[Math.floor(i*(rows.length-1)/Math.max(1,count-1))]!.content.slice(0,90)).join('\n');
}
export async function browseEvidence(video: BrowseVideo, signal: AbortSignal): Promise<BrowseEvidence> {
  const data = await json<RawVideo & { aid: number; pages: { cid: number; part: string; duration?: number }[]; state: number; rights?: { pay?: number }; is_upower_exclusive?: boolean }>(`/x/web-interface/view?bvid=${video.bvid}`,signal);
  if (data.state < 0 || data.rights?.pay || data.is_upower_exclusive) throw new Error('视频不可用或需要额外付费。');
  // 标签失败不应丢弃仍有完整简介和目录的视频。
  const tags = await new Promise<string[]>((resolve,reject) => {
    signal.throwIfAborted();
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort',aborted,{ once: true });
    void requestTags(video.bvid).catch(() => video.tags).then(resolve).finally(() => signal.removeEventListener('abort',aborted));
  });
  signal.throwIfAborted();
  const updated = browseVideo(data,video.sources[0]!)!;
  const detail = { ...video, ...updated, cover: updated.cover || video.cover, sources: video.sources, tags };
  const chapters = data.pages.map((part,index) => ({ page: index+1,cid: part.cid,title: plainBrowseText(part.part),duration: part.duration ?? 0 }));
  const evidence: BrowseEvidence = { ...detail,partCount: chapters.length,parts: chapters.map(part => part.title),chapters,excerpt: '',coverage: '视频简介、标签、完整分P标题和各P时长；尚未核验字幕' };
  if (!data.pages[0]) return evidence;
  try {
    const player = await json<{ subtitle?: { subtitles?: { lan: string; subtitle_url: string }[] } }>(`/x/player/wbi/v2?aid=${data.aid}&cid=${data.pages[0].cid}`,signal);
    const tracks = player.subtitle?.subtitles ?? [];
    const track = tracks.find(t => /^(?:ai-)?zh/.test(t.lan)) ?? tracks[0];
    if (track) {
      const response = await fetch(subtitleResource(track.subtitle_url),{ credentials: 'omit', signal: AbortSignal.any([signal,AbortSignal.timeout(15000)]), redirect: 'error' });
      if (!response.ok) throw new Error('字幕读取失败。');
      const rows = (await response.json()).body as { content: string }[];
      evidence.excerpt = subtitleExcerpt(rows);
      if (evidence.excerpt) { evidence.checkedPage = 1; evidence.coverage = `第1分P字幕分散抽样（${data.pages.length}个分P），后续分P仅有目录与时长，非完整视频核验`; }
    }
  } catch { signal.throwIfAborted(); /* 无字幕时保留真实的元信息证据范围，由精选阶段严格判断。 */ }
  return evidence;
}
