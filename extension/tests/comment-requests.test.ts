// 验证评论后台跨任务统一限速、签名去重和访问限制后的排队停止与冷却恢复。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { Preferences } from '../src/types';

const saved = vi.hoisted(() => ({} as Record<string,unknown>));
vi.mock('wxt/browser',() => ({ browser: { storage: { local: {
  get: async (key: string) => ({ [key]: saved[key] }),
  set: async (value: Record<string,unknown>) => { Object.assign(saved,value); },
} } } }));
import { createCommentService } from '../src/comment-service';
const preferences = async () => ({ settings: migrateSettings() } as Preferences);
const ok = () => new Response(JSON.stringify({ code: 0, data: { aid: 123, title: '示例' } }));
beforeEach(() => { vi.useFakeTimers(); for (const key of Object.keys(saved)) delete saved[key]; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each([100,400])('多个任务共用启动间隔，%s毫秒响应不再额外等待250毫秒', async duration => {
  const starts: number[] = [];
  vi.stubGlobal('fetch',vi.fn(async () => { starts.push(Date.now()); await new Promise(resolve => setTimeout(resolve,duration)); return ok(); }));
  const service = createCommentService(preferences);
  const pending = Promise.all(['BVone','BVtwo','BVthree'].map(bvid => service({ type: 'comments-source', bvid })));
  await vi.advanceTimersByTimeAsync(2000); await pending;
  expect(starts.map(time => time-starts[0]!)).toEqual([0,Math.max(250,duration),2*Math.max(250,duration)]);
});

test('并发主评论任务共用一次签名密钥读取', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch',vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({ code: 0, data: url.endsWith('/nav')
      ? { wbi_img: { img_url: `https://example.com/${'a'.repeat(32)}.png`, sub_url: `https://example.com/${'b'.repeat(32)}.png` } }
      : { replies: [], cursor: { all_count: 0, is_end: true } } }));
  }));
  const service = createCommentService(preferences);
  const pending = Promise.all(['123','456'].map(oid => service({ type: 'comments-page', oid })));
  await vi.advanceTimersByTimeAsync(1000); await pending;
  expect(urls.filter(url => url.endsWith('/nav'))).toHaveLength(1); expect(urls).toHaveLength(3);
});

test('429停止已排队请求，冷却提示跨后台重建保留，过期后可手动重试', async () => {
  const fetch = vi.fn().mockImplementationOnce(async () => new Response('',{ status: 429, headers: { 'Retry-After': '60' } })).mockImplementation(async () => ok());
  vi.stubGlobal('fetch',fetch);
  const service = createCommentService(preferences);
  const pending = Promise.allSettled(['BVone','BVtwo','BVthree'].map(bvid => service({ type: 'comments-source', bvid })));
  await vi.advanceTimersByTimeAsync(1000);
  const results = await pending; expect(results.every(item => item.status === 'rejected')).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
  const restarted = createCommentService(preferences);
  await expect(restarted({ type: 'comments-source', bvid: 'BVnext' })).rejects.toThrow('暂时受限');
  expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);
  await expect(restarted({ type: 'comments-source', bvid: 'BVnext' })).resolves.toMatchObject({ oid: '123' });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([-412,-352])('业务限制%s同样停止后续请求并保存原因', async code => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code, message: '访问受限' }))); vi.stubGlobal('fetch',fetch);
  const service = createCommentService(preferences);
  await expect(service({ type: 'comments-source', bvid: 'BVone' })).rejects.toThrow('访问受限');
  await expect(service({ type: 'comments-source', bvid: 'BVtwo' })).rejects.toThrow('暂时受限');
  expect(fetch).toHaveBeenCalledOnce();
});

test('HTTP日期形式的等待提示被遵守', async () => {
  const until = Date.now()+120000;
  const fetch = vi.fn(async () => new Response('',{ status: 429, headers: { 'Retry-After': new Date(until).toUTCString() } }));
  vi.stubGlobal('fetch',fetch);
  const service = createCommentService(preferences);
  await expect(service({ type: 'comments-source', bvid: 'BVone' })).rejects.toThrow('HTTP 429');
  expect(saved['comment-requests-paused-until']).toBeGreaterThanOrEqual(until-999);
});
