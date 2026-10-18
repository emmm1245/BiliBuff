// 离线验证详情、标签、播放器与字幕共享预算、并发和取消，并对平台限制即时冷却。
import { afterEach, expect, test, vi } from 'vitest';
import { createBrowseNetwork } from '../src/browse-network';
import type { BrowseRequestLog } from '../src/browse-types';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
test.each([412,429])('HTTP %s立即冷却，不再向同来源发送请求，其他来源可读', async status => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('',{ status })).mockResolvedValue(Response.json({ code: 0,data: {} }));
  vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], cooldowns = new Map<string,number>();
  const network = createBrowseNetwork(new AbortController().signal,logs,cooldowns);
  await expect(network.data('/x/web-interface/search/type?q=test')).rejects.toMatchObject({ kind: 'limited' });
  await expect(network.data('/x/web-interface/search/type?q=other')).rejects.toMatchObject({ kind: 'cooldown' });
  const request = network.data('/x/web-interface/view?bvid=BVtest'); await vi.runAllTimersAsync(); await request;
  expect(fetch).toHaveBeenCalledTimes(2); expect(logs.map(log => log.errorKind)).toEqual(['limited','cooldown',undefined]);
  expect(cooldowns.get('search')).toBeGreaterThan(Date.now());
});
test('所有B站请求共同最多180次，详情、标签和字幕都计入，日志不保存查询凭据', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => Response.json({ code: 0,data: {},body: [] })); vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], network = createBrowseNetwork(new AbortController().signal,logs,new Map());
  const run = (async () => {
    for (let i = 0; i < 220; i++) {
      const requests = [() => network.data('/x/web-interface/view?i='+i),() => network.data('/x/tag/archive/tags?i='+i),
        () => network.data('/x/player/wbi/v2?i='+i),() => network.resource('https://aisub.hdslb.com/subtitle.json?token=private')];
      await requests[i%4]!().catch(() => {});
    }
  })();
  await vi.runAllTimersAsync(); await run;
  expect(fetch).toHaveBeenCalledTimes(180); expect(network.remaining).toBe(0);
  expect(logs.some(log => log.kind === 'subtitle')).toBe(true);
  expect(JSON.stringify(logs)).not.toContain('private');
});
test('分项来源预算独立且无效业务码与空结果可区分', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ code: -400,message: 'bad' })).mockImplementation(async () => Response.json({ code: 0,data: { result: [] } }));
  vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], network = createBrowseNetwork(new AbortController().signal,logs,new Map());
  await expect(network.data('/x/web-interface/search/type')).rejects.toMatchObject({ kind: 'business' });
  const run = (async () => { for (let i = 0; i < 4; i++) await network.data('/x/web-interface/wbi/index/top/feed/rcmd').catch(() => {}); })();
  await vi.runAllTimersAsync(); await run;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(logs[0]).toMatchObject({ code: -400,errorKind: 'business' });
  expect(logs.at(-1)).toMatchObject({ errorKind: 'budget' });
});
test('全局最多两路并发，取消后排队请求不再发送', async () => {
  vi.useFakeTimers();
  let active = 0, maximum = 0;
  const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve,reject) => {
    active++; maximum = Math.max(maximum,active);
    const timer = setTimeout(() => { active--; resolve(Response.json({ code: 0,data: {} })); },500);
    init.signal?.addEventListener('abort',() => { clearTimeout(timer); active--; reject(init.signal?.reason); },{ once: true });
  }));
  vi.stubGlobal('fetch',fetch);
  const controller = new AbortController(), network = createBrowseNetwork(controller.signal,[],new Map());
  const requests = Array.from({ length: 8 },(_,i) => network.data('/x/web-interface/view?i='+i).catch(error => error));
  await vi.advanceTimersByTimeAsync(200); expect(maximum).toBe(2);
  controller.abort(); await vi.runAllTimersAsync(); await Promise.all(requests);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('等待请求间隔期间来源进入冷却，不再发送已经排队的同源请求', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => new Response('',{ status: 412 })); vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], network = createBrowseNetwork(new AbortController().signal,logs,new Map());
  const requests = [network.data('/x/web-interface/search/type?q=one'),network.data('/x/web-interface/search/type?q=two')].map(request => request.catch(error => error));
  await vi.runAllTimersAsync(); await Promise.all(requests);
  expect(fetch).toHaveBeenCalledOnce(); expect(logs.filter(log => log.sent)).toHaveLength(1);
  expect(network.remaining).toBe(179);
});
