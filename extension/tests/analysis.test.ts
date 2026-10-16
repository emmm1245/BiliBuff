// 用模拟流式响应验证分析门槛、隐私、增删建议和多轮选项澄清。
import { beforeEach, expect, test, vi } from 'vitest';
import { migrateSettings } from '../src/core';
import type { Preferences, VideoEvent } from '../src/types';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../src/client', () => ({ send }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: vi.fn().mockResolvedValue(true) }, storage: { local: { get: async () => ({}) } } } }));
import { analyze, type AnalysisTurn } from '../src/analysis';

const prefs = (): Preferences => ({ schemaVersion: 1, revision: 0, settings: { ...migrateSettings(), minWatched: 1, minBlocked: 1 }, plan: '备考', apiKey: 'test-key', result: null });
const record = (kind: VideoEvent['kind']): VideoEvent => ({ kind, bvid: `BV${kind}`, title: '数学课', tags: ['数学'], at: 1, reason: '' });
const resultResponse = { kind: 'result', summary: '建议', suggestions: [] };
const questionResponse = { kind: 'clarification', summary: '需要明确用途', question: '学习的用途是什么？', options: ['准备考试', '完成项目'] };
function streamResponse(value: unknown) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) }, finish_reason: null }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
}
function setup(value = prefs()) {
  send.mockImplementation(async message => message.type === 'snapshot' ? { preferences: value } : { watched: [record('watched')], blocked: [record('blocked')] });
  const fetch = vi.fn().mockImplementation(async () => streamResponse(resultResponse));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function pending(turn: AnalysisTurn) {
  if (turn.kind !== 'clarification') throw new Error('预期澄清问题');
  return turn;
}
beforeEach(() => { send.mockReset(); vi.unstubAllGlobals(); });
test('样本不足不调用模型', async () => {
  send.mockResolvedValue({ watched: [], blocked: [] }); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(analyze(prefs(), migrateSettings(), new AbortController().signal, () => {})).rejects.toThrow('门槛'); expect(fetch).not.toHaveBeenCalled();
});
test('补标签失败不调用模型', async () => {
  send.mockImplementation(async (message: { type: string }) => {
    if (message.type === 'samples') return { watched: [{ ...record('watched'), tags: null }], blocked: [record('blocked')] };
    throw new Error('标签失败');
  });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(analyze(prefs(), migrateSettings(), new AbortController().signal, () => {})).rejects.toThrow('未调用模型'); expect(fetch).not.toHaveBeenCalled();
});

test('仅补选中样本的标签且保留屏蔽时间，不向模型发送时间并说明抽样限制', async () => {
  const blocked = { ...record('blocked'), at: 1234, tags: null };
  send.mockImplementation(async message => {
    if (message.type === 'samples') return { watched: [record('watched')], blocked: [blocked] };
    if (message.type === 'tags') return ['数学'];
    if (message.type === 'snapshot') return { preferences: prefs() };
  });
  const fetch = vi.fn().mockResolvedValue(streamResponse(resultResponse)); vi.stubGlobal('fetch', fetch);
  const turn = await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {});
  expect(send.mock.calls.filter(call => call[0].type === 'tags')).toHaveLength(1);
  expect(send).toHaveBeenCalledWith({ type: 'record', event: { ...blocked, at: 1234, tags: ['数学'] } });
  const messages = JSON.parse(fetch.mock.calls[0]![1].body).messages;
  expect(messages[0].content).toContain('不用样本条数或比例推断真实出现频率');
  expect(Object.keys(JSON.parse(messages[1].content).blocked[0])).toEqual(['title', 'tags']);
  expect(turn).toMatchObject({ kind: 'result', result: { sampleCounts: { watched: 1, blocked: 1 } } });
});
test('模型只接收标题标签、计划和规则，不接收视频编号；不自动保存规则', async () => {
  send.mockImplementation(async message => message.type === 'snapshot' ? { preferences: prefs() } : { watched: [record('watched')], blocked: [record('blocked')] });
  const fetch = vi.fn().mockResolvedValue(streamResponse(resultResponse));
  vi.stubGlobal('fetch', fetch);
  const result = await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {});
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(fetch.mock.calls[0]![1].body);
  expect(body.messages[1].content).not.toContain('BVwatched'); expect(body.messages[1].content).not.toContain('test-key');
  expect(body.stream).toBe(true); expect(result).toMatchObject({ kind: 'result', result: { summary: '建议' } });
  expect(send.mock.calls.map(call => call[0].type)).toEqual(['samples', 'snapshot']);
});
test('取消后的请求不会调用模型', async () => {
  send.mockResolvedValue({ watched: [record('watched')], blocked: [record('blocked')] });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const controller = new AbortController(); controller.abort();
  await expect(analyze(prefs(), migrateSettings(), controller.signal, () => {})).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});

test('说明使用界面用语，规则协议与真实英文词条保持兼容', async () => {
  const value = prefs(); value.settings.positive.text = ['typescript'];
  const fetch = setup(value);
  const suggestion = { action: 'add', side: 'positive', field: 'tags', word: 'typescript', reason: '偏好内容中的视频标签可补充 TypeScript 课程' };
  fetch.mockResolvedValueOnce(streamResponse({ ...resultResponse, summary: '偏好内容已有标题词 TypeScript，可补充视频标签。', suggestions: [suggestion] }));
  const preview = vi.fn();
  const turn = await analyze(value, value.settings, new AbortController().signal, () => {}, preview);
  const messages = JSON.parse(fetch.mock.calls[0]![1].body).messages;
  expect(messages[0].content).toContain('分析说明、建议理由、澄清问题及选项');
  expect(messages[0].content).toContain('positive.text 写成“偏好内容中的标题词”');
  expect(messages[0].content).toContain('negative.tags 写成“避开内容中的视频标签”');
  expect(messages[0].content).toContain('JSON 字段名与枚举值保持规定格式');
  const rules = JSON.parse(messages[1].content).rules;
  expect(rules).not.toHaveProperty('providers');
  expect(rules).toEqual({ positive: value.settings.positive, negative: value.settings.negative, strict: value.settings.strict,
    positiveWins: value.settings.positiveWins, exactTags: value.settings.exactTags });
  expect(preview).toHaveBeenCalledWith('偏好内容已有标题词 TypeScript，可补充视频标签。');
  expect(turn).toMatchObject({ kind: 'result', result: { suggestions: [suggestion] } });
});

test('分析只发送相关规则，壁纸等无关配置不占输入，澄清仍复用相同证据', async () => {
  const value = prefs();
  value.settings.homeWallpaper = 'data:image/png;base64,'+'A'.repeat(100000);
  value.settings.positive = { text: ['TypeScript'], tags: ['课程'], textTags: true };
  value.settings.negative = { text: ['剧透'], tags: ['娱乐'], textTags: false };
  value.settings.strict = true; value.settings.positiveWins = false; value.settings.exactTags = true;
  const fetch = setup(value); fetch.mockResolvedValueOnce(streamResponse(questionResponse));
  const first = pending(await analyze(value, value.settings, new AbortController().signal, () => {}));
  const input = JSON.parse(JSON.parse(fetch.mock.calls[0]![1].body).messages[1].content);
  expect(input).toEqual({ plan: value.plan, watched: [{ title: '数学课', tags: ['数学'] }], blocked: [{ title: '数学课', tags: ['数学'] }],
    rules: { positive: value.settings.positive, negative: value.settings.negative, strict: true, positiveWins: false, exactTags: true } });
  expect(first.session.rules.homeWallpaper).toBe(value.settings.homeWallpaper);
  await analyze(value, value.settings, new AbortController().signal, () => {}, () => {},
    { session: first.session, answer: { question: first.question.question, kind: 'skip', answer: '' } });
  const messages = JSON.parse(fetch.mock.calls[1]![1].body).messages;
  expect(messages[1].content).toBe(first.session.messages[0]!.content);
  expect(JSON.stringify(messages)).not.toContain('data:image');
});

test('手动分析使用所选兼容服务、独立密钥和模型，不携带 DeepSeek 专用参数或其他服务地址', async () => {
  const value = prefs();
  value.settings.providers.push({ id: 'custom-test', name: '我的服务', type: 'openai-compatible', baseUrl: 'https://custom.example/v1' });
  value.settings.ai = { ...value.settings.ai, providerId: 'custom-test', model: 'my-model', maxTokens: 4096, thinking: true };
  value.providerKeys = { 'custom-test': 'custom-secret' };
  const fetch = setup(value);
  const turn = await analyze(value, value.settings, new AbortController().signal, () => {});
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe('https://custom.example/v1/chat/completions');
  expect(options.headers.Authorization).toBe('Bearer custom-secret');
  const body = JSON.parse(options.body);
  expect(body).toMatchObject({ model: 'my-model', max_tokens: 4096, stream: true });
  for (const field of ['thinking', 'reasoning_effort', 'response_format']) expect(body).not.toHaveProperty(field);
  for (const secret of ['custom-secret', 'test-key', 'custom.example']) expect(options.body).not.toContain(secret);
  expect(turn).toMatchObject({ kind: 'result', result: { ai: { providerId: 'custom-test', model: 'my-model' } } });
});

test('计划超出保存上限时，手动分析也不准备样本或调用模型', async () => {
  const value = prefs(); value.plan = '数'.repeat(101);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(analyze(value, migrateSettings(), new AbortController().signal, () => {})).rejects.toThrow('超过 100 字');
  expect(send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test('准备样本后再校验最新字数上限，其他设置页收紧上限时不调用模型', async () => {
  const value = prefs(); value.plan = '数'.repeat(101); value.settings.planMaxLength = 200;
  send.mockImplementation(async message => message.type === 'snapshot' ? { preferences: { ...value, settings: { ...value.settings, planMaxLength: 100 } } } :
    { watched: [record('watched')], blocked: [record('blocked')] });
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(analyze(value, migrateSettings(), new AbortController().signal, () => {})).rejects.toThrow('超过 100 字');
  expect(fetch).not.toHaveBeenCalled();
});

test('信息不足返回选项而不保存结果，说明可流式预览', async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(streamResponse(questionResponse)); const preview = vi.fn();
  const turn = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, preview));
  expect(turn.question.options).toEqual(['准备考试', '完成项目']); expect(preview).toHaveBeenCalledWith('需要明确用途');
  expect(turn.session.clarifications).toEqual([]); expect(send.mock.calls.some(call => call[0].type === 'result')).toBe(false);
});

test('选择现有选项直接请求结果，复用样本，保留回答和原计划', async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(streamResponse(questionResponse));
  const first = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}));
  const turn = await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, () => {},
    { session: first.session, answer: { question: first.question.question, kind: 'option', answer: '准备考试' } });
  expect(turn).toMatchObject({ kind: 'result', result: { plan: '备考', clarifications: [{ kind: 'option', answer: '准备考试' }] } });
  expect(send.mock.calls.filter(call => call[0].type === 'samples')).toHaveLength(1);
  const body = JSON.parse(fetch.mock.calls[1]![1].body);
  expect(body.messages.map((message: { role: string }) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
  expect(JSON.parse(body.messages[3].content)).toMatchObject({ kind: 'option', answer: '准备考试', instruction: '直接给最终结果，不再提问。' });
});

test('自定义信息足够时直接生成结果', async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(streamResponse(questionResponse));
  const first = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}));
  const turn = await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, () => {},
    { session: first.session, answer: { question: first.question.question, kind: 'custom', answer: '用 Python 完成数据分析课程项目' } });
  expect(turn).toMatchObject({ kind: 'result', result: { clarifications: [{ kind: 'custom', answer: '用 Python 完成数据分析课程项目' }] } });
});

test('自定义不足继续澄清，后续跳过保留已有回答并直接出结果', async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(streamResponse(questionResponse));
  const first = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}));
  fetch.mockResolvedValueOnce(streamResponse({ ...questionResponse, question: '具体准备哪门考试？', options: ['数学', '英语'] }));
  const second = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, () => {},
    { session: first.session, answer: { question: first.question.question, kind: 'custom', answer: '近期要考试' } }));
  expect(second.session.clarifications).toEqual([{ question: first.question.question, kind: 'custom', answer: '近期要考试' }]);
  const turn = await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, () => {},
    { session: second.session, answer: { question: second.question.question, kind: 'skip', answer: '' } });
  expect(turn).toMatchObject({ kind: 'result', result: { clarifications: [{ answer: '近期要考试' }, { kind: 'skip', answer: '' }] } });
  expect(send.mock.calls.filter(call => call[0].type === 'samples')).toHaveLength(1);
  const messages = JSON.parse(fetch.mock.calls[2]![1].body).messages;
  expect(messages).toHaveLength(6); expect(JSON.parse(messages[5].content).instruction).toBe('直接给最终结果，不再提问。');
});

test.each(['option', 'skip'] as const)('选择 %s 后模型仍追问则拒绝结果，不自动重试', async kind => {
  const fetch = setup(); fetch.mockImplementation(async () => streamResponse(questionResponse));
  const first = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}));
  await expect(analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, () => {},
    { session: first.session, answer: { question: first.question.question, kind, answer: kind === 'option' ? '准备考试' : '' } })).rejects.toThrow('未按你的选择');
  expect(fetch).toHaveBeenCalledTimes(2); expect(first.session.clarifications).toEqual([]);
});

test('模型可以建议删除现有词条，但不存在的词条拒绝保存', async () => {
  const value = prefs(); value.settings.negative.tags = ['数学']; const fetch = setup(value);
  const deletion = { action: 'remove', side: 'negative', field: 'tags', word: '数学', reason: '与备考目标冲突，可能误伤课程' };
  fetch.mockResolvedValueOnce(streamResponse({ ...resultResponse, suggestions: [deletion] }));
  expect(await analyze(value, value.settings, new AbortController().signal, () => {})).toMatchObject({ kind: 'result', result: { suggestions: [deletion] } });
  fetch.mockResolvedValueOnce(streamResponse({ ...resultResponse, suggestions: [{ ...deletion, word: '娱乐' }] }));
  await expect(analyze(value, value.settings, new AbortController().signal, () => {})).rejects.toThrow('不存在');
});

test('其他页面修改计划或规则后不能继续旧澄清', async () => {
  const value = prefs(); const fetch = setup(value); fetch.mockResolvedValueOnce(streamResponse(questionResponse));
  const first = pending(await analyze(value, value.settings, new AbortController().signal, () => {}));
  const followup = { session: first.session, answer: { question: first.question.question, kind: 'skip' as const, answer: '' } };
  value.plan = '新计划';
  await expect(analyze(value, value.settings, new AbortController().signal, () => {}, () => {}, followup)).rejects.toThrow('计划已改变');
  value.plan = '备考'; value.revision++;
  await expect(analyze(value, value.settings, new AbortController().signal, () => {}, () => {}, followup)).rejects.toThrow('设置已改变');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('无效选项与空白自定义在请求前拒绝', async () => {
  const fetch = setup(); fetch.mockResolvedValueOnce(streamResponse(questionResponse));
  const first = pending(await analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}));
  for (const answer of [{ kind: 'option' as const, answer: '不存在的选项' }, { kind: 'custom' as const, answer: ' ' }]) {
    await expect(analyze(prefs(), migrateSettings(), new AbortController().signal, () => {}, () => {},
      { session: first.session, answer: { question: first.question.question, ...answer } })).rejects.toThrow();
  }
  expect(fetch).toHaveBeenCalledTimes(1);
});
