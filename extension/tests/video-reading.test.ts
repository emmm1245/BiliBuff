// 验证页面切P、语言切换及取消时旧字幕和模型结果不会覆盖当前工作台。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { VideoPanelActions, VideoPanelState } from '../src/video-panel';
import type { VideoCache, VideoMessage, VideoSource } from '../src/video-types';
const mocks = vi.hoisted(() => ({ send: vi.fn(), actions: null as VideoPanelActions | null, states: [] as VideoPanelState[], listener: vi.fn() }));
vi.mock('../src/client',() => ({ send: mocks.send }));
vi.mock('wxt/browser',() => ({ browser: { runtime: { onMessage: { addListener: mocks.listener, removeListener: vi.fn() } } } }));
vi.mock('../src/video-player',() => ({ adSkipTarget: vi.fn(() => null), createVideoPlayerNavigation: () => ({ update: vi.fn(), playback: vi.fn(), clear: vi.fn() }) }));
vi.mock('../src/video-panel',() => ({ createVideoPanel: (actions: VideoPanelActions) => {
  mocks.actions = actions;
  return { render: (state: VideoPanelState) => mocks.states.push(structuredClone(state)), mount: vi.fn(), remove: vi.fn(), theme: vi.fn(), clearQuestion: vi.fn(), playback: vi.fn() };
} }));
import { startVideoReading } from '../src/video-reading';
let controller: AbortController;
const source = (page: number): VideoSource => ({ bvid: 'BVtest', aid: 1, cid: page*10, page, title: '课程', part: `第${page}课`, duration: 10, parts: [], tracks: [{ id: 'zh', name: '中文', ai: false },{ id: 'en', name: '英文', ai: false }] });
const cache = (page: number,language = 'zh'): VideoCache => ({ source: source(page), language, rows: [{ start: 0, end: 2, text: `${page}课${language}` }], fingerprint: `${page}:${language}`, answers: [], at: 1 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function tick() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
beforeEach(() => {
  vi.useFakeTimers(); mocks.states = []; mocks.send.mockReset(); controller = new AbortController();
  vi.stubGlobal('location',{ pathname: '/video/BVtest/', search: '?p=1' });
  vi.stubGlobal('document',{ body: {}, addEventListener: vi.fn(), querySelector: () => null });
  vi.stubGlobal('MutationObserver',class { observe() {} disconnect() {} });
  mocks.send.mockImplementation(async (message: VideoMessage | { type: string }) => {
    if (message.type === 'video-source' && 'page' in message) return source(message.page);
    if (message.type === 'video-subtitles' && 'cid' in message) return cache(message.cid/10,message.language);
    if (message.type === 'video-selection') return { providerId: 'deepseek', model: 'deepseek-flash' };
    if (message.type === 'video-media') return [];
    if (message.type === 'theme') return 'light';
  });
});
afterEach(() => { controller.abort(); vi.useRealTimers(); vi.unstubAllGlobals(); });
test('切P后迟到的P1字幕不能覆盖P2', async () => {
  const delayed = deferred<VideoCache>(), original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'video-subtitles' && message.cid === 10 ? delayed.promise : original(message));
  startVideoReading(migrateSettings(),controller.signal); await tick();
  location.search = '?p=2'; await vi.advanceTimersByTimeAsync(1000); await tick();
  expect(mocks.states.at(-1)?.cache?.source.page).toBe(2);
  delayed.resolve(cache(1)); await tick(); expect(mocks.states.at(-1)?.cache?.source.page).toBe(2);
});
test('语言切换取消旧模型任务，迟到结果不覆盖新字幕', async () => {
  const delayed = deferred<VideoCache>(), original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'video-analyze' ? delayed.promise : original(message));
  startVideoReading(migrateSettings(),controller.signal); await tick();
  mocks.actions!.analyze('summary'); await tick(); expect(mocks.states.at(-1)?.task).toBe('summary');
  mocks.actions!.language('en'); await tick(); expect(mocks.states.at(-1)?.cache?.language).toBe('en');
  delayed.resolve({ ...cache(1), summary: { value: { summary: '旧语言总结', points: [] }, fingerprint: '1:zh', selection: { providerId: 'deepseek', model: 'deepseek-flash' }, at: 1 } }); await tick();
  expect(mocks.states.at(-1)?.cache?.language).toBe('en'); expect(mocks.states.at(-1)?.cache?.summary).toBeUndefined();
  expect(mocks.send.mock.calls.some(([m]) => m.type === 'video-cancel')).toBe(true);
});
test('取消后可重新生成，旧任务完成不会结束新任务', async () => {
  const first = deferred<VideoCache>(), second = deferred<VideoCache>(), original = mocks.send.getMockImplementation()!; let calls = 0;
  mocks.send.mockImplementation(message => message.type === 'video-analyze' ? (++calls === 1 ? first.promise : second.promise) : original(message));
  startVideoReading(migrateSettings(),controller.signal); await tick();
  mocks.actions!.analyze('summary'); mocks.actions!.cancel(); mocks.actions!.analyze('chapters');
  first.resolve(cache(1)); await tick(); expect(mocks.states.at(-1)?.task).toBe('chapters');
  second.resolve(cache(1)); await tick(); expect(mocks.states.at(-1)?.task).toBeNull();
});

test('下载格式自动读取，字幕读取不会使并行媒体响应过期', async () => {
  const delayed = deferred<unknown[]>(), original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'video-media' ? delayed.promise : original(message));
  startVideoReading(migrateSettings(),controller.signal); await tick();
  expect(mocks.states.at(-1)?.cache).not.toBeNull(); expect(mocks.states.at(-1)?.mediaLoading).toBe(true);
  delayed.resolve([{ id: 'audio', label: '音频' }]); await tick();
  expect(mocks.states.at(-1)?.media).toHaveLength(1); expect(mocks.states.at(-1)?.mediaLoading).toBe(false);
});

test('自动功能按顺序执行且已有缓存和官方章节不重复付费生成', async () => {
  const original = mocks.send.getMockImplementation()!, settings = migrateSettings();
  settings.videoAssistant.autoSummary = true; settings.videoAssistant.autoChapters = true;
  mocks.send.mockImplementation(message => {
    if (message.type === 'video-analyze') return Promise.resolve({ ...cache(1), summary: { value: { summary: '自动总结', points: [] }, selection: settings.videoAssistant.summary, fingerprint: '1:zh', at: 1 } });
    if (message.type === 'video-source') return Promise.resolve({ ...source(1), nativeChapters: [{ start: 0, end: 10, title: '官方章节', summary: '', ad: false }] });
    return original(message);
  });
  startVideoReading(settings,controller.signal); await tick(); await tick();
  const tasks = mocks.send.mock.calls.filter(([message]) => message.type === 'video-analyze').map(([message]) => message.task);
  expect(tasks).toEqual(['summary']); await vi.advanceTimersByTimeAsync(2000); expect(mocks.send.mock.calls.filter(([message]) => message.type === 'video-analyze')).toHaveLength(1);
});


test('章节预览不进入正式缓存，取消后清空且忽略迟到的结构化进度', async () => {
  const delayed = deferred<VideoCache>(), original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'video-analyze' ? delayed.promise : original(message));
  startVideoReading(migrateSettings(),controller.signal); await tick();
  mocks.actions!.analyze('chapters'); await tick();
  const message = mocks.send.mock.calls.find(([value]) => value.type === 'video-analyze')![0];
  const listener = mocks.listener.mock.calls.at(-1)![0];
  const progress = { type: 'video-progress', requestId: message.requestId, summary: '', thinking: false,
    chapters: [{ first: 0, title: '章节草稿', summary: '说明' }] };
  listener(progress); expect(mocks.states.at(-1)?.chaptersPreview?.[0]?.title).toBe('章节草稿');
  expect(mocks.states.at(-1)?.cache?.chapters).toBeUndefined();
  mocks.actions!.cancel(); listener(progress);
  expect(mocks.states.at(-1)?.chaptersPreview).toBeUndefined();
  delayed.resolve(cache(1)); await tick(); expect(mocks.states.at(-1)?.cache?.chapters).toBeUndefined();
});


test('仅开启广告自动跳过不会隐式生成章节或请求模型', async () => {
  const settings = migrateSettings(); settings.videoAssistant.autoSkipAds = true;
  startVideoReading(settings,controller.signal); await tick(); await vi.advanceTimersByTimeAsync(2000); await tick();
  expect(mocks.send.mock.calls.filter(([message]) => message.type === 'video-analyze')).toHaveLength(0);
});

test('自动总结完成后仍遵守独立的自动章节开关', async () => {
  const settings = migrateSettings(), original = mocks.send.getMockImplementation()!;
  settings.videoAssistant.autoSummary = true; settings.videoAssistant.autoSkipAds = true;
  mocks.send.mockImplementation(message => message.type === 'video-analyze'
    ? Promise.resolve({ ...cache(1), summary: { value: { summary: '总结', points: [] }, selection: settings.videoAssistant.summary, fingerprint: '1:zh', at: 1 } }) : original(message));
  startVideoReading(settings,controller.signal); await tick(); await tick();
  expect(mocks.send.mock.calls.filter(([message]) => message.type === 'video-analyze').map(([message]) => message.task)).toEqual(['summary']);
});

test('关闭自动章节时取消已启动的自动任务，迟到结果不恢复章节', async () => {
  const settings = migrateSettings(), original = mocks.send.getMockImplementation()!, delayed = deferred<VideoCache>();
  settings.videoAssistant.autoChapters = true;
  mocks.send.mockImplementation(message => message.type === 'video-analyze' ? delayed.promise : original(message));
  const reader = startVideoReading(settings,controller.signal); await tick();
  expect(mocks.states.at(-1)?.task).toBe('chapters');
  reader.configure({ ...settings, videoAssistant: { ...settings.videoAssistant, autoChapters: false } });
  expect(mocks.send.mock.calls.some(([message]) => message.type === 'video-cancel')).toBe(true);
  delayed.resolve(cache(1)); await tick(); expect(mocks.states.at(-1)?.task).toBeNull();
});

test('工作台所选章节密度传给生成请求，默认关闭自动章节时仍可手动生成', async () => {
  const original = mocks.send.getMockImplementation()!;
  mocks.send.mockImplementation(message => message.type === 'video-analyze' ? Promise.resolve(cache(1)) : original(message));
  startVideoReading(migrateSettings(),controller.signal); await tick();
  mocks.actions!.density('concise'); mocks.actions!.analyze('chapters'); await tick();
  expect(mocks.send.mock.calls.some(([message]) => message.type === 'video-density' && message.density === 'concise')).toBe(true);
  expect(mocks.send.mock.calls.find(([message]) => message.type === 'video-analyze')?.[0]).toMatchObject({ task: 'chapters', density: 'concise' });
});
