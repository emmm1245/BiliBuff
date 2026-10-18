// 验证后台采样、复核配置、消息权限及多服务密钥的保存与备份迁移。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import { THEME_KEY } from '../src/theme';
import type { Backup, Message, Preferences, VideoEvent } from '../src/types';

const mocks = vi.hoisted(() => ({
  browser: { storage: { local: { setAccessLevel: vi.fn(), get: vi.fn(), set: vi.fn() }, onChanged: { addListener: vi.fn() } },
    runtime: { id: 'test', getURL: () => 'chrome-extension://test/options.html', onMessage: { addListener: vi.fn() }, openOptionsPage: vi.fn() },
    tabs: { query: vi.fn(), sendMessage: vi.fn(), create: vi.fn() }, action: { onClicked: { addListener: vi.fn() } }, downloads: { onChanged: { addListener: vi.fn() } } },
  reviewer: { request: vi.fn(), invalidate: vi.fn(), error: () => '' },
  mergeEvents: vi.fn(), allEvents: vi.fn(),
  requestSuggestions: vi.fn(),
}));
vi.mock('wxt/browser', () => ({ browser: mocks.browser }));
vi.mock('wxt/utils/define-background', () => ({ defineBackground: (main: () => void) => ({ main }) }));
vi.mock('../src/review', () => ({ createReviewer: () => mocks.reviewer }));
vi.mock('../src/tags', () => ({ requestTags: vi.fn() }));
vi.mock('../src/database', () => ({ allEvents: mocks.allEvents, counts: async () => ({ watched: 0, blocked: 0, highlight: 0 }), mergeEvents: mocks.mergeEvents }));
vi.mock('../src/search', () => ({ requestSuggestions: mocks.requestSuggestions }));
import entry from '../entrypoints/background';

let preferences: Preferences;
let listener: (message: Message, sender: { id: string; url: string; frameId: number; tab?: { id: number } }, respond: (reply: { ok: boolean; value?: unknown; error?: string }) => void) => void;
beforeEach(() => {
  vi.clearAllMocks();
  preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: '', decisionApiKey: 'kept-key', result: null };
  mocks.browser.storage.local.setAccessLevel.mockResolvedValue(undefined);
  mocks.browser.storage.local.get.mockImplementation(async () => ({ preferences: structuredClone(preferences) }));
  mocks.browser.storage.local.set.mockImplementation(async value => { preferences = structuredClone(value.preferences); });
  mocks.browser.tabs.query.mockResolvedValue([{ id: 1 }]);
  mocks.browser.tabs.sendMessage.mockResolvedValue(undefined);
  mocks.allEvents.mockResolvedValue([]);
  mocks.browser.runtime.onMessage.addListener.mockImplementation(value => { listener = value; });
  entry.main();
});
afterEach(() => vi.unstubAllGlobals());
async function request(message: Message, url = 'chrome-extension://test/options.html') {
  return new Promise<{ ok: boolean; value?: unknown; error?: string }>(resolve => listener(message, { id: 'test', url, frameId: 0 }, resolve));
}

test('评论流式进度只推送到发起标签页的主框架，断流保留失败响应', async () => {
  preferences.apiKey = 'test';
  const raw = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"summary":"正在生成总览' } }] })}\n\n`;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  vi.stubGlobal('fetch',vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; controller.enqueue(new TextEncoder().encode(raw)); } }))));
  const task = new Promise<{ ok: boolean; error?: string }>(resolve => listener({ type: 'comments-analyze', requestId: 'stream-tab',
    source: { bvid: 'BVtest', oid: '123', title: '示例视频' }, total: 1,
    comments: [{ id: '123456789012', root: '0', parent: '0', text: '评论正文', author: '甲', likes: 0, time: 1, replies: 0 }] },
  { id: 'test', url: 'https://www.bilibili.com/video/BVtest', frameId: 0, tab: { id: 42 } },resolve));
  await vi.waitFor(() => expect(mocks.browser.tabs.sendMessage).toHaveBeenCalled());
  stream.close(); const response = await task;
  expect(response).toMatchObject({ ok: false, error: expect.stringContaining('连接中断') });
  expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(42,
    { type: 'comments-progress', requestId: 'stream-tab', bvid: 'BVtest', summary: '正在生成总览', thinking: false, partial: { summary: '正在生成总览' } },{ frameId: 0 });
  expect(mocks.browser.tabs.query).not.toHaveBeenCalled();
});

test('主页联想请求只转交搜索词，不读写偏好或调用 AI', async () => {
  mocks.requestSuggestions.mockResolvedValue(['摄影教程']);
  expect(await request({ type: 'suggest', term: '摄影' }, 'https://www.bilibili.com/')).toEqual({ ok: true, value: ['摄影教程'] });
  expect(mocks.requestSuggestions).toHaveBeenCalledWith('摄影');
  expect(mocks.reviewer.request).not.toHaveBeenCalled();
  expect(mocks.reviewer.invalidate).not.toHaveBeenCalled();
});

test.each([false,true])('AI推荐强制网页使用留白，关闭后恢复原偏好 %s', async homeSearch => {
  preferences.settings.homeSearch = homeSearch;
  preferences.settings.browse.enabled = true;
  expect(await request({ type: 'rules' },'https://www.bilibili.com/')).toMatchObject({ ok: true,value: { homeSearch: true,browse: { enabled: true } } });
  expect(preferences.settings.homeSearch).toBe(homeSearch);
  expect(await request({ type: 'snapshot' })).toMatchObject({ ok: true,value: { preferences: { settings: { homeSearch } } } });
  preferences.settings.browse.enabled = false;
  expect(await request({ type: 'rules' },'https://www.bilibili.com/')).toMatchObject({ ok: true,value: { homeSearch,browse: { enabled: false } } });
  expect(mocks.browser.storage.local.set).not.toHaveBeenCalled();
});

test('网页只读取独立主题偏好，主题变更只广播外观，不使规则和复核失效', async () => {
  const savedPreferences = structuredClone(preferences);
  mocks.browser.storage.local.get.mockImplementation(async key => key === THEME_KEY ? { [THEME_KEY]: 'dark' } : { preferences: structuredClone(preferences) });
  expect(await request({ type: 'theme' }, 'https://www.bilibili.com/')).toEqual({ ok: true, value: 'dark' });
  const changed = mocks.browser.storage.onChanged.addListener.mock.calls[0]![0];
  changed({ [THEME_KEY]: { newValue: 'light' } }, 'local');
  await vi.waitFor(() => expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'theme-changed', theme: 'light' }));
  expect(mocks.reviewer.invalidate).not.toHaveBeenCalled();
  expect(preferences).toEqual(savedPreferences);
  mocks.browser.tabs.sendMessage.mockClear();
  changed({ preferences: { newValue: preferences } }, 'local');
  changed({ [THEME_KEY]: { newValue: 'dark' } }, 'sync');
  await Promise.resolve();
  expect(mocks.browser.tabs.sendMessage).not.toHaveBeenCalled();
});

test.each([25, 1000])('屏蔽目标为 %i 时保留屏蔽抽样数量', async target => {
  preferences.settings.minBlocked = target;
  const records: VideoEvent[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'blocked', bvid: `BVsample${i}`, title: '矩阵运算', tags: null, at: i, reason: '' }));
  mocks.allEvents.mockResolvedValue(records);
  const reply = await request({ type: 'samples' });
  expect(reply.ok).toBe(true);
  expect((reply.value as { blocked: VideoEvent[] }).blocked).toHaveLength(Math.min(target, records.length));
});

test('自动选量按传入数量查询两类样本，保留手动设置', async () => {
  const previous = structuredClone(preferences.settings);
  const records: VideoEvent[] = Array.from({ length: 30 }, (_, i) => ({ kind: 'watched', bvid: `BVwatched${i}`, title: '数学课程', tags: [], at: i, reason: '' }));
  mocks.allEvents.mockResolvedValue([...records, ...records.map(record => ({ ...record, kind: 'blocked' as const, bvid: `BVblocked${record.at}` }))]);
  const reply = await request({ type: 'samples', counts: { watched: 12, blocked: 25 } });
  expect(reply).toMatchObject({ ok: true });
  expect((reply.value as { watched: VideoEvent[] }).watched).toHaveLength(12);
  expect((reply.value as { blocked: VideoEvent[] }).blocked).toHaveLength(25);
  expect(preferences.settings).toEqual(previous);
});

test('分析先排除全库屏蔽记录再截取观看样本，素材总数与历史统计独立', async () => {
  const records: VideoEvent[] = [
    { kind: 'watched', bvid: 'BVoverlap', title: '重叠', tags: [], at: 300, reason: '' },
    { kind: 'watched', bvid: 'BVkeep', title: '保留', tags: [], at: 200, reason: '' },
    { kind: 'blocked', bvid: 'BVoverlap', title: '重叠', tags: [], at: 1, reason: 'AI屏蔽' },
    { kind: 'highlight', bvid: 'BVoverlap', title: '重叠', tags: [], at: 0, reason: '' },
  ];
  const original = structuredClone(records);
  mocks.allEvents.mockResolvedValue(records);
  expect(await request({ type: 'samples', counts: { watched: 1, blocked: 0 } })).toMatchObject({ ok: true,
    value: { watched: [records[1]], blocked: [] } });
  expect(await request({ type: 'snapshot' })).toMatchObject({ ok: true,
    value: { counts: { watched: 0, blocked: 0, highlight: 0 }, sampleCounts: { watched: 1, blocked: 1 } } });
  expect(records).toEqual(original);
  expect(mocks.mergeEvents).not.toHaveBeenCalled();
});

test('后台转发卡片总时长，旧消息未提供时长时保留未知', async () => {
  mocks.reviewer.request.mockResolvedValue('related');
  const url = 'https://www.bilibili.com/video/BVfirst';
  expect(await request({ type: 'review', bvid: 'BVfirst', title: '数学课程', durationSeconds: 57 }, url)).toMatchObject({ ok: true, value: 'related' });
  expect(mocks.reviewer.request).toHaveBeenLastCalledWith('BVfirst', '数学课程', 57);
  await request({ type: 'review', bvid: 'BVfirst', title: '数学课程' }, url);
  expect(mocks.reviewer.request).toHaveBeenLastCalledWith('BVfirst', '数学课程', undefined);
});

test('后台拒绝超出默认100字的计划，提高保存上限后接受并通知页面失效', async () => {
  expect(await request({ type: 'plan', plan: '数'.repeat(101) })).toMatchObject({ ok: false, error: expect.stringContaining('100') });
  expect(preferences.plan).toBe('');
  expect(await request({ type: 'save', settings: { ...preferences.settings, planMaxLength: 200 }, revision: 0 })).toMatchObject({ ok: true });
  expect(await request({ type: 'plan', plan: '数'.repeat(101) })).toMatchObject({ ok: true });
  expect(preferences.plan.length).toBe(101); expect(preferences.reviewRevision).toBe(2);
  expect(mocks.reviewer.invalidate).toHaveBeenCalledTimes(2);
  expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'rules-changed' });
});

test('页面不回复规则通知时，已落盘的设置仍返回成功，后续设置和计划继续保存', async () => {
  mocks.browser.tabs.sendMessage.mockImplementation(() => new Promise(() => {}));
  const firstSaved = vi.fn();
  void request({ type: 'save', settings: { ...preferences.settings, hideCarousel: true }, revision: 0 }).then(firstSaved);
  await vi.waitFor(() => expect(preferences.revision).toBe(1));
  await vi.waitFor(() => expect(firstSaved).toHaveBeenCalledWith(expect.objectContaining({ ok: true })), { timeout: 200, interval: 5 });
  expect(mocks.browser.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'rules-changed' });

  const secondSaved = vi.fn();
  void request({ type: 'save', settings: { ...preferences.settings, showMaskReasons: true }, revision: 1 }).then(secondSaved);
  await vi.waitFor(() => expect(secondSaved).toHaveBeenCalledWith(expect.objectContaining({ ok: true })), { timeout: 200, interval: 5 });
  const planSaved = vi.fn();
  void request({ type: 'plan', plan: '学习数学' }).then(planSaved);
  await vi.waitFor(() => expect(planSaved).toHaveBeenCalledWith({ ok: true, value: undefined }), { timeout: 200, interval: 5 });
  expect(preferences).toMatchObject({ revision: 2, plan: '学习数学', settings: { hideCarousel: true, showMaskReasons: true } });
});

test.each(['pending', 'failed'])('查询标签页%s时，通知异常不改变本机保存结果', async state => {
  mocks.browser.tabs.query.mockImplementation(() => state === 'pending' ? new Promise(() => {}) : Promise.reject(new Error('无法查询标签页')));
  const saved = vi.fn();
  void request({ type: 'save', settings: { ...preferences.settings, hideCarousel: true }, revision: 0 }).then(saved);
  await vi.waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ ok: true })), { timeout: 200, interval: 5 });
  expect(preferences).toMatchObject({ revision: 1, settings: { hideCarousel: true } });
});

test('本机写入失败仍返回错误，不通知页面，下一次保存可以重试', async () => {
  mocks.browser.storage.local.set.mockRejectedValueOnce(new Error('本机写入失败'));
  const settings = { ...preferences.settings, hideCarousel: true };
  expect(await request({ type: 'save', settings, revision: 0 })).toMatchObject({ ok: false, error: '本机写入失败' });
  expect(preferences.revision).toBe(0);
  expect(mocks.browser.tabs.query).not.toHaveBeenCalled();
  expect(await request({ type: 'save', settings, revision: 0 })).toMatchObject({ ok: true });
  expect(preferences).toMatchObject({ revision: 1, settings: { hideCarousel: true } });
});

test('旧超长计划不被截断，可逐步缩短；不能继续增加超限内容', async () => {
  preferences.plan = '旧'.repeat(150);
  expect(await request({ type: 'plan', plan: '旧'.repeat(120) })).toMatchObject({ ok: true });
  expect(preferences.plan.length).toBe(120);
  expect(await request({ type: 'plan', plan: '旧'.repeat(121) })).toMatchObject({ ok: false });
  expect(await request({ type: 'plan', plan: '学习数学' })).toMatchObject({ ok: true });
});

test('复核必须有有效计划及对应密钥，决策模式还需要业务空间编号', async () => {
  const settings = { ...preferences.settings, review: { ...preferences.settings.review, enabled: true } };
  expect(await request({ type: 'save', settings, revision: 0, apiKey: 'secret' })).toMatchObject({ ok: false });
  preferences.plan = '学习数学';
  expect(await request({ type: 'save', settings, revision: 0 })).toMatchObject({ ok: false });
  expect(await request({ type: 'save', settings, revision: 0, apiKey: 'secret' })).toMatchObject({ ok: true });
  settings.review.mode = 'decision';
  expect(await request({ type: 'save', settings, revision: 1 })).toMatchObject({ ok: false });
  settings.review.workspaceId = 'ws-example123';
  expect(await request({ type: 'save', settings, revision: 1 })).toMatchObject({ ok: true });
});

test('网页读取的配置包含失效编号，不包含计划及两种密钥；不能更改上限', async () => {
  const url = 'https://www.bilibili.com/';
  const response = await request({ type: 'rules' }, url);
  expect(response.value).toMatchObject({ reviewRevision: 0, planMaxLength: 100 });
  for (const field of ['plan', 'apiKey', 'decisionApiKey']) expect(response.value).not.toHaveProperty(field);
  expect(await request({ type: 'save', settings: preferences.settings, revision: 0 }, url)).toMatchObject({ ok: false });
});

test('备份默认排除两种密钥；明确包含时导出，旧备份不覆盖阿里云密钥', async () => {
  preferences.apiKey = 'deepseek-key';
  const exported = (await request({ type: 'export', includeKey: false })).value as Backup;
  expect(exported).not.toHaveProperty('apiKey'); expect(exported).not.toHaveProperty('decisionApiKey');
  const withKeys = (await request({ type: 'export', includeKey: true })).value as Backup;
  expect(withKeys).toMatchObject({ apiKey: 'deepseek-key', decisionApiKey: 'kept-key' });
  expect(await request({ type: 'import', backup: exported })).toMatchObject({ ok: true });
  expect(preferences.decisionApiKey).toBe('kept-key');
  expect(await request({ type: 'import', backup: { ...exported, decisionApiKey: '' } })).toMatchObject({ ok: true });
  expect(preferences.decisionApiKey).toBe('');
});

test('兼容服务密钥独立保存，网页不可读取，备份默认不包含任何密钥', async () => {
  preferences.settings.providers.push({ id: 'custom-test', name: '自定义', type: 'openai-compatible', baseUrl: 'https://custom.example/v1' });
  expect(await request({ type: 'save', settings: preferences.settings, revision: 0, providerKeys: { 'custom-test': 'custom-secret' } })).toMatchObject({ ok: true });
  expect(preferences.providerKeys).toEqual({ 'custom-test': 'custom-secret' });
  const rules = await request({ type: 'rules' }, 'https://www.bilibili.com/');
  expect(rules.value).not.toHaveProperty('providerKeys');
  expect(JSON.stringify(rules)).not.toContain('custom-secret');
  const backup = (await request({ type: 'export', includeKey: false })).value as Backup;
  expect(backup).not.toHaveProperty('providerKeys');
  expect((await request({ type: 'export', includeKey: true })).value).toMatchObject({ providerKeys: { 'custom-test': 'custom-secret' } });
  expect(await request({ type: 'save', settings: preferences.settings, revision: 1, providerKeys: { unknown: 'secret' } })).toMatchObject({ ok: false });
});

test('无密钥备份只为同标识同地址保留密钥，显式空密钥删除，服务删除时清理密钥', async () => {
  preferences.settings.providers.push({ id: 'custom-test', name: '自定义', type: 'openai-compatible', baseUrl: 'https://custom.example/v1' });
  preferences.providerKeys = { 'custom-test': 'custom-secret' };
  const backup = (await request({ type: 'export', includeKey: false })).value as Backup;
  expect(await request({ type: 'import', backup })).toMatchObject({ ok: true });
  expect(preferences.providerKeys).toEqual({ 'custom-test': 'custom-secret' });
  backup.settings.providers[1]!.baseUrl = 'https://different.example/v1';
  expect(await request({ type: 'import', backup })).toMatchObject({ ok: true });
  expect(preferences.providerKeys).toEqual({});
  expect(await request({ type: 'import', backup: { ...backup, providerKeys: { 'custom-test': '' } } })).toMatchObject({ ok: true });
  expect(preferences.providerKeys).toEqual({ 'custom-test': '' });
  const settings = { ...preferences.settings, providers: preferences.settings.providers.slice(0, 1) };
  expect(await request({ type: 'save', settings, revision: preferences.revision })).toMatchObject({ ok: true });
  expect(preferences.providerKeys).toEqual({});
});


test('网页密度选择持久保存到统一设置，后台重建后恢复且保留其他配置', async () => {
  const before = structuredClone(preferences);
  const result = await request({ type: 'video-density', density: 'concise' },'https://www.bilibili.com/video/BVtest');
  expect(result).toEqual({ ok: true, value: 'concise' });
  expect(preferences.settings.videoAssistant.chapterDensity).toBe('concise');
  expect(preferences.settings.videoAssistant.chapterRanges).toEqual(before.settings.videoAssistant.chapterRanges);
  expect(preferences.decisionApiKey).toBe(before.decisionApiKey); expect(preferences.revision).toBe(before.revision+1);
  entry.main();
  expect((await request({ type: 'rules' },'https://www.bilibili.com/video/BVtest')).value).toMatchObject({ videoAssistant: { chapterDensity: 'concise' } });
});

test('速读总结背景勾选持久保存，后台重建仍记忆且保留其他设置', async () => {
  const before = structuredClone(preferences);
  expect(await request({ type: 'comments-context', enabled: true },'https://www.bilibili.com/video/BVtest')).toEqual({ ok: true, value: true });
  expect(preferences.settings.quickRead).toEqual({ ...before.settings.quickRead, useVideoSummary: true });
  expect(preferences.settings.videoAssistant).toEqual(before.settings.videoAssistant);
  expect(preferences.revision).toBe(before.revision+1);
  entry.main();
  expect((await request({ type: 'rules' },'https://www.bilibili.com/video/BVtest')).value).toMatchObject({ quickRead: { useVideoSummary: true } });
});
