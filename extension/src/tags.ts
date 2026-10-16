// 在扩展后台统一控制视频标签请求的缓存、去重、并发和失败冷却。
import { cachedTags, saveTags } from './database';

const pending = new Map<string, Promise<string[]>>();
const queue: Array<() => Promise<void>> = [];
let active = 0;
let cooldown = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
function pump() {
  clearTimeout(timer);
  if (Date.now() < cooldown) { timer = setTimeout(pump, cooldown - Date.now()); return; }
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
        const cache = await cachedTags(bvid);
        if (cache) { resolve(cache.tags); return; }
        const response = await fetch(`https://api.bilibili.com/x/tag/archive/tags?bvid=${encodeURIComponent(bvid)}`, {
          credentials: 'omit', signal: AbortSignal.timeout(8000),
        });
        const data = await response.json();
        if (!response.ok || data?.code !== 0 || !Array.isArray(data.data)) throw new Error('标签服务暂不可用。');
        const tags: string[] = data.data.map((tag: { tag_name?: string }) => tag.tag_name).filter((name: unknown): name is string => typeof name === 'string');
        await saveTags(bvid, tags);
        resolve(tags);
      } catch {
        cooldown = Date.now() + 30000;
        reject(new Error('标签查询失败，请稍后手动重试。'));
      }
    });
    pump();
  }).finally(() => pending.delete(bvid));
  pending.set(bvid, request);
  return request;
}
