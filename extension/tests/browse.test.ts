// 离线验证推荐的默认关闭、真实候选约束、融合去重、反馈合并和计划失效。
import { beforeEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { currentSettings, migrateSettings, validateBackup, validateSettings } from '../src/core';
import { parseMessage } from '../src/platform/messages';
import { mayAccess } from '../src/access';
import type { BrowseMemory, BrowsePick, BrowseState, BrowseVideo } from '../src/browse-types';
import type { Preferences } from '../src/types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), ai: vi.fn(), home: vi.fn(), search: vi.fn(), related: vi.fn(), evidence: vi.fn(), samples: vi.fn() }));
vi.mock('wxt/browser',() => ({ browser: { storage: { local: { get: mocks.get, set: mocks.set } } } }));
vi.mock('../src/ai-request',() => ({ requestAI: mocks.ai }));
vi.mock('../src/database',() => ({ samples: mocks.samples }));
vi.mock('../src/browse-api',() => ({ browseHome: mocks.home, browseSearch: mocks.search, browseRelated: mocks.related, browseEvidence: mocks.evidence }));
import { browseContext, mergeBrowseCandidates, browsePicks, resolveBrowseIds, selectBrowsePicks } from '../src/browse-ranking';
import { BROWSE_KEY, readBrowseMemory, updateBrowseMemory } from '../src/browse-store';
import { createBrowseService } from '../src/browse-service';
import { BrowseHomeView } from '../src/browse-home';

const video = (id: string, source: BrowseVideo['sources'][number] = 'search'): BrowseVideo => ({ bvid: `BV${id}`, title: `线性代数${id}`, author: `作者${id}`, authorId: id, cover: '', duration: 61, published: 1, description: '矩阵课程', tags: ['线性代数'], sources: [source] });
let prefs: Preferences, saved: Record<string,unknown>, outputs: unknown[];
const profile = { goals: ['学习线性代数'],topics: ['线性代数'],excluded: [],formats: ['不限'],uncertainties: [] };
const fact = (id: string, scope = 'target', topic = '矩阵') => ({ id,scope,format: 'allowed',evidence: 'catalog',topic,page: 0 });
beforeEach(() => {
  vi.resetAllMocks();
  saved = {};
  prefs = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '学习线性代数', apiKey: 'test-key', result: null };
  prefs.settings.browse.enabled = true;
  mocks.get.mockImplementation(async (key: string) => ({ [key]: structuredClone(saved[key]) }));
  mocks.set.mockImplementation(async (value: Record<string,unknown>) => { Object.assign(saved,structuredClone(value)); });
  mocks.home.mockResolvedValue([video('home','home')]);
  mocks.search.mockResolvedValue([video('search')]); mocks.related.mockResolvedValue([video('related','related')]);
  mocks.samples.mockResolvedValue([]);
  mocks.evidence.mockImplementation(async (candidate: BrowseVideo) => ({ ...candidate, parts: ['矩阵'], excerpt: '实际字幕', coverage: '抽样' }));
  outputs = [profile,{ queries: ['线性代数'] },{ ids: ['v0','v1'] },{ choices: [fact('v1'),fact('v0','unknown','其他')] }];
  mocks.ai.mockImplementation(async (_prefs, _selection, body, signal: AbortSignal, consume: (value: unknown) => unknown) => {
    signal.throwIfAborted();
    return consume(outputs.shift() ?? (body.messages[0].content.includes('搜索词') ? { queries: ['线性代数'] } : { ids: [] }));
  });
});
function service() { return createBrowseService(async () => structuredClone(prefs)); }
async function settled(browse: ReturnType<typeof service>) {
  await vi.waitFor(async () => expect((await browse.handle({ type: 'browse-state' }) as BrowseState).busy).toBe(false));
  return await browse.handle({ type: 'browse-state' }) as BrowseState;
}
async function run(browse: ReturnType<typeof service>) { await browse.handle({ type: 'browse-refresh' }); return settled(browse); }

test('旧配置与备份增加独立关闭的推荐设置，模型不影响原有功能', () => {
  const { browse,...old } = migrateSettings();
  expect(browse.enabled).toBe(false);
  expect(currentSettings(old).browse).toEqual(browse);
  expect(validateSettings(old).browse).toEqual(browse);
  const settings = validateSettings({ ...old,browse: { ...browse,enabled: true } });
  expect(validateBackup({ format: 'bilibili-focus-backup',version: 1,settings,plan: '',events: [],result: null }).settings.browse.enabled).toBe(true);
  expect(() => validateSettings({ ...settings,browse: { ...browse,providerId: 'missing' } })).toThrow('服务');
});
test('消息只接受赞踩或取消，不接收网页伪造的视频元信息或模型配置', () => {
  expect(parseMessage({ type: 'browse-feedback',bvid: 'BVtest',vote: 1,title: '伪造',apiKey: 'secret' })).toEqual({ type: 'browse-feedback',bvid: 'BVtest',vote: 1 });
  expect(() => parseMessage({ type: 'browse-feedback',bvid: 'BVtest',vote: 2 })).toThrow();
  expect(mayAccess('browse-refresh',{ id: 'test',url: 'https://www.bilibili.com/',frameId: 0 },'test','options')).toBe(true);
  expect(mayAccess('browse-refresh',{ id: 'test',url: 'https://evil.example/',frameId: 0 },'test','options')).toBe(false);
  expect(mayAccess('browse-feedback',{ id: 'test',url: 'https://www.bilibili.com/',frameId: 1 },'test','options')).toBe(false);
});
test('交错融合来源、合并同视频，排除已推荐、看过和明确点踩', async () => {
  const memory = await readBrowseMemory();
  memory.seen = [{ bvid: 'BVseen',at: Date.now() }]; memory.feedback = [{ video: video('down'),vote: -1,at: 1 }];
  const candidates = mergeBrowseCandidates([[video('same','home'),video('seen'),video('down')],[video('new'),video('same'),video('watched')]],memory,new Set(['BVwatched']));
  expect(candidates.map(item => item.bvid)).toEqual(['BVsame','BVnew']);
  expect(candidates[0]!.sources).toEqual(['home','search']);
  expect(() => resolveBrowseIds(['v9'],candidates)).toThrow('不存在');
});
test('只有明确相关的真实候选会展示，限制同作者与同主题堆积', () => {
  const candidates = Array.from({ length: 7 },(_,i) => ({ ...video(String(i)),authorId: i < 3 ? 'same' : String(i) }));
  const choices = candidates.map((_,i) => fact(`v${i}`,i === 6 ? 'unknown' : 'target',i < 4 ? '矩阵' : '方程'));
  const evidence = candidates.map(video => ({ ...video,parts: [],excerpt: '',coverage: '目录' }));
  expect(selectBrowsePicks(browsePicks({ choices },evidence)).map(item => item.video.bvid)).toEqual(['BV0','BV1','BV3','BV4','BV5']);
  expect(() => browsePicks({ choices: [fact('v999')] },evidence)).toThrow('不存在');
  expect(() => browsePicks({ choices: [fact('v0')] },evidence)).toThrow('完整');
});
test('关闭功能时不会调用模型或读取站点推荐', async () => {
  prefs.settings.browse.enabled = false;
  const result = await run(service());
  expect(result.ready).toBe(false); expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.home).not.toHaveBeenCalled();
});
test('完成通用边界和内容核验，有界补充且字幕不落入推荐缓存', async () => {
  const browse = service();
  const result = await run(browse);
  expect(result.items.map(item => item.bvid)).toEqual(['BVsearch']); expect(result.busy).toBe(false);
  expect(mocks.ai).toHaveBeenCalledTimes(6); expect(mocks.home).toHaveBeenCalledTimes(3);
  const memory = await readBrowseMemory();
  expect(memory.items[0]).not.toHaveProperty('excerpt'); expect(memory.seen[0]!.bvid).toBe('BVsearch');
  const liked = await browse.handle({ type: 'browse-feedback',bvid: 'BVsearch',vote: 1 }) as BrowseState;
  expect(liked.items[0]!.vote).toBe(1);
  await browse.handle({ type: 'browse-feedback',bvid: 'BVsearch',vote: 0 });
  expect((await readBrowseMemory()).feedback).toEqual([]);
  await expect(browse.handle({ type: 'browse-feedback',bvid: 'BVfake',vote: 1 })).rejects.toThrow('已更新');
});
test('中途修改计划或停止选片，会拒绝迟到结果并保留此前批次', async () => {
  const old: BrowseMemory = { ...await readBrowseMemory(),context: browseContext(prefs),items: [video('old')],updatedAt: 1 };
  saved[BROWSE_KEY] = old;
  let finish!: () => void;
  mocks.ai.mockImplementationOnce(async (_prefs,_selection,_body,_signal,consume) => { await new Promise<void>(resolve => { finish = resolve; }); return consume(profile); });
  const browse = service(), task = browse.handle({ type: 'browse-refresh' });
  await vi.waitFor(() => expect(mocks.ai).toHaveBeenCalledOnce());
  prefs.plan = '学习摄影'; browse.invalidate(prefs); finish(); await task; await settled(browse);
  expect((await readBrowseMemory()).items[0]!.bvid).toBe('BVold');
  expect((await browse.handle({ type: 'browse-state' }) as BrowseState).items).toEqual([]);
  expect(mocks.home).not.toHaveBeenCalled();
});
test('并发换批只生成一次，服务失败保留当前结果', async () => {
  saved[BROWSE_KEY] = { ...await readBrowseMemory(),context: browseContext(prefs),items: [video('old')],updatedAt: 1 };
  mocks.ai.mockRejectedValue(new Error('模型不可用'));
  const browse = service();
  await Promise.all([browse.handle({ type: 'browse-refresh' }),browse.handle({ type: 'browse-refresh' })]);
  const result = await settled(browse);
  expect(mocks.ai).toHaveBeenCalledOnce(); expect(result.items[0]!.bvid).toBe('BVold'); expect(result.error.trim()).not.toBe('');
});
test('明确赞踩参与后续选片，点赞种子扩展关联推荐，不把观看当作点赞', async () => {
  await updateBrowseMemory(memory => ({ ...memory,feedback: [{ video: video('liked'),vote: 1,at: Date.now() }] }));
  const browse = service(); await run(browse);
  expect(mocks.related).toHaveBeenCalledWith('BVliked',expect.any(AbortSignal));
  const input = JSON.parse(mocks.ai.mock.calls[1]![2].messages[1].content);
  expect(input.feedback[0]).toMatchObject({ vote: 1 }); expect(input).not.toHaveProperty('watched');
});
test('后台重启识别中断记录，不把旧批次当作新任务成功', async () => {
  saved[BROWSE_KEY] = { ...await readBrowseMemory(),context: browseContext(prefs),items: [video('old')],updatedAt: 1,pending: { id: 'interrupted',context: browseContext(prefs) } };
  const state = await service().handle({ type: 'browse-state' }) as BrowseState;
  expect(state.busy).toBe(false); expect(state.error.trim()).not.toBe(''); expect(state.items[0]!.bvid).toBe('BVold');
  expect(mocks.ai).not.toHaveBeenCalled();
});
test('仅最近40条推荐标题进入模型上下文，旧记录缺少标题仍兼容', async () => {
  saved[BROWSE_KEY] = { ...await readBrowseMemory(),seen: Array.from({ length: 42 },(_,i) => ({ bvid: `BVprior${i}`,at: Date.now(),...(i ? { title: `曾推荐${i}` } : {}) })) };
  await run(service());
  const input = JSON.parse(mocks.ai.mock.calls[1]![2].messages[1].content);
  expect(input.recentRecommendations).toHaveLength(40);
  expect(input.recentRecommendations[0]).toBe('曾推荐2'); expect(input.recentRecommendations[39]).toBe('曾推荐41');
  expect((await readBrowseMemory()).seen.at(-1)).toMatchObject({ bvid: 'BVsearch',title: '线性代数search' });
});
test('全是旧候选时也推进搜索位置，避免反复停在同一页', async () => {
  outputs = [profile,...Array.from({ length: 3 },() => ({ queries: ['线性代数'] }))];
  saved[BROWSE_KEY] = { ...await readBrowseMemory(),context: browseContext(prefs),seen: [{ bvid: 'BVhome',at: Date.now() },{ bvid: 'BVsearch',at: Date.now() }] };
  await run(service());
  expect((await readBrowseMemory()).round).toBe(1);
  expect((await readBrowseMemory()).queries).toEqual(['线性代数','线性代数','线性代数']);
  expect(mocks.ai).toHaveBeenCalledTimes(4);
});
test('选片期间新增的赞踩不会被新批次覆盖', async () => {
  saved[BROWSE_KEY] = { ...await readBrowseMemory(),context: browseContext(prefs),items: [video('old')],updatedAt: 1 };
  let finish!: () => void;
  mocks.ai.mockImplementationOnce(async (_prefs,_selection,_body,_signal,consume) => {
    await new Promise<void>(resolve => { finish = resolve; }); outputs.shift(); return consume(profile);
  });
  const browse = service(); await browse.handle({ type: 'browse-refresh' });
  await vi.waitFor(() => expect(mocks.ai).toHaveBeenCalledOnce());
  await browse.handle({ type: 'browse-feedback',bvid: 'BVold',vote: -1 });
  finish(); await settled(browse);
  expect((await readBrowseMemory()).feedback).toMatchObject([{ video: { bvid: 'BVold' },vote: -1 }]);
  expect((await readBrowseMemory()).items[0]!.bvid).toBe('BVsearch');
});
test('卡片只提供赞踩，独立于视频链接，标题按文本转义', () => {
  const state: BrowseState = { items: [{ ...video('ui'),title: '<script>恶意标题</script>',vote: 1 }],busy: false,ready: true,error: '',status: '',updatedAt: 1 };
  const html = renderToStaticMarkup(createElement(BrowseHomeView,{ state,actions: { refresh: vi.fn(),cancel: vi.fn(),settings: vi.fn(),vote: vi.fn() } }));
  expect(html).toMatch(/<button[^>]*class="browse-like"[^>]*aria-pressed="true"/);
  expect(html).toMatch(/<button[^>]*class="browse-dislike"[^>]*aria-pressed="false"/);
  expect(html).toContain('href="https://www.bilibili.com/video/BVui"');
  expect(html).toContain('&lt;script&gt;恶意标题&lt;/script&gt;'); expect(html).not.toContain('<script>');
  expect(html.match(/class="browse-(?:like|dislike)"/g)).toHaveLength(2);
});

test('展示历史仅留7天200条，点踩独立保留，待推荐池剔除展示与过期内容', async () => {
  const pick = (id: string, age = 0): BrowsePick => ({ video: video(id),topic: id,checkedAt: Date.now()-age*86400000 });
  await updateBrowseMemory(memory => ({ ...memory,
    seen: [{ bvid: 'BVexpired',at: Date.now()-8*86400000 },...Array.from({ length: 210 },(_,i) => ({ bvid: `BV${i}`,at: Date.now() }))],
    feedback: [{ video: video('down'),vote: -1,at: Date.now()-60*86400000 }],
    pool: [pick('209'),pick('down'),pick('expired',4),...Array.from({ length: 40 },(_,i) => pick(`pool${i}`))] }));
  const memory = await readBrowseMemory();
  expect(memory.seen).toHaveLength(200); expect(memory.seen[0]!.bvid).toBe('BV10');
  expect(memory.pool).toHaveLength(36); expect(memory.pool?.[0]!.video.bvid).toBe('BVpool0');
  expect(memory.feedback).toHaveLength(1);
  expect(mergeBrowseCandidates([[video('expired')]],memory,new Set())).toHaveLength(1);
});

test('待推荐池足够时不重复付费，发布后只保留未展示内容', async () => {
  const pool: BrowsePick[] = Array.from({ length: 14 },(_,i) => ({ video: video(`pool${i}`),topic: `主题${i}`,checkedAt: Date.now() }));
  saved[BROWSE_KEY] = { ...await readBrowseMemory(),context: browseContext(prefs),profile,pool };
  const result = await run(service());
  expect(result.items).toHaveLength(12); expect(result.error).toBe('');
  expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.home).not.toHaveBeenCalled();
  expect((await readBrowseMemory()).pool).toHaveLength(2);
});

test('候选不足会继续采集到12条，而不是核验第一批后结束', async () => {
  let generation = 0;
  mocks.home.mockImplementation(async () => Array.from({ length: 4 },(_,i) => video(`round${generation}-${i}`)));
  mocks.search.mockResolvedValue([]);
  mocks.ai.mockImplementation(async (_prefs,_selection,body,_signal,consume) => {
    const input = JSON.parse(body.messages[1].content), task = body.messages[0].content;
    if (task.includes('goals为目标')) return consume(profile);
    if (task.includes('搜索词')) { generation++; return consume({ queries: ['线性代数'] }); }
    if (task.includes('初选') || task.includes('值得核验')) return consume({ ids: input.candidates.map((item: { id: string }) => item.id) });
    return consume({ choices: input.candidates.map((item: { id: string; title: string }) => fact(item.id,'target',item.title)) });
  });
  const result = await run(service());
  expect(result.items).toHaveLength(12); expect(mocks.home).toHaveBeenCalledTimes(3);
  expect(result.error).toBe(''); expect((await readBrowseMemory()).logs?.at(-1)).toMatchObject({ checked: 12,published: 12 });
});

test('来源故障不显示给有新推荐的用户，内部日志保留失败原因', async () => {
  mocks.home.mockRejectedValue(new Error('来源暂不可用'));
  outputs = [profile,{ queries: ['线性代数'] },{ ids: ['v0'] },{ choices: [fact('v0')] }];
  const result = await run(service());
  expect(result.items).toHaveLength(1); expect(result.error).toBe('');
  expect((await readBrowseMemory()).logs?.at(-1)?.sources.some(item => item.error === '来源暂不可用')).toBe(true);
});

test('后续模型失败仍发布已完成核验的新内容，不暴露内部错误', async () => {
  mocks.home.mockResolvedValue(Array.from({ length: 8 },(_,i) => video(`batch${i}`)));
  mocks.search.mockResolvedValue([]);
  outputs = [profile,{ queries: ['线性代数'] },{ ids: Array.from({ length: 8 },(_,i) => `v${i}`) },
    { choices: Array.from({ length: 6 },(_,i) => fact(`v${i}`,'target',`主题${i}`)) }];
  const original = mocks.ai.getMockImplementation()!;
  mocks.ai.mockImplementation(async (...args) => { if (!outputs.length) throw new Error('后续模型失败'); return original(...args); });
  const result = await run(service());
  expect(result.items).toHaveLength(6); expect(result.error).toBe('');
  expect((await readBrowseMemory()).logs?.at(-1)?.error).toContain('后续模型失败');
});

test('事实分类不把目录或无字幕视作不足，分P定位必须真实存在且不保存字幕', () => {
  const evidence = [{ ...video('course'),parts: ['导学','矩阵'],chapters: [{ page: 2,cid: 2,title: '矩阵',duration: 600 }],excerpt: '自我介绍',coverage: '第一P' }];
  const picks = browsePicks({ choices: [{ ...fact('v0'),page: 2 }] },evidence);
  expect(picks[0]?.video.entry).toEqual({ page: 2,title: '矩阵',duration: 600 });
  expect(picks[0]?.video).not.toHaveProperty('excerpt');
  expect(() => browsePicks({ choices: [{ ...fact('v0'),page: 3 }] },evidence)).toThrow('不存在的分P');
});

test('避开词条较多仍能开始找片，计划整理与偏好规则分开且不截断排除项', async () => {
  const excluded = Array.from({ length: 38 },(_,i) => `避开主题${i}`);
  prefs.settings.negative.tags = excluded;
  outputs[0] = { ...profile,excluded };
  const result = await run(service());
  expect(result.items.map(item => item.bvid)).toEqual(['BVsearch']);
  expect(result.error).toBe('');
  expect((await readBrowseMemory()).profile?.excluded).toEqual(excluded);
  expect(JSON.parse(mocks.ai.mock.calls[0]![2].messages[1].content)).toEqual({ plan: prefs.plan });
  expect(JSON.parse(mocks.ai.mock.calls[1]![2].messages[1].content).avoid.tags).toEqual(excluded);
});

