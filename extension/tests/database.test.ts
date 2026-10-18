// 验证数据库并发去重、导入合并、样本上限和缓存过期。
import 'fake-indexeddb/auto';
import { beforeAll, expect, test } from 'vitest';
import { allEvents, cachedReview, cachedTags, counts, mergeEvents, samples, saveReview, saveTags, TAG_TTL } from '../src/database';
import type { VideoEvent } from '../src/types';

beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('bilibili-focus', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const events = db.createObjectStore('events', { keyPath: ['kind', 'bvid'] });
      events.createIndex('kind', 'kind'); events.createIndex('kindTime', ['kind', 'at']);
      db.createObjectStore('tags', { keyPath: 'bvid' }).put({ bvid: 'BVlegacy', tags: ['旧标签'], time: Date.now() });
    };
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
});

test('升级复核缓存数据库保留旧标签，判定可以持久保存并按期失效', async () => {
  expect((await cachedTags('BVlegacy'))?.tags).toEqual(['旧标签']);
  await saveReview('context-video', 'unrelated'); expect(await cachedReview('context-video')).toBe('unrelated');
  const original = Date.now; Date.now = () => original() + TAG_TTL + 1;
  try { expect(await cachedReview('context-video')).toBeNull(); } finally { Date.now = original; }
});

test('并发写入同类视频去重，不同类型分别累计；导入保留较新记录', async () => {
  const base: VideoEvent = { kind: 'blocked', bvid: 'BVdbtest', title: '初始', tags: null, at: 100, reason: '' };
  await Promise.all([mergeEvents([base]), mergeEvents([{ ...base, title: '较新', at: 200 }]), mergeEvents([{ ...base, kind: 'watched' }])]);
  await mergeEvents([{ ...base, title: '导入最新', at: 300 }, base]);
  const records = (await allEvents()).filter(event => event.bvid === base.bvid);
  expect(records).toHaveLength(2); expect(records.find(event => event.kind === 'blocked')?.title).toBe('导入最新');
  const totals = await counts(); expect(totals.blocked).toBe(1); expect(totals.watched).toBe(1);
});
test('样本按最近发生时间倒序，最多100条', async () => {
  const records: VideoEvent[] = Array.from({ length: 120 }, (_, i) => ({ kind: 'highlight', bvid: `BVsample${i}`, title: `视频${i}`, tags: [], at: i, reason: '' }));
  await mergeEvents(records);
  const recent = await samples('highlight'); expect(recent).toHaveLength(100); expect(recent[0]).toMatchObject({ bvid: 'BVsample119' });
});

test('三类累计独立去重，观看补标签和重复记录不增加计数', async () => {
  const before = await counts();
  const kinds = ['blocked', 'highlight', 'watched'] as const;
  const records = kinds.map(kind => ({ kind, bvid: 'BVtotals', title: '统计测试', tags: null, at: 100, reason: '' }));
  await mergeEvents(records);
  await mergeEvents(records.map(record => ({ ...record, tags: ['学习'], at: 200 })));
  const after = await counts();
  for (const kind of kinds) expect(after[kind]).toBe(before[kind] + 1);
  expect((await allEvents()).filter(record => record.bvid === 'BVtotals')).toHaveLength(3);
});

test('候选查询支持超过500条，补标签保留屏蔽时间，真实再次屏蔽更新时间', async () => {
  const records: VideoEvent[] = Array.from({ length: 600 }, (_, i) => ({ kind: 'blocked', bvid: `BVcandidate${i}`, title: '矩阵运算', tags: null, at: 1000 + i, reason: '严格模式' }));
  await mergeEvents(records);
  expect(await samples('blocked', 525)).toHaveLength(525);
  await mergeEvents([{ ...records[0]!, tags: ['数学'] }]);
  expect((await allEvents()).find(event => event.bvid === 'BVcandidate0')).toMatchObject({ at: 1000, tags: ['数学'] });
  await mergeEvents([{ ...records[0]!, at: 2000 }]);
  expect((await samples('blocked', 1))[0]).toMatchObject({ bvid: 'BVcandidate0', at: 2000, tags: ['数学'] });
});
test('标签缓存命中，过期后不可用', async () => {
  await saveTags('BVcache', ['数学']); expect((await cachedTags('BVcache'))?.tags).toEqual(['数学']);
  const original = Date.now;
  Date.now = () => original() + TAG_TTL + 1;
  try { expect(await cachedTags('BVcache')).toBeNull(); } finally { Date.now = original; }
});
