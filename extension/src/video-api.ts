// 在后台读取B站视频、字幕及媒体地址，只接受已验证的视频编号和本站资源域名。
import { nativeVideoChapters, subtitleRows } from './video-data.ts';
import type { MediaChoice, VideoSource } from './video-types';
import { biliClient, BiliRequestError } from './bili-client';

interface ViewData { aid: number; bvid: string; title: string; pages: { page: number; cid: number; part: string; duration: number }[] }
interface Track { lan: string; lan_doc: string; subtitle_url: string; ai_status?: number }
interface PlayerMetadata { subtitle?: { subtitles?: Track[] }; view_points?: unknown[] }
interface PlayData {
  quality: number; format: string; accept_quality?: number[]; accept_description?: string[];
  durl?: { url: string; backup_url?: string[]; size: number; length: number }[];
  dash?: { video: Stream[]; audio: Stream[] };
}
interface Stream { id: number; baseUrl?: string; base_url?: string; backupUrl?: string[]; backup_url?: string[]; codecs: string; codecid?: number; bandwidth: number; mimeType?: string; mime_type?: string }
const details = new Map<string,{ data: ViewData; at: number }>();
export async function biliVideoJSON<T>(path: string): Promise<T> {
  return biliClient.json<T>(path);
}
export async function videoDetails(bvid: string) {
  if (!/^BV\w+$/.test(bvid)) throw new Error('视频编号无效。');
  const cached = details.get(bvid);
  if (cached && Date.now()-cached.at < 60000) return cached.data;
  const data = await biliVideoJSON<ViewData>(`/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  details.set(bvid,{ data, at: Date.now() });
  if (details.size > 30) details.delete(details.keys().next().value!);
  return data;
}
export async function confirmedPart(bvid: string, cid: number) {
  const data = await videoDetails(bvid), part = data.pages.find(part => part.cid === cid);
  if (!part) throw new Error('当前分P已变化，请重新读取视频。');
  return { data, part };
}
async function tracks(aid: number, cid: number) {
  const data = await biliVideoJSON<PlayerMetadata>(`/x/player/wbi/v2?aid=${aid}&cid=${cid}`);
  return data.subtitle?.subtitles ?? [];
}
export async function readVideoSource(bvid: string, page: number, cid?: number): Promise<VideoSource> {
  const data = await videoDetails(bvid), part = cid ? data.pages.find(p => p.cid === cid) : data.pages.find(p => p.page === page);
  if (!part) throw new Error('没有找到对应分P，请刷新视频页。');
  const source: VideoSource = { bvid, aid: data.aid, cid: part.cid, page: part.page, title: data.title, part: part.part, duration: part.duration,
    parts: data.pages.map(p => ({ page: p.page, cid: p.cid, title: p.part, duration: p.duration })), tracks: [] };
  try {
    const metadata = await biliVideoJSON<PlayerMetadata>(`/x/player/wbi/v2?aid=${data.aid}&cid=${part.cid}`);
    source.tracks = (metadata.subtitle?.subtitles ?? []).map(t => ({ id: t.lan, name: t.lan_doc, ai: !!t.ai_status || t.lan.startsWith('ai-') }));
    source.nativeChapters = nativeVideoChapters(metadata.view_points,source.duration);
  }
  catch (error) { source.subtitleError = error instanceof Error ? error.message : '字幕列表读取失败。'; }
  return source;
}
export function subtitleResource(value: string) {
  const url = new URL(value.startsWith('//') ? `https:${value}` : value);
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'hdslb.com' || url.hostname.endsWith('.hdslb.com'))) throw new Error('字幕资源域名未受支持，未发起请求。');
  return url.href;
}
export async function readVideoRows(source: VideoSource, language: string) {
  const list = await tracks(source.aid,source.cid), track = list.find(t => t.lan === language);
  if (!track) throw new Error('该字幕轨道已不可用，请重新读取字幕列表。');
  const response = await fetch(subtitleResource(track.subtitle_url),{ credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`字幕读取失败（${response.status}），请重试。`);
  const rows = subtitleRows((await response.json()).body);
  if (!rows.length) throw new Error('字幕轨道没有可读内容。');
  return rows;
}
export function mediaResource(value: string) {
  const url = new URL(value.replace(/^http:/,'https:'));
  if (url.protocol !== 'https:' || url.username || url.password || !['bilivideo.com','bilivideo.cn','hdslb.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw new Error('媒体资源域名未受支持，未发起下载。');
  return url.href;
}
export function mediaStreamResource(candidates: string[]) {
  const supported: string[] = [];
  for (const candidate of candidates) {
    try { supported.push(mediaResource(candidate)); } catch { /* 不支持的节点不能阻断同一格式的备用地址。 */ }
  }
  return supported.find(value => { const host = new URL(value).hostname; return host === 'bilivideo.com' || host.endsWith('.bilivideo.com'); }) ?? supported[0];
}
export async function videoMedia(bvid: string, cid: number): Promise<(MediaChoice & { url: string })[]> {
  await confirmedPart(bvid,cid);
  const results: PromiseSettledResult<PlayData>[] = [];
  for (const mode of [{ qn: '64',fnval: '1',fourk: '0' },{ qn: '127',fnval: '4048',fourk: '1' }]) {
    try { results.push({ status: 'fulfilled',value: await biliClient.signed<PlayData>('/x/player/wbi/playurl',{ bvid,cid: String(cid),fnver: '0',...mode }) }); }
    catch (error) {
      results.push({ status: 'rejected',reason: error });
      if (error instanceof BiliRequestError && ['limited','verification','cooldown'].includes(error.kind)) break;
    }
  }
  const choices: (MediaChoice & { url: string })[] = [];
  const qualityName = (data: PlayData, quality: number) => data.accept_description?.[data.accept_quality?.indexOf(quality) ?? -1] || `清晰度 ${quality}`;
  const combined = results[0];
  if (combined?.status === 'fulfilled' && combined.value.durl?.length === 1 && combined.value.format?.startsWith('mp4')) {
    const data = combined.value, stream = data.durl![0]!;
    const url = mediaStreamResource([stream.url,...(stream.backup_url ?? [])]);
    if (url) choices.push({ id: 'mp4', kind: 'video', combined: true, label: `${qualityName(data,data.quality)} · MP4 · 含声音`, quality: data.quality, codec: 'MP4', extension: 'mp4', size: stream.size, url });
  }
  const dash = results[1];
  if (dash?.status === 'fulfilled' && dash.value.dash) {
    const data = dash.value;
    for (const [kind,streams] of [['video',data.dash!.video],['audio',data.dash!.audio]] as const) for (const stream of streams ?? []) {
      const url = mediaStreamResource([stream.baseUrl || stream.base_url || '',...(stream.backupUrl ?? stream.backup_url ?? [])]);
      if (!url) continue;
      const codec = stream.codecs || '', extension = (stream.mimeType || stream.mime_type || '').includes('webm') ? 'webm' : kind === 'audio' ? 'm4a' : 'mp4';
      choices.push({ id: `${kind}:${stream.id}:${codec}`, kind, combined: false, quality: stream.id, codec, extension,
        label: kind === 'video' ? `${qualityName(data,stream.id)} · ${codec.split('.')[0]} · 仅画面` : `${Math.round(stream.bandwidth/1000)} kbps · ${extension.toUpperCase()} 音频`, url });
    }
  }
  if (!choices.length) {
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    throw new Error('未取得可下载的媒体地址，请确认已登录且视频可正常播放。');
  }
  return choices.filter((item,i,list) => list.findIndex(other => other.id === item.id) === i);
}
