// 保存完整与部分速读结果的独立缓存，串行写入并仅保留最近30个视频。
import { browser } from 'wxt/browser';
import type { QuickReadResult } from '../comment-types';
const CACHE = 'comment-quick-reads';
export function createCommentResults() {
  let saves: Promise<unknown> = Promise.resolve();
  async function read() { return (await browser.storage.local.get(CACHE))[CACHE] as Record<string, QuickReadResult> | undefined || {}; }
  async function saveResult(result: QuickReadResult) {
    const save = saves.then(async () => {
        const entries = await read(), partial = `${result.bvid}:partial`;
        entries[result.complete ? result.bvid : partial] = result;
        if (result.complete) delete entries[partial];
        const recent = Object.entries(entries).sort(([,a],[,b]) => b.at-a.at);
        const videos = new Set([...new Set(recent.map(([,item]) => item.bvid))].slice(0,30));
        await browser.storage.local.set({ [CACHE]: Object.fromEntries(recent.filter(([,item]) => videos.has(item.bvid))) });
      });
      saves = save.catch(() => {}); await save;
  }
  return { read, save: saveResult };
}
