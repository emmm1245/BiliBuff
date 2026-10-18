// 离线验证详情、标签、播放器与字幕共享预算、并发和取消，并对平台限制即时冷却。
import { afterEach, expect, test, vi } from 'vitest';
import { createBrowseNetwork } from '../src/browse-network';
import type { BrowseRequestLog } from '../src/browse-types';
vi.mock('../src/bili-client',() => ({ BiliRequestError: class extends Error {},biliClient: {
  ready: async () => {},check: () => {},cooldown: () => 0,record: async () => {},epoch: 0,
} }));

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
test.each([-400,-101])('分项预算独立，搜索业务码%s不能当作成功', async code => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ code,message: 'bad' })).mockImplementation(async () => Response.json({ code: 0,data: { result: [] } }));
  vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], network = createBrowseNetwork(new AbortController().signal,logs,new Map());
  await expect(network.data('/x/web-interface/search/type')).rejects.toMatchObject({ kind: 'business' });
  const run = (async () => { for (let i = 0; i < 4; i++) await network.data('/x/web-interface/wbi/index/top/feed/rcmd').catch(() => {}); })();
  await vi.runAllTimersAsync(); await run;
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(logs[0]).toMatchObject({ code,errorKind: 'business' });
  expect(logs.at(-1)).toMatchObject({ errorKind: 'budget' });
  expect(network.available('home')).toBe(false); expect(network.available('search')).toBe(true);
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

test('规划前可检查来源可用性，搜索至少间隔两秒且不拖延其他来源', async () => {
  vi.useFakeTimers();
  const sent: { kind: string; at: number }[] = [];
  vi.stubGlobal('fetch',vi.fn(async (url: string) => { sent.push({ kind: url.includes('/search/') ? 'search' : 'detail',at: Date.now() }); return Response.json({ code: 0,data: {} }); }));
  const cooldowns = new Map<string,number>(), network = createBrowseNetwork(new AbortController().signal,[],cooldowns);
  expect(network.available('search')).toBe(true);
  await network.data('/x/web-interface/search/type?q=one');
  const requests = [network.data('/x/web-interface/search/type?q=two'),network.data('/x/web-interface/view?bvid=BVtest')];
  await vi.runAllTimersAsync(); await Promise.all(requests);
  expect(sent.filter(item => item.kind === 'search')[1]!.at-sent[0]!.at).toBeGreaterThanOrEqual(2000);
  expect(sent.find(item => item.kind === 'detail')!.at).toBeLessThan(sent.filter(item => item.kind === 'search')[1]!.at);
  cooldowns.set('search',Date.now()+600000);
  expect(network.available('search')).toBe(false); expect(network.available('home')).toBe(true);
  await vi.advanceTimersByTimeAsync(600000); expect(network.available('search')).toBe(true);
});

test.each([{ http: 412,code: undefined,kind: 'limited' },{ http: 200,code: -412,kind: 'limited' },{ http: 200,code: -352,kind: 'verification' }])
('签名搜索遇限制后不回退旧接口，区分HTTP与业务码：$http/$code', async ({ http,code,kind }) => {
  vi.useFakeTimers();
  const nav = { code: 0,data: { wbi_img: { img_url: 'https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png',sub_url: 'https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png' } } };
  const fetch = vi.fn(async (url: string) => url.endsWith('/nav') ? Response.json(nav) : http === 412 ? new Response('',{ status: 412 }) : Response.json({ code }));
  vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], cooldowns = new Map<string,number>(), network = createBrowseNetwork(new AbortController().signal,logs,cooldowns);
  const params = { search_type: 'video',keyword: '摄影',page: '1',order: 'totalrank' };
  const first = expect(network.search(params)).rejects.toMatchObject({ kind }); await vi.runAllTimersAsync(); await first;
  await expect(network.search(params)).rejects.toMatchObject({ kind: 'cooldown' });
  const restarted = createBrowseNetwork(new AbortController().signal,[],cooldowns);
  await expect(restarted.search(params)).rejects.toMatchObject({ kind: 'cooldown' });
  expect(fetch).toHaveBeenCalledTimes(2); expect(network.remaining).toBe(178); expect(network.available('search')).toBe(false);
  expect(logs[1]).toMatchObject({ kind: 'search',path: '/x/web-interface/wbi/search/type',http,errorKind: kind,sent: true });
  expect(logs[1]?.code).toBe(code);
});

test('签名信息不可用时停止搜索，后续任务不会重复获取或发送无签名请求', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn(async () => Response.json({ code: 0,data: {} })); vi.stubGlobal('fetch',fetch);
  const logs: BrowseRequestLog[] = [], network = createBrowseNetwork(new AbortController().signal,logs,new Map());
  await expect(network.search({ keyword: '摄影' })).rejects.toMatchObject({ kind: 'invalid' });
  await expect(network.search({ keyword: '做饭' })).rejects.toMatchObject({ kind: 'cooldown' });
  expect(fetch).toHaveBeenCalledOnce(); expect(logs).toMatchObject([{ kind: 'signing',path: '/x/web-interface/nav',http: 200,sent: true }]);
  expect(network.available('search')).toBe(false);
});
