// 在可信后台持久保存按视频、分P和语言隔离的字幕及分析结果，并串行合并并发更新。
import { browser } from 'wxt/browser';
import { videoKey } from './video-data';
import type { VideoCache } from './video-types';

const KEY = 'video-workbench-cache';
let writes: Promise<unknown> = Promise.resolve();
async function entries() { return (await browser.storage.local.get(KEY))[KEY] as Record<string,VideoCache> | undefined || {}; }
export async function readVideoCache(bvid: string, cid: number, language: string) { await writes; return (await entries())[videoKey(bvid,cid,language)] ?? null; }
export function updateVideoCache(bvid: string, cid: number, language: string, update: (previous: VideoCache | null) => VideoCache | null) {
  const task = writes.then(async () => {
    const saved = await entries(), key = videoKey(bvid,cid,language), next = update(saved[key] ?? null);
    if (next) saved[key] = next; else delete saved[key];
    const recent = Object.entries(saved).sort(([,a],[,b]) => b.at-a.at);
    // 字幕也可能很长，条数和总字符量同时限定；单个最新分P始终保留。
    let used = 0;
    const kept = recent.filter(([,value],i) => { used += JSON.stringify(value).length; return i === 0 || (i < 40 && used <= 10000000); });
    await browser.storage.local.set({ [KEY]: Object.fromEntries(kept) });
    return next;
  });
  writes = task.catch(() => {}); return task;
}
export async function clearVideoPart(bvid: string, cid: number) {
  const task = writes.then(async () => {
    const saved = await entries();
    for (const [key,value] of Object.entries(saved)) if (value.source.bvid === bvid && value.source.cid === cid) delete saved[key];
    await browser.storage.local.set({ [KEY]: saved });
  });
  writes = task.catch(() => {}); await task;
}
