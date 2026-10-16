// 验证速读结果跨后台重建恢复，部分结果持久保存且不覆盖已有完整结果。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { Preferences } from '../src/types';
import type { CommentMessage, QuickReadResult } from '../src/comment-types';

const saved = vi.hoisted(() => ({} as Record<string,unknown>));
vi.mock('wxt/browser',() => ({ browser: { storage: { local: {
  get: async (key: string) => ({ [key]: saved[key] }),
  set: async (value: Record<string,unknown>) => { Object.assign(saved,value); },
} } } }));
import { createCommentService } from '../src/comment-service';
const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'test', result: null };
const request = (complete: boolean, bvid = 'BVtest'): CommentMessage => ({ type: 'comments-analyze', requestId: crypto.randomUUID(),
  source: { bvid, oid: '123', title: '缓存测试' }, total: 1, expected: complete ? 1 : 20, complete,
  comments: [{ id: '1', root: '0', parent: '0', text: '有内容的评论', author: '', time: 1, likes: 0, replies: 0 }],
});
beforeEach(() => {
  vi.useFakeTimers(); for (const key of Object.keys(saved)) delete saved[key];
  vi.stubGlobal('fetch',vi.fn(async () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ summary: '缓存总览', topics: [], valuable: [] }) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`)));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('完整速读持久保存，重建后台仍可恢复且无需再次调用模型', async () => {
  const result = await createCommentService(async () => prefs)(request(true));
  expect(await createCommentService(async () => prefs)({ type: 'comments-cache', bvid: 'BVtest' })).toEqual(result);
  expect(fetch).toHaveBeenCalledOnce();
});

test('部分速读同样在刷新后恢复，并保留不完整标记', async () => {
  const result = await createCommentService(async () => prefs)(request(false));
  expect(await createCommentService(async () => prefs)({ type: 'comments-cache', bvid: 'BVtest' })).toEqual(result);
  expect(result).toMatchObject({ complete: false, expected: 20 });
});

test('新的部分结果与已有完整结果同时保留，完成新分析后移除旧部分副本', async () => {
  const service = createCommentService(async () => prefs);
  const full = await service(request(true)); vi.setSystemTime(Date.now()+1000);
  const partial = await service(request(false));
  const entries = saved['comment-quick-reads'] as Record<string,QuickReadResult>;
  expect(Object.values(entries)).toContainEqual(full); expect(Object.values(entries)).toContainEqual(partial);
  expect(await createCommentService(async () => prefs)({ type: 'comments-cache', bvid: 'BVtest' })).toEqual(partial);
  vi.setSystemTime(Date.now()+1000); const latest = await service(request(true));
  expect(Object.values(saved['comment-quick-reads'] as object)).toEqual([latest]);
});

test('按30个视频淘汰，完整与部分双副本不会挤占两个视频名额', async () => {
  const service = createCommentService(async () => prefs);
  for (let index = 0; index < 31; index++) {
    vi.setSystemTime(Date.now()+1000); await service(request(true,`BVvideo${index}`));
    vi.setSystemTime(Date.now()+1000); await service(request(false,`BVvideo${index}`));
  }
  const entries = Object.values(saved['comment-quick-reads'] as Record<string,QuickReadResult>);
  expect(new Set(entries.map(result => result.bvid)).size).toBe(30);
  expect(entries).toHaveLength(60); expect(entries.some(result => result.bvid === 'BVvideo0')).toBe(false);
});
