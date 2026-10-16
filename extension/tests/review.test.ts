// 用模拟服务验证双模式复核、限字、跨页去重、缓存、失效和费用边界，不调用真实模型。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { Preferences, ReviewVerdict } from '../src/types';

const { cachedReview, saveReview } = vi.hoisted(() => ({ cachedReview: vi.fn(), saveReview: vi.fn() }));
vi.mock('../src/database', () => ({ cachedReview, saveReview }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: vi.fn().mockResolvedValue(true) }, storage: { local: { get: async () => ({}) } } } }));
import { createReviewer, parseReviewResponse } from '../src/review';

let prefs: Preferences;
let tags: ReturnType<typeof vi.fn<(bvid: string) => Promise<string[]>>>;
let fetchMock: ReturnType<typeof vi.fn>;
let reviewer: ReturnType<typeof createReviewer>;
const general = (verdict = 'unrelated', extra = {}) => new Response(JSON.stringify({
  choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decisions: { v0: verdict }, ...extra }) } }],
}));
const answer = (choice = 'unrelated', confidence = .95) => ({
  choice, confidence, probabilities: { related: .03, unrelated: .95, unknown: .02 },
});

beforeEach(() => {
  vi.useFakeTimers(); cachedReview.mockReset().mockResolvedValue(null); saveReview.mockReset().mockResolvedValue(undefined);
  prefs = { schemaVersion: 1, revision: 0, settings: migrateSettings({ topics: '数学', tags: false }), plan: '学习数学', apiKey: 'deepseek-secret', decisionApiKey: 'aliyun-secret', result: null };
  prefs.settings.review.enabled = true;
  tags = vi.fn<(bvid: string) => Promise<string[]>>().mockResolvedValue(['数学']); fetchMock = vi.fn().mockResolvedValue(general());
  vi.stubGlobal('fetch', fetchMock);
  reviewer = createReviewer(async () => structuredClone(prefs), tags);
});
afterEach(() => { reviewer.invalidate(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function run(bvid = 'BVfirst', title = '数学新闻', durationSeconds: number | null = null): Promise<ReviewVerdict> {
  const task = reviewer.request(bvid, title, durationSeconds);
  await vi.advanceTimersByTimeAsync(50);
  return task;
}

test('默认关闭零标签和零模型调用；未命中偏好不请求模型', async () => {
  prefs.settings.review.enabled = false;
  expect(await run()).toBe('skipped'); expect(tags).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  prefs.settings.review.enabled = true;
  expect(await run('BVother', '日常生活')).toBe('skipped'); expect(fetchMock).not.toHaveBeenCalled();
});

test('通用模式固定Flash、不思考、小输出，只请求判定，输入没有编号和密钥', async () => {
  prefs.settings.ai = { model: 'deepseek-v4-pro', thinking: true, effort: 'max', maxTokens: 65536 };
  expect(await run()).toBe('unrelated');
  const [url, options] = fetchMock.mock.calls[0]!;
  const body = JSON.parse(options.body);
  expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, max_tokens: 512 });
  const input = JSON.parse(body.messages[1].content);
  expect(input).toEqual({ plan: '学习数学', videos: [{ id: 'v0', title: '数学新闻', tags: ['数学'], durationSeconds: null }] });
  for (const secret of ['BVfirst', 'deepseek-secret', 'aliyun-secret']) expect(options.body).not.toContain(secret);
  expect(body.messages[0].content).toContain('不输出理由');
  expect(options.credentials).toBe('omit'); expect(saveReview).toHaveBeenCalledOnce();
});

test('通用复核独立选择兼容服务与模型，切换地址或模型后不复用缓存', async () => {
  prefs.settings.providers.push({ id: 'custom-review', name: '复核服务', type: 'openai-compatible', baseUrl: 'https://review.example/v1' });
  prefs.settings.review = { ...prefs.settings.review, providerId: 'custom-review', model: 'fast-model' };
  prefs.providerKeys = { 'custom-review': 'review-secret' };
  const entries = new Map<string, ReviewVerdict>();
  cachedReview.mockImplementation(async key => entries.get(key) ?? null);
  saveReview.mockImplementation(async (key, verdict) => { entries.set(key, verdict); });
  fetchMock.mockImplementation(async () => general());
  expect(await run()).toBe('unrelated');
  const [url, options] = fetchMock.mock.calls[0]!;
  expect(url).toBe('https://review.example/v1/chat/completions');
  expect(options.headers.Authorization).toBe('Bearer review-secret');
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ model: 'fast-model', max_tokens: 512, stream: false });
  expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('response_format');
  expect(await run()).toBe('unrelated'); expect(fetchMock).toHaveBeenCalledTimes(1);
  prefs.settings.review.model = 'another-model';
  expect(await run()).toBe('unrelated'); expect(fetchMock).toHaveBeenCalledTimes(2);
  prefs.settings.providers[1]!.baseUrl = 'https://another.example/v1';
  expect(await run()).toBe('unrelated'); expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fetchMock.mock.calls[2]![0]).toBe('https://another.example/v1/chat/completions');
});

test.each(['123', 'ws-example123', 'llm-example123'])('阿里云空间 %s 使用北京专用决策协议，仅提供分类问题', async workspaceId => {
  prefs.settings.review = { enabled: true, mode: 'decision', workspaceId };
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ answers: { v0: answer() } })));
  expect(await run('BVfirst', '数学新闻', 57)).toBe('unrelated');
  const [url, options] = fetchMock.mock.calls[0]!;
  const body = JSON.parse(options.body);
  expect(url).toBe(`https://${workspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone`);
  expect(options.headers.Authorization).toBe('Bearer aliyun-secret');
  expect(body.model).toBe('decision-model-preview');
  expect(body.state.videos[0].durationSeconds).toBe(57);
  expect(body.questions.v0.instructions).toContain('不能仅凭时长决定分类');
  expect(body.questions.v0.type).toBe('choice'); expect(Object.keys(body.questions.v0.criteria)).toEqual(['related', 'unrelated', 'unknown']);
  expect(body.messages).toBeUndefined(); expect(body.max_tokens).toBeUndefined();
});

test('决策模型把握不足时沿用原规则，不以低概率结果屏蔽', () => {
  expect(parseReviewResponse({ answers: { v0: answer('unrelated', .7) } }, ['v0'], 'decision')).toEqual(['unknown']);
  expect(parseReviewResponse({ answers: { v0: { ...answer(), probabilities: { related: .3, unrelated: .6, unknown: .1 } } } }, ['v0'], 'decision')).toEqual(['unknown']);
  for (const invalid of [null, { answers: {} }, { answers: { v0: answer('invalid') } },
    { answers: { v0: { ...answer(), confidence: 2 } } }, { answers: { v0: { ...answer(), probabilities: {} } } }]) {
    expect(() => parseReviewResponse(invalid, ['v0'], 'decision')).toThrow();
  }
});

test('相同视频跨页并发去重，后续命中持久缓存不再次调用模型', async () => {
  const first = reviewer.request('BVfirst', '数学新闻'); const second = reviewer.request('BVfirst', '数学新闻');
  await vi.advanceTimersByTimeAsync(50);
  expect(await Promise.all([first, second])).toEqual(['unrelated', 'unrelated']);
  expect(tags).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce();
  cachedReview.mockResolvedValue('unrelated');
  expect(await run()).toBe('unrelated'); expect(fetchMock).toHaveBeenCalledOnce();
});

test('时长发送给通用模型，变化后不复用判定，相同时长命中新版缓存', async () => {
  fetchMock.mockImplementation(async () => general());
  const entries = new Map<string, ReviewVerdict>();
  cachedReview.mockImplementation(async key => entries.get(key) ?? null);
  saveReview.mockImplementation(async (key, verdict) => { entries.set(key, verdict); });
  expect(await run('BVfirst', '数学新闻', 57)).toBe('unrelated');
  const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(JSON.parse(body.messages[1].content).videos[0].durationSeconds).toBe(57);
  expect(await run('BVfirst', '数学新闻', 57)).toBe('unrelated');
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(await run('BVfirst', '数学新闻', 240)).toBe('unrelated');
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(await run()).toBe('unrelated');
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('旧版复核缓存保留但不命中，版本隔离不会读取旧判定', async () => {
  const signature = JSON.stringify([prefs.plan, prefs.settings.review, prefs.settings.planMaxLength]);
  const oldKey = JSON.stringify([signature, 'BVfirst', { title: '数学新闻', tags: ['数学'] }]);
  cachedReview.mockImplementation(async key => key === oldKey ? 'related' : null);
  expect(await run()).toBe('unrelated');
  const key = cachedReview.mock.calls[0]![0];
  expect(key).not.toBe(oldKey);
  expect(JSON.parse(JSON.parse(key)[0])[0]).toBe(2);
  expect(fetchMock).toHaveBeenCalledOnce();
});

test('非法时长在查询标签和模型前拒绝', async () => {
  for (const duration of [-1, 0, 1.5, NaN, Infinity, '57']) {
    await expect(reviewer.request('BVfirst', '数学新闻', duration as number)).rejects.toThrow('时长');
  }
  expect(tags).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});

test('不同视频合并小批请求，并通过短编号关联各自结果', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ decisions: { v0: 'related', v1: 'unrelated' } }) } }] })));
  const tasks = [reviewer.request('BVfirst', '数学课程'), reviewer.request('BVsecond', '数学新闻')];
  await vi.advanceTimersByTimeAsync(50);
  expect(await Promise.all(tasks)).toEqual(['related', 'unrelated']); expect(fetchMock).toHaveBeenCalledOnce();
});

test('大量候选分批处理，模型请求最多两个并发', async () => {
  const replies: Array<() => void> = [];
  fetchMock.mockImplementation((_url, options) => new Promise<Response>(resolve => {
    const body = JSON.parse(options.body);
    const ids = JSON.parse(body.messages[1].content).videos.map((video: { id: string }) => video.id);
    replies.push(() => resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ decisions: Object.fromEntries(ids.map((id: string) => [id, 'related'])) }),
    } }] }))));
  }));
  const tasks = Array.from({ length: 20 }, (_, index) => reviewer.request(`BVbulk${index}`, `数学课程${index}`));
  await vi.advanceTimersByTimeAsync(50);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  replies[0]!(); await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  replies[1]!(); replies[2]!(); await vi.advanceTimersByTimeAsync(0);
  expect(await Promise.all(tasks)).toEqual(Array(20).fill('related'));
});

test('计划为空、超限或密钥缺失时不调用标签和模型；提高上限后可使用', async () => {
  for (const plan of ['', '数'.repeat(101)]) {
    prefs.plan = plan; await expect(reviewer.request('BVfirst', '数学新闻')).rejects.toThrow();
  }
  prefs.plan = '学习数学'; prefs.apiKey = '';
  await expect(reviewer.request('BVfirst', '数学新闻')).rejects.toThrow('密钥');
  expect(tags).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  prefs.apiKey = 'secret'; prefs.plan = '数'.repeat(101); prefs.settings.planMaxLength = 200;
  expect(await run()).toBe('unrelated');
});

test('请求前再检查计划上限，排队期间修改上限不调用模型', async () => {
  prefs.plan = '数'.repeat(101); prefs.settings.planMaxLength = 200;
  const task = reviewer.request('BVfirst', '数学新闻');
  const rejection = expect(task).resolves.toBe('stale');
  await vi.advanceTimersByTimeAsync(0);
  prefs.settings.planMaxLength = 100;
  await vi.advanceTimersByTimeAsync(50);
  await rejection; expect(fetchMock).not.toHaveBeenCalled();
});

test('计划修改并失效后，旧请求即使返回也不应用或写缓存', async () => {
  let respond!: (value: Response) => void;
  fetchMock.mockImplementation(() => new Promise<Response>(resolve => { respond = resolve; }));
  const task = reviewer.request('BVfirst', '数学新闻'); await vi.advanceTimersByTimeAsync(50);
  prefs.plan = '学习英语'; reviewer.invalidate(); respond(general());
  expect(await task).toBe('stale'); expect(saveReview).not.toHaveBeenCalled();
});

test('关闭功能会清空未发送队列，且不再请求模型', async () => {
  const task = reviewer.request('BVfirst', '数学新闻'); await vi.advanceTimersByTimeAsync(0);
  prefs.settings.review.enabled = false; reviewer.invalidate();
  await vi.advanceTimersByTimeAsync(50);
  expect(await task).toBe('stale'); expect(fetchMock).not.toHaveBeenCalled();
});

test('接口失败只请求一次，不缓存失败，向设置页保留错误提示', async () => {
  fetchMock.mockResolvedValue(new Response('', { status: 429 }));
  const task = reviewer.request('BVfirst', '数学新闻');
  const rejection = expect(task).rejects.toThrow('429'); await vi.advanceTimersByTimeAsync(50); await rejection;
  expect(fetchMock).toHaveBeenCalledOnce(); expect(saveReview).not.toHaveBeenCalled(); expect(reviewer.error()).toContain('429');
});

test('截断、缺项和非法分类不当作无关内容', () => {
  for (const invalid of [{}, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{"decisions":{"v0":"blocked"}}' } }] }]) {
    expect(() => parseReviewResponse(invalid, ['v0'], 'general')).toThrow();
  }
  expect(() => parseReviewResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"decisions":{"v0":"related"}}' } }] }, ['v0', 'v1'], 'general')).toThrow();
});
