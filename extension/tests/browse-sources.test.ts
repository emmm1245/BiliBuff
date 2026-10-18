// 验证来源退避、取消、请求总预算和连续失败冷却都能有限终止。
import { afterEach, expect, test, vi } from 'vitest';
import { createBrowseSources } from '../src/browse-sources';
import type { BrowseSourceAttempt } from '../src/browse-types';

afterEach(() => vi.useRealTimers());
test('412立即冷却，同来源不继续补试，其他来源仍可使用', async () => {
  vi.useFakeTimers();
  const logs: BrowseSourceAttempt[] = [], cooldowns = new Map<string,number>();
  const sources = createBrowseSources(new AbortController().signal,logs,cooldowns);
  const request = vi.fn().mockRejectedValue(new Error('B站读取失败（412）。'));
  const pending = sources.collect('搜索','search',request);
  await vi.runAllTimersAsync(); await pending;
  await sources.collect('其他搜索','search',request);
  expect(request).toHaveBeenCalledOnce(); expect(logs.map(item => item.attempt)).toEqual([1,0]);
  expect(cooldowns.get('search')).toBeGreaterThan(Date.now());
  const home = vi.fn().mockResolvedValue([]); await sources.collect('首页','home',home);
  expect(home).toHaveBeenCalledOnce();
});
test('临时错误恢复后返回内容，整轮最多24次来源请求', async () => {
  vi.useFakeTimers();
  const logs: BrowseSourceAttempt[] = [];
  const sources = createBrowseSources(new AbortController().signal,logs,new Map());
  const request = vi.fn().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue([]);
  const pending = sources.collect('首页','home',request); await vi.runAllTimersAsync(); await pending;
  for (let i = 0; i < 30; i++) await sources.collect('首页','home',request);
  expect(request).toHaveBeenCalledTimes(24); expect(sources.remaining).toBe(0);
});
test('取消会结束退避等待，不发送下一次请求', async () => {
  vi.useFakeTimers();
  const controller = new AbortController(), request = vi.fn().mockRejectedValue(new Error('HTTP 503'));
  const sources = createBrowseSources(controller.signal,[],new Map());
  const pending = sources.collect('搜索','search',request);
  const check = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1); controller.abort(); await check;
  expect(request).toHaveBeenCalledOnce();
});
