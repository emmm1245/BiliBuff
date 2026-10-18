// 在扩展后台统一控制视频标签请求的缓存、去重、并发和失败冷却。
import { cachedTags, saveTags } from './database';
import { biliClient } from './bili-client';
import { themeTags } from './tag-data';

const pending = new Map<string, Promise<string[]>>();
const queue: Array<() => Promise<void>> = [];
let active = 0;
function pump() {
  while (active < 2 && queue.length) {
    active++;
    void queue.shift()!().finally(() => { active--; pump(); });
  }
}
export function requestTags(bvid: string): Promise<string[]> {
  if (!/^BV\w+$/.test(bvid)) return Promise.reject(new Error('视频编号无效。'));
  const existing = pending.get(bvid);
  if (existing) return existing;
  const request = new Promise<string[]>((resolve, reject) => {
    queue.push(async () => {
      try {
        const path = `/x/web-interface/view/detail/tag?bvid=${encodeURIComponent(bvid)}`;
        const cache = await cachedTags(bvid).catch(async () => { await biliClient.note(path,'cache'); return null; });
        if (cache) { resolve(cache.tags); return; }
        const data = await biliClient.json<unknown>(path,{ credentials: 'omit',timeout: 8000 });
        let tags: string[];
        try { tags = themeTags(data); } catch (error) { await biliClient.note(path,'invalid'); throw error; }
        await saveTags(bvid, tags).catch(() => biliClient.note(path,'cache'));
        resolve(tags);
      } catch (error) {
        reject(error);
      }
    });
    pump();
  }).finally(() => pending.delete(bvid));
  pending.set(bvid, request);
  return request;
}
