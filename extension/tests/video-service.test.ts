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
  for (const key of Object.keys(mocks.saved)) delete mocks.saved[key]; mocks.output = []; mocks.bodies = [];
  mocks.rows = [{ start: 0, end: 2, text: '知识点' },{ start: 2, end: 4, text: '广告推广' }];
  mocks.source = { bvid: 'BVtest', aid: 1, cid: 10, page: 1, title: '课程', part: '第一课', duration: 4, parts: [], tracks: [] };
  mocks.model.mockReset();
  mocks.model.mockImplementation(async (_prefs, _selection, body, signal: AbortSignal, consume: (response: Response) => Promise<unknown>) => {
    signal.throwIfAborted(); mocks.bodies.push(body);
    const text = JSON.stringify(mocks.output.shift() ?? { summary: '视频总结', points: ['重点'] });
    return consume(new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`));
  });
  service = createVideoService(async () => prefs);
});
afterEach(() => vi.restoreAllMocks());
async function subtitles(cid = 10) { return await service({ type: 'video-subtitles', bvid: 'BVtest', cid, language: 'zh' }) as VideoCache; }
function task(cache: VideoCache, kind: 'summary' | 'chapters' | 'chat' = 'summary'): Extract<VideoMessage,{type: 'video-analyze'}> {
  return { type: 'video-analyze', bvid: 'BVtest', cid: cache.source.cid, language: 'zh', fingerprint: cache.fingerprint, task: kind, requestId: crypto.randomUUID(), selection: { providerId: 'deepseek', model: 'deepseek-flash' }, ...(kind === 'chat' ? { question: '重点是什么？' } : {}) };
}
test('P1与P2缓存独立，刷新及后台重建可恢复总结且密钥不返回页面', async () => {
  const p1 = await subtitles(), p2 = await subtitles(20);
  await service(task(p1)); service = createVideoService(async () => prefs);
  const restored = await subtitles();
  expect(restored.summary?.value.summary).toBe('视频总结'); expect(p2.summary).toBeUndefined();
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
  mocks.output.push({ chapters: [{ first: 0, last: 0, title: '漏了结尾', summary: '', ad: false }] });
  await expect(service(task(cache,'chapters'))).rejects.toThrow('完整覆盖');
  expect((await subtitles()).chapters?.value).toHaveLength(2);
});
test('问答保存合法原文引用，非法引用不覆盖已有历史', async () => {
  const cache = await subtitles(); mocks.output.push({ summary: '核心依据', points: [], refs: [0] });
  await service(task(cache,'chat'));
  mocks.output.push({ summary: '错误依据', points: [], refs: [99] });
  await expect(service(task(cache,'chat'))).rejects.toThrow('无效字幕引用');
  expect((await subtitles()).answers).toHaveLength(1);
});
test('长视频逐段全部读取并汇总，最后的字幕不会被丢弃', async () => {
  mocks.rows = Array.from({ length: 200 },(_,i) => ({ start: i, end: i+1, text: `第${i}句`.repeat(40) }));
  const cache = await subtitles(), message = task(cache); message.selection = { ...message.selection, contextTokens: 16000, maxTokens: 1024 }; await service(message);
  const inputs = mocks.bodies.map(body => JSON.stringify(body.messages));
  expect(inputs.some(input => input.includes('第199句'))).toBe(true); expect(inputs.length).toBeGreaterThan(1);
  expect((await subtitles()).summary).toBeDefined();
});

test('大上下文可直接总结完整字幕，并传递和记忆视频专用生成参数', async () => {
  mocks.rows = Array.from({ length: 200 },(_,i) => ({ start: i, end: i+1, text: `第${i}句`.repeat(40) }));
  const cache = await subtitles(), message = task(cache);
  message.selection = { ...message.selection, effort: 'max', maxTokens: 32768 };
  await service(message);
  expect(mocks.model).toHaveBeenCalledOnce();
  expect(mocks.bodies[0]).toMatchObject({ max_tokens: 32768, thinking: { type: 'enabled' }, reasoning_effort: 'max' });
  expect(await service({ type: 'video-selection' })).toMatchObject({ effort: 'max', maxTokens: 32768 });
});

test('非法生成预算在请求模型前被拒绝', async () => {
  const message = task(await subtitles()); message.selection = { ...message.selection, contextTokens: 16000, maxTokens: 16384 };
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
