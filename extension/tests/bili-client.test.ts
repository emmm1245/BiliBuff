// 离线验证签名读取、来源冷却、持久化、脱敏日志及跨模块限制传播。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const storage = vi.hoisted(() => ({ value: {} as Record<string,unknown> }));
vi.mock('wxt/browser',() => ({ browser: { storage: { local: {
  get: async () => structuredClone(storage.value),
  set: async (value: Record<string,unknown>) => { Object.assign(storage.value,structuredClone(value)); },
} } } }));
import { createBiliClient } from '../src/bili-client';
const path = '/x/player/wbi/playurl';
const keys = { wbi_img: { img_url: 'https://i0.hdslb.com/7cd084941338484aae1ad9425b84077c.png',sub_url: 'https://i0.hdslb.com/4932caff0ff746eab6f01bf08b70ac45.png' } };
beforeEach(() => { storage.value = {}; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each([{ http: 412,code: undefined },{ http: 200,code: -412 },{ http: 200,code: -352 }])('区分 HTTP 与业务限制并跨实例保存冷却：$http/$code',async ({ http,code }) => {
  const fetch = vi.fn(async () => http === 412 ? new Response('',{ status: http }) : Response.json({ code })); vi.stubGlobal('fetch',fetch);
  const client = createBiliClient();
  await expect(client.json(path+'?w_rid=secret&bvid=BVtest')).rejects.toMatchObject({ kind: code === -352 ? 'verification' : 'limited' });
  const restored = createBiliClient();
  await expect(restored.json(path)).rejects.toMatchObject({ kind: 'cooldown' });
  expect(fetch).toHaveBeenCalledOnce();
  const logs = (await restored.diagnostics()).logs;
  expect(logs[0]).toMatchObject({ path,http,sent: true }); expect(logs[0]?.code).toBe(code);
  expect(logs[1]).toMatchObject({ sent: false,errorKind: 'cooldown' });
  expect(JSON.stringify(logs)).not.toContain('secret'); expect(JSON.stringify(logs)).not.toContain('BVtest');
});

test('尊重服务端更长的重试等待，冷却仅影响对应来源且到期恢复',async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValueOnce(new Response('',{ status: 429,headers: { 'Retry-After': '1200' } })).mockImplementation(async () => Response.json({ code: 0,data: [] }));
  vi.stubGlobal('fetch',fetch); const client = createBiliClient();
  await expect(client.json(path)).rejects.toMatchObject({ kind: 'limited' });
  expect(client.cooldown('media')).toBe(Date.now()+1200000);
  await client.json('/x/web-interface/view/detail/tag?bvid=BVtag');
  await vi.advanceTimersByTimeAsync(1200000); await client.json(path);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('未登录公共导航可签名，复用密钥，签名参数和原始Cookie均不进入日志',async () => {
  const fetch = vi.fn(async (url: string,init: RequestInit) => {
    expect(init.credentials).toBe('include'); expect(init.headers).toBeUndefined();
    return Response.json(url.endsWith('/nav') ? { code: -101,data: keys } : { code: 0,data: { quality: 64 } });
  }); vi.stubGlobal('fetch',fetch); const client = createBiliClient();
  await client.signed(path,{ bvid: 'BVtest',cid: '1',qn: '64' }); await client.signed(path,{ bvid: 'BVtest',cid: '1',qn: '127' });
  expect(fetch).toHaveBeenCalledTimes(3);
  const url = new URL(fetch.mock.calls[1]![0]);
  expect(url.pathname).toBe(path); expect(url.searchParams.get('w_rid')).toMatch(/^[a-f\d]{32}$/);
  expect(url.searchParams.get('wts')).toMatch(/^\d+$/); expect(url.searchParams.get('qn')).toBe('64');
  expect(JSON.stringify(await client.diagnostics())).not.toContain('w_rid');
});

test('无效导航不会连续重取签名；普通业务错误不要求错误登录或触发来源冷却',async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ code: 0,data: {} })).mockResolvedValueOnce(Response.json({ code: -400 }));
  vi.stubGlobal('fetch',fetch); const client = createBiliClient();
  await expect(client.signed(path,{})).rejects.toMatchObject({ kind: 'invalid' });
  await expect(client.signed(path,{})).rejects.toMatchObject({ kind: 'cooldown' });
  await expect(client.json('/x/web-interface/view?bvid=BVtest')).rejects.toMatchObject({ kind: 'business' });
  expect(client.cooldown('detail')).toBe(0); expect(fetch).toHaveBeenCalledTimes(2);
});

test('连续网络失败只发送三次后短暂冷却，缓存错误不触发限制',async () => {
  const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }); vi.stubGlobal('fetch',fetch);
  const client = createBiliClient();
  await client.note(path,'cache'); expect(client.cooldown('media')).toBe(0);
  for (let i = 0; i < 3; i++) await expect(client.json(path)).rejects.toThrow('fetch');
  await expect(client.json(path)).rejects.toMatchObject({ kind: 'cooldown' });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('清空日志后不恢复在途记录，但保留在途请求触发的冷却',async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const client = createBiliClient(), task = client.json(path).catch(error => error);
  await vi.waitFor(() => expect(finish).toBeDefined()); await client.clearLogs();
  finish(new Response('',{ status: 412 })); await task;
  expect((await client.diagnostics()).logs).toEqual([]); expect(client.cooldown('media')).toBeGreaterThan(Date.now());
  expect((await createBiliClient().diagnostics()).cooldowns.media).toBeGreaterThan(Date.now());
});

test('日志最多保留200条；业务状态缺失记作解析错误而不是接口成功',async () => {
  const client = createBiliClient();
  for (let i = 0; i < 205; i++) await client.note(path,'cache');
  expect((await client.diagnostics()).logs).toHaveLength(200);
  vi.stubGlobal('fetch',vi.fn(async () => Response.json(null)));
  await expect(client.json(path)).rejects.toMatchObject({ kind: 'invalid' });
  expect((await client.diagnostics()).logs.at(-1)).toMatchObject({ http: 200,errorKind: 'invalid',sent: true });
  expect(client.cooldown('media')).toBe(0);
});

test('标签读取触发的冷却也阻止AI选片继续读取标签，但不阻止详情',async () => {
  vi.resetModules();
  const { biliClient } = await import('../src/bili-client');
  const { createBrowseNetwork } = await import('../src/browse-network');
  const fetch = vi.fn().mockResolvedValueOnce(new Response('',{ status: 412 })).mockResolvedValueOnce(Response.json({ code: 0,data: {} })); vi.stubGlobal('fetch',fetch);
  await expect(biliClient.json('/x/web-interface/view/detail/tag?bvid=BVtest')).rejects.toMatchObject({ kind: 'limited' });
  const network = createBrowseNetwork(new AbortController().signal,[],new Map());
  expect(network.available('tags')).toBe(false);
  await expect(network.data('/x/web-interface/view/detail/tag?bvid=BVother')).rejects.toMatchObject({ kind: 'cooldown' });
  await network.data('/x/web-interface/view?bvid=BVother'); expect(fetch).toHaveBeenCalledTimes(2);
});
