// 串行保存七天展示历史、小型待推荐池和有界选片日志，保护迟到反馈。
import { browser } from 'wxt/browser';
import type { BrowseMemory } from './browse-types';

export const BROWSE_KEY = 'bilibuff-browse';
export const BROWSE_SEEN_AGE = 7 * 86400000;
export const BROWSE_POOL_AGE = 3 * 86400000;
let writes: Promise<unknown> = Promise.resolve();
const empty = (): BrowseMemory => ({ context: '', items: [], updatedAt: 0, round: 0, queries: [], seen: [], feedback: [] });
export async function readBrowseMemory(): Promise<BrowseMemory> {
  await writes;
  return (await browser.storage.local.get(BROWSE_KEY))[BROWSE_KEY] as BrowseMemory | undefined ?? empty();
}
export function updateBrowseMemory(update: (memory: BrowseMemory) => BrowseMemory) {
  const task = writes.then(async () => {
    const saved = (await browser.storage.local.get(BROWSE_KEY))[BROWSE_KEY] as BrowseMemory | undefined;
    const next = update(saved ?? empty());
    const now = Date.now();
    next.seen = [...new Map(next.seen.filter(item => now - item.at < BROWSE_SEEN_AGE).map(item => [item.bvid,item])).values()].slice(-200);
    next.feedback = next.feedback.sort((a,b) => b.at-a.at).slice(0,500);
    next.queries = next.queries.slice(-40);
    const excluded = new Set([...next.seen.map(item => item.bvid),...next.feedback.filter(item => item.vote === -1).map(item => item.video.bvid)]);
    next.pool = [...new Map((next.pool ?? []).filter(item => now-item.checkedAt < BROWSE_POOL_AGE && !excluded.has(item.video.bvid)).map(item => [item.video.bvid,item])).values()].slice(0,36);
    next.logs = (next.logs ?? []).slice(-20);
    await browser.storage.local.set({ [BROWSE_KEY]: next });
    return next;
  });
  writes = task.catch(() => {});
  return task;
}
