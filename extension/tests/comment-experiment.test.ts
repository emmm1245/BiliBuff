// 使用模拟响应验证只读实验遇到429、业务拒绝或非JSON响应后停止，不发后续请求。
import { afterEach, expect, test, vi } from 'vitest';
const { createCommentExperiment } = await import(new URL('../scripts/comment-collection-experiment.js',import.meta.url).href);

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test('HTTP 429记录等待提示并停止，后续视频不再发请求', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('Too Many Requests',{ status: 429, headers: { 'Retry-After': '60' } }));
  vi.stubGlobal('fetch',fetch);
  const experiment = createCommentExperiment(() => '');
  await expect(experiment.source('BVtest')).rejects.toThrow('HTTP 429');
  await expect(experiment.source('BVnext')).rejects.toThrow('HTTP 429');
  expect(fetch).toHaveBeenCalledOnce();
  expect(experiment.snapshot().requests[0]).toMatchObject({ http: 429, retryAfter: '60', error: expect.stringContaining('HTTP 429') });
});

test.each([-412,-352,-403])('HTTP 200中的业务拒绝%s也会立即停止', async code => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, message: '站点拒绝' })));
  vi.stubGlobal('fetch',fetch);
  const experiment = createCommentExperiment(() => '');
  await expect(experiment.source('BVtest')).rejects.toThrow(`业务状态 ${code}`);
  await expect(experiment.source('BVnext')).rejects.toThrow(`业务状态 ${code}`);
  expect(fetch).toHaveBeenCalledOnce();
});

test('非JSON响应停止，不将验证页误当作空评论区', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('<html>验证页面</html>'));
  vi.stubGlobal('fetch',fetch);
  const experiment = createCommentExperiment(() => '');
  await expect(experiment.source('BVtest')).rejects.toThrow();
  await expect(experiment.source('BVnext')).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});

test('网络错误保留原因并停止后续请求', async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError('网络中断'));
  vi.stubGlobal('fetch',fetch);
  const experiment = createCommentExperiment(() => '');
  await expect(experiment.source('BVtest')).rejects.toThrow('网络中断');
  await expect(experiment.source('BVnext')).rejects.toThrow('网络中断');
  expect(fetch).toHaveBeenCalledOnce();
});

test('两个楼层任务共用间隔，首个请求遇到429后排队请求不会发出', async () => {
  vi.useFakeTimers(); vi.stubGlobal('performance',{ now: () => Date.now() });
  const fetch = vi.fn().mockImplementation(async () => new Response('',{ status: 429 }));
  vi.stubGlobal('fetch',fetch);
  const experiment = createCommentExperiment(() => '');
  const pending = experiment.replies('123',[{ id: '1', replies: 1 },{ id: '2', replies: 1 }],
    { name: 'stop-queued', gap: 250, concurrency: 2, ps: 20 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({ complete: false, requests: 1 });
  expect(fetch).toHaveBeenCalledOnce();
});
