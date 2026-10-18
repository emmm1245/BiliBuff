// 离线验证标签接口迁移、主题过滤、缓存写失败和来源受限时的队列退出。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const cache = vi.hoisted(() => ({ read: vi.fn(),save: vi.fn() }));
vi.mock('../src/database',() => ({ cachedTags: cache.read,saveTags: cache.save }));
vi.mock('wxt/browser',() => ({ browser: { storage: { local: { get: async () => ({}),set: async () => {} } } } }));
beforeEach(() => { vi.resetModules(); cache.read.mockReset().mockResolvedValue(null); cache.save.mockReset().mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllGlobals());
test('新接口保留主题和话题，过滤BGM并去重；缓存写入失败仍返回有效标签',async () => {
  const { requestTags } = await import('../src/tags'); const { biliClient } = await import('../src/bili-client');
  cache.save.mockRejectedValueOnce(new Error('disk full'));
  const fetch = vi.fn(async () => Response.json({ code: 0,data: [{ tag_name: ' 数学 ',tag_type: 'old_channel' },{ tag_name: '矩阵',tag_type: 'topic' },{ tag_name: '背景曲',tag_type: 'bgm' },{ tag_name: '矩阵' }] })); vi.stubGlobal('fetch',fetch);
  const first = requestTags('BVtags'); expect(requestTags('BVtags')).toBe(first);
  expect(await first).toEqual(['数学','矩阵']);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.bilibili.com/x/web-interface/view/detail/tag?bvid=BVtags',expect.objectContaining({ credentials: 'omit' }));
  expect((await biliClient.diagnostics()).logs.at(-1)).toMatchObject({ errorKind: 'cache',sent: false });
  expect(biliClient.cooldown('tags')).toBe(0);
});
test('受限后后续排队任务立即退出，冷却期间已缓存标签仍可用',async () => {
  const { requestTags } = await import('../src/tags');
  const fetch = vi.fn(async () => new Response('',{ status: 412 })); vi.stubGlobal('fetch',fetch);
  await expect(requestTags('BVfirst')).rejects.toMatchObject({ kind: 'limited' });
  const results = await Promise.allSettled(Array.from({ length: 6 },(_,i) => requestTags('BVqueued'+i)));
  expect(results.every(item => item.status === 'rejected' && item.reason.kind === 'cooldown')).toBe(true);
  cache.read.mockResolvedValueOnce({ tags: ['缓存主题'] }); expect(await requestTags('BVcached')).toEqual(['缓存主题']);
  expect(fetch).toHaveBeenCalledOnce();
});
test('响应缺失列表与真正的空标签区分，缓存读取失败仍允许正常请求',async () => {
  const { requestTags } = await import('../src/tags'); const { biliClient } = await import('../src/bili-client');
  cache.read.mockRejectedValueOnce(new Error('cache read'));
  vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({ code: 0,data: {} })).mockResolvedValueOnce(Response.json({ code: 0,data: [] })));
  await expect(requestTags('BVinvalid')).rejects.toMatchObject({ kind: 'invalid' });
  expect(await requestTags('BVempty')).toEqual([]);
  expect((await biliClient.diagnostics()).logs.map(log => log.errorKind)).toEqual(['cache',undefined,'invalid',undefined]);
});
