// 用模拟流验证分P缓存、长字幕完整覆盖、引用校验、取消与清缓存后的结果失效。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { Preferences } from '../src/types';
import type { SubtitleRow, VideoCache, VideoMessage, VideoSource } from '../src/video-types';

const mocks = vi.hoisted(() => ({ saved: {} as Record<string,unknown>, output: [] as unknown[], bodies: [] as Record<string,unknown>[],
  model: vi.fn(), rows: [] as SubtitleRow[], source: {} as VideoSource }));
vi.mock('wxt/browser',() => ({ browser: { storage: { local: {
  get: async (key: string) => ({ [key]: structuredClone(mocks.saved[key]) }),
  set: async (value: Record<string,unknown>) => { Object.assign(mocks.saved,structuredClone(value)); },
} } } }));
vi.mock('../src/video-api',() => ({
  confirmedPart: async (_bvid: string,cid: number) => ({ part: { page: cid === 20 ? 2 : 1 } }),
  readVideoSource: async (bvid: string,page: number,cid: number) => ({ ...mocks.source, bvid, page, cid }),
  readVideoRows: async () => mocks.rows,
  videoMedia: async () => [],
}));
vi.mock('../src/ai-request',() => ({ requestAI: (...args: unknown[]) => mocks.model(...args) }));
import { createVideoService } from '../src/video-service';
const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'private-key', result: null };
let service: ReturnType<typeof createVideoService>;
beforeEach(() => {
  prefs.apiKey = 'private-key';
  prefs.settings.videoAssistant = migrateSettings().videoAssistant;
  for (const key of Object.keys(mocks.saved)) delete mocks.saved[key]; mocks.output = []; mocks.bodies = [];
  mocks.rows = [{ start: 0, end: 2, text: '知识点' },{ start: 2, end: 4, text: '广告推广' }];
  mocks.source = { bvid: 'BVtest', aid: 1, cid: 10, page: 1, title: '课程', part: '第一课', duration: 4, parts: [], tracks: [] };
  mocks.model.mockReset();
  mocks.model.mockImplementation(async (_prefs, _selection, body, signal: AbortSignal, consume: (value: unknown) => Promise<unknown>, _feature: string, options: { schema?: unknown; preview?: (text: string) => void; partial?: (value: unknown) => void }) => {
    signal.throwIfAborted(); mocks.bodies.push(body);
    const data = JSON.parse(body.messages[1].content);
    const first = data.subtitle ? Number(data.subtitle.match(/^\d+/)?.[0] ?? 0) : data.parts?.[0]?.blocks?.[0]?.props?.items?.[0]?.ref ?? 0;
    const value = mocks.output.shift() ?? summaryUI(first);
    if (options.schema) { options.partial?.(value); return consume(value); }
    const answer = value as { summary: string; refs?: number[] };
    const text = typeof value === 'string' ? value : answer.summary + (answer.refs ?? []).map(id => `[[${id}]]`).join('');
    options.preview?.(text); return consume(text);
  });
  service = createVideoService(async () => prefs);
});
afterEach(() => vi.restoreAllMocks());
async function subtitles(cid = 10) { return await service({ type: 'video-subtitles', bvid: 'BVtest', cid, language: 'zh' }) as VideoCache; }
function task(cache: VideoCache, kind: 'summary' | 'chapters' | 'chat' = 'summary'): Extract<VideoMessage,{type: 'video-analyze'}> {
  return { type: 'video-analyze', bvid: 'BVtest', cid: cache.source.cid, language: 'zh', fingerprint: cache.fingerprint, task: kind, requestId: crypto.randomUUID(), selection: { providerId: 'deepseek', model: 'deepseek-flash' }, ...(kind === 'chat' ? { question: '重点是什么？' } : {}) };
}

function summaryUI(ref = 0) {
  return { headline: '视频总结', context: '', blocks: [{ type: 'KeyPoints', props: { title: '重点', condition: '',
    items: [{ title: '重要结论', text: '简要说明', detail: '完整论据', ref }] } }] };
}
test('P1与P2缓存独立，刷新及后台重建可恢复总结且密钥不返回页面', async () => {
  const p1 = await subtitles(), p2 = await subtitles(20);
  await service(task(p1)); service = createVideoService(async () => prefs);
  const restored = await subtitles();
  expect(restored.summary?.value.summary).toContain('视频总结'); expect(p2.summary).toBeUndefined();
  expect((await subtitles(20)).summary).toBeUndefined(); expect(JSON.stringify(restored)).not.toContain('private-key');
  expect(mocks.model).toHaveBeenCalledOnce();
});
test('相同字幕刷新保留分析，正文变化后使分析和问答失效', async () => {
  const cache = await subtitles(); await service(task(cache));
  expect((await service({ type: 'video-subtitles', bvid: 'BVtest', cid: 10, language: 'zh', refresh: true }) as VideoCache).summary).toBeDefined();
  mocks.rows = [{ start: 0, end: 2, text: '字幕已经更新' }];
  const updated = await service({ type: 'video-subtitles', bvid: 'BVtest', cid: 10, language: 'zh', refresh: true }) as VideoCache;
  expect(updated.summary).toBeUndefined(); await expect(service(task(cache))).rejects.toThrow('字幕已变化');
});
test('章节完整覆盖字幕且广告引用落到真实字幕行', async () => {
  const cache = await subtitles();
  mocks.output.push({ chapters: [{ first: 0, last: 0, title: '知识', summary: '课程内容', ad: false },{ first: 1, last: 1, title: '推广', summary: '商业广告', ad: true }] });
  const result = await service(task(cache,'chapters')) as VideoCache;
  expect(result.chapters?.value[1]).toMatchObject({ first: 1, last: 1, ad: true });
  mocks.output.push({ chapters: [{ first: 1, title: '漏了开头', summary: '', ad: false }] });
  await expect(service(task(cache,'chapters'))).rejects.toThrow('起始行无效');
  expect((await subtitles()).chapters?.value).toHaveLength(2);
  expect(mocks.bodies[0]).toMatchObject({ stream: true, response_format: { type: 'json_object' } });
});

test('总结流式发送组件组合，保留完整文本与专用配置', async () => {
  const cache = await subtitles(), progress = vi.fn();
  prefs.settings.videoAssistant.summary.maxTokens = 16384;
  prefs.settings.videoAssistant.chat.maxTokens = 4096;
  mocks.output.push(summaryUI());
  const result = await service(task(cache),progress) as VideoCache;
  expect(mocks.bodies[0]).toMatchObject({ stream: true, max_tokens: 16384 });
  expect(mocks.bodies[0]).toHaveProperty('response_format');
  expect(progress.mock.calls.some(([event]) => event.summaryUI?.headline === '视频总结')).toBe(true);
  expect(result.summary?.value.ui).toEqual(summaryUI());
  expect(result.summary?.value.summary).toContain('完整论据');
  expect(result.summary?.value.summary).toContain('[00:00]');
});

test('总结断流不覆盖旧结果，预览和无效引用不会进入缓存', async () => {
  const cache = await subtitles(); await service(task(cache));
  const previous = (await subtitles()).summary;
  const progress = vi.fn();
  mocks.model.mockImplementationOnce(async (_p,_s,_body,_signal,_consume,_feature,options) => {
    options.partial(summaryUI());
    expect((await subtitles()).summary).toEqual(previous);
    throw new Error('模拟总结断流');
  });
  await expect(service(task(cache),progress)).rejects.toThrow('模拟总结断流');
  expect(progress.mock.calls.some(([event]) => event.summaryUI?.blocks.length === 1)).toBe(true);
  expect((await subtitles()).summary).toEqual(previous);
  mocks.output.push(summaryUI(99));
  await expect(service(task(cache))).rejects.toThrow('引用');
  expect((await subtitles()).summary).toEqual(previous);
});

test('长视频总结只沿用各分段已有引用，合并新增引用时保留旧缓存', async () => {
  const old = await subtitles(); await service(task(old));
  mocks.rows = Array.from({ length: 200 },(_,i) => ({ start: i, end: i+1, text: `第${i}句`.repeat(40) }));
  const cache = await service({ type: 'video-subtitles', bvid: 'BVtest', cid: 10, language: 'zh', refresh: true }) as VideoCache;
  prefs.settings.videoAssistant.summary = { ...prefs.settings.videoAssistant.summary, contextTokens: 16000, maxTokens: 1024 };
  mocks.model.mockImplementation(async (_p,_s,body,_signal,consume) => {
    const data = JSON.parse(body.messages[1].content);
    const ref = data.subtitle ? Number(data.subtitle.match(/^\d+/)[0]) : 1;
    return consume(summaryUI(ref));
  });
  await expect(service(task(cache))).rejects.toThrow('引用');
  expect((await subtitles()).summary).toBeUndefined();
});

test('官方章节不依赖字幕行或模型密钥，不发起AI生成', async () => {
  const cache = await subtitles();
  prefs.apiKey = '';
  mocks.source.nativeChapters = [{ start: 0, end: 4, title: 'UP章节', summary: '', ad: false }];
  const result = await service(task(cache,'chapters')) as VideoCache;
  expect(result.source.nativeChapters).toHaveLength(1); expect(mocks.model).not.toHaveBeenCalled();
});
test('问答过滤无效引用并保存正文，保留既有历史且不追加请求', async () => {
  const cache = await subtitles(); mocks.output.push({ summary: '核心依据', refs: [0] });
  await service(task(cache,'chat'));
  mocks.output.push({ summary: '补充依据', refs: [99,1,1] });
  await service(task(cache,'chat'));
  mocks.output.push({ summary: '没有有效引用的回答', refs: [99] });
  await service(task(cache,'chat'));
  expect((await subtitles()).answers).toMatchObject([
    { answer: '核心依据', refs: [0] },{ answer: '补充依据', refs: [1] },{ answer: '没有有效引用的回答', refs: [] },
  ]);
  expect(mocks.model).toHaveBeenCalledTimes(3);
});

test('问答将区间引用保存为有效起始字幕，正文不残留区间标记', async () => {
  const cache = await subtitles(); mocks.output.push('核心依据[[0–1]][[1-1]][[0–99]]');
  const result = await service(task(cache,'chat')) as VideoCache;
  expect(result.answers).toMatchObject([{ answer: '核心依据', refs: [0,1] }]);
  expect((await subtitles()).answers).toEqual(result.answers);
});

test('长视频问答合并丢弃越界及未在原分段引用过的行号，仍保存正文和有效引用', async () => {
  mocks.rows = Array.from({ length: 120 },(_,i) => ({ start: i, end: i+1, text: '完整保留字幕内容'.repeat(40) }));
  prefs.settings.videoAssistant.chat = { ...prefs.settings.videoAssistant.chat, contextTokens: 16000, maxTokens: 1024 };
  const cache = await subtitles();
  mocks.model.mockImplementation(async (_p,_s,body,_signal,consume) => {
    mocks.bodies.push(body);
    const data = JSON.parse(body.messages[1].content);
    return consume(data.subtitle
      ? '分段依据[[999999,0]]'
      : '最终回答[[999999,1,2,3,4,5,6,7,0]]');
  });
  const result = await service(task(cache,'chat')) as VideoCache;
  const inputs = mocks.bodies.map(body => JSON.parse((body.messages as { content: string }[])[1]!.content));
  expect(inputs.filter(data => data.subtitle).length).toBeGreaterThan(1);
  expect(inputs.filter(data => data.parts)).toHaveLength(1);
  expect(result.answers).toMatchObject([{ answer: '最终回答', refs: [0] }]);
  expect((await subtitles()).answers).toEqual(result.answers);
});
test('长视频逐段全部读取并汇总，最后的字幕不会被丢弃', async () => {
  mocks.rows = Array.from({ length: 200 },(_,i) => ({ start: i, end: i+1, text: `第${i}句`.repeat(40) }));
  const cache = await subtitles(), message = task(cache); prefs.settings.videoAssistant.summary = { ...prefs.settings.videoAssistant.summary, contextTokens: 16000, maxTokens: 1024 }; await service(message);
  const inputs = mocks.bodies.map(body => JSON.stringify(body.messages));
  expect(inputs.some(input => input.includes('第199句'))).toBe(true); expect(inputs.length).toBeGreaterThan(1);
  expect((await subtitles()).summary).toBeDefined();
});

test('大上下文可直接总结完整字幕，并传递和记忆视频专用生成参数', async () => {
  mocks.rows = Array.from({ length: 200 },(_,i) => ({ start: i, end: i+1, text: `第${i}句`.repeat(40) }));
  const cache = await subtitles(), message = task(cache);
  prefs.settings.videoAssistant.summary = { ...prefs.settings.videoAssistant.summary, effort: 'max', maxTokens: 32768 };
  await service(message);
  expect(mocks.model).toHaveBeenCalledOnce();
  expect(mocks.bodies[0]).toMatchObject({ max_tokens: 32768, thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  expect(await service({ type: 'video-selection' })).toMatchObject({ summary: { effort: 'max', maxTokens: 32768 } });
});

test('非法生成预算在请求模型前被拒绝', async () => {
  const message = task(await subtitles()); prefs.settings.videoAssistant.summary = { ...prefs.settings.videoAssistant.summary, contextTokens: 16000, maxTokens: 16384 };
  await expect(service(message)).rejects.toThrow('输出上限占用过多'); expect(mocks.model).not.toHaveBeenCalled();
});
test('取消仅作用于发起者，清理缓存后的迟到结果不会重新写入', async () => {
  const cache = await subtitles(), message = task(cache);
  let release!: () => void, started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  mocks.model.mockImplementation(async (_p,_s,_b,signal: AbortSignal) => {
    started(); await new Promise<void>(resolve => { release = resolve; }); signal.throwIfAborted();
    return { summary: '迟到结果', points: [] };
  });
  const pending = service(message,undefined,'tab-1'); const rejected = expect(pending).rejects.toThrow('取消'); await ready;
  await service({ type: 'video-cancel', requestId: message.requestId },undefined,'tab-2');
  await service({ type: 'video-cancel', requestId: message.requestId },undefined,'tab-1'); release(); await rejected;
  expect((await subtitles()).summary).toBeUndefined();
  const next = service(task(cache)); const stale = expect(next).rejects.toThrow('取消');
  await Promise.resolve(); await vi.waitFor(() => expect(mocks.model).toHaveBeenCalledTimes(2));
  await service({ type: 'video-cache-clear', bvid: 'BVtest', cid: 10 }); release(); await stale;
  expect((await subtitles()).summary).toBeUndefined();
});


test('章节在完整结果前推送卡片预览，预览不写缓存，失败保留原结果', async () => {
  const cache = await subtitles(), progress = vi.fn();
  let reject!: (error: Error) => void;
  mocks.model.mockImplementationOnce(async (_p,_s,body,_signal,_consume,_feature,options) => {
    expect(body.stream).toBe(true);
    options.partial({ chapters: [{ first: 0, title: '正在生成', summary: '章节要点' }] });
    return new Promise((_resolve,fail) => { reject = fail; });
  });
  const pending = service(task(cache,'chapters'),progress);
  const rejected = expect(pending).rejects.toThrow('模拟断流');
  await vi.waitFor(() => expect(progress.mock.calls.some(([event]) => event.chapters?.[0]?.summary === '章节要点')).toBe(true));
  expect((await subtitles()).chapters).toBeUndefined();
  reject(new Error('模拟断流')); await rejected;
  expect((await subtitles()).chapters).toBeUndefined();
});


test.each([['concise','精简',2,3],['balanced','适中',3,6],['detailed','详细',5,12]] as const)('章节密度%s使用全片内容数量范围，广告另算', async (density,label,min,max) => {
  mocks.rows = Array.from({ length: 20 },(_,i) => ({ start: i*60, end: (i+1)*60, text: '字幕内容' }));
  mocks.source.duration = 1200;
  const cache = await subtitles();
  mocks.output.push({ chapters: Array.from({ length: min },(_,index) => ({ first: Math.floor(index*20/min), title: '课程'+index, summary: '', ad: false })) });
  await service({ ...task(cache,'chapters'), density });
  const input = JSON.stringify(mocks.bodies[0]?.messages);
  expect(input).toContain('章节密度：'+label); expect(input).toContain('下限'+min+'个、上限'+max+'个');
  expect(input).toContain('广告章节另算'); expect(input).toContain('末行号为19');
});

test('长视频候选与最终章节偏离数量偏好时仍保存，归并保留完整覆盖', async () => {
  mocks.rows = Array.from({ length: 120 },(_,i) => ({ start: i, end: i+1, text: '完整保留字幕内容'.repeat(40) }));
  prefs.settings.videoAssistant.chapters = { ...prefs.settings.videoAssistant.chapters, contextTokens: 16000, maxTokens: 1024 };
  prefs.settings.videoAssistant.chapterDensity = 'concise';
  const cache = await subtitles();
  mocks.model.mockImplementation(async (_p,_s,body,_signal,consume) => {
    mocks.bodies.push(body);
    const data = JSON.parse(body.messages[1].content);
    const count = data.candidates ? 7 : Math.min(7,data.last-data.first+1);
    const starts: number[] = Array.from({ length: count },(_,i) => data.candidates
      ? data.candidates[Math.floor(i*data.candidates.length/count)].first : data.first+Math.floor(i*(data.last-data.first+1)/count));
    return consume({ chapters: starts.map(first => ({ first, title: '课程'+first, summary: '重点', ad: false })) });
  });
  const result = await service(task(cache,'chapters')) as VideoCache;
  expect(mocks.model.mock.calls.length).toBeGreaterThan(2);
  expect(JSON.parse((mocks.bodies.at(-1)!.messages as { content: string }[])[1]!.content)).toHaveProperty('candidates');
  expect(result.chapters?.value).toHaveLength(7);
  expect(result.chapters?.value[0]?.first).toBe(0); expect(result.chapters?.value.at(-1)?.last).toBe(119);
});


test.each([1,7])('单次返回%d个合法内容章节时照常保存，不因偏离3–6追加请求或提示', async count => {
  mocks.rows = Array.from({ length: 20 },(_,i) => ({ start: i, end: i+1, text: '字幕' }));
  const cache = await subtitles(), progress = vi.fn();
  mocks.output.push({ chapters: Array.from({ length: count },(_,i) => ({ first: Math.floor(i*20/count), title: '内容'+i, summary: '要点', ad: false })) });
  const result = await service(task(cache,'chapters'),progress) as VideoCache;
  expect(result.chapters?.value).toHaveLength(count); expect((await subtitles()).chapters?.value).toHaveLength(count);
  expect(mocks.model).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(progress.mock.calls)).not.toMatch(/超出|偏离|数量不符/);
});
