// 离线验证调试日志默认关闭、完整输入输出、失败与取消、并发及清除后的隔离。
import 'fake-indexeddb/auto';
import { allOperations, beginOperation, bindTraceSignal, clearOperations } from '../src/platform/diagnostics';
import { beginLog } from '../src/platform/ai-logs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { allDebugLogs, clearDebugLogs, DEBUG_ENABLED_KEY, debugState, setDebugEnabled, traceAIRequest } from '../src/ai-debug';
import { requestAI } from '../src/ai-request';
import { migrateSettings } from '../src/core';
import type { Preferences } from '../src/types';
import { analyze } from '../src/analysis';
import { createReviewer } from '../src/review';
import { chaptersOutputSchema } from '../src/analysis/schemas';
import { chaptersFromStarts } from '../src/video-chapters';
import { createCommentService } from '../src/comment-service';

const { storage, contains, send } = vi.hoisted(() => ({ storage: {} as Record<string, unknown>, contains: vi.fn(), send: vi.fn() }));
vi.mock('../src/client', () => ({ send }));
vi.mock('../src/database', () => ({ cachedReview: async () => null, saveReview: async () => {} }));
vi.mock('wxt/browser', () => ({ browser: {
  storage: { local: { get: async (key: string) => ({ [key]: storage[key] }), set: async (value: Record<string, unknown>) => { Object.assign(storage, value); } } },
  permissions: { contains },
} }));
const details = { service: '测试服务', url: 'https://example.com/v1/chat/completions', input: { model: 'test', messages: [{ role: 'user', content: '输入正文' }] } };
const signal = () => new AbortController().signal;
beforeEach(async () => {
  delete storage[DEBUG_ENABLED_KEY];
  contains.mockReset().mockResolvedValue(true);
  await clearDebugLogs();
});
afterEach(() => vi.unstubAllGlobals());

test('默认关闭不保存，开启后保留完整输入输出，关闭保留旧日志且不新增', async () => {
  const run = () => traceAIRequest('计划分析', details, signal(), async () => new Response('输出正文'), response => response.text());
  expect(await debugState()).toEqual({ enabled: false, count: 0 });
  expect(await run()).toBe('输出正文'); expect(await allDebugLogs()).toEqual([]);
  await setDebugEnabled(true); expect(await run()).toBe('输出正文');
  expect((await allDebugLogs())[0]).toMatchObject({ ...details, feature: '计划分析', output: '输出正文', status: 'success', httpStatus: 200, durationMs: expect.any(Number) });
  await setDebugEnabled(false); await run();
  expect(await debugState()).toEqual({ enabled: false, count: 1 });
});

test('流式输出保留原始事件与思考内容，跨字节的中文不损坏', async () => {
  await setDebugEnabled(true);
  const raw = 'data: {"choices":[{"delta":{"reasoning_content":"思考😀"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"输出中文\\"}"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n';
  const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
  const controller = new AbortController();
  const parsed = await traceAIRequest('评论速读', details, controller.signal, async () => new Response(body), response => response.text());
  expect(parsed).toContain('输出中文');
  expect((await allDebugLogs())[0]).toMatchObject({ output: raw, status: 'success' });
});

test('流式接收期间的下载能读取已保存的输出，请求结束后补全状态', async () => {
  await setDebugEnabled(true);
  let now = Date.now();
  const time = vi.spyOn(Date, 'now').mockImplementation(() => now);
  let source!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const running = traceAIRequest('评论速读', details, signal(), async () => { started(); return new Response(body); }, response => response.text());
  try {
    await ready; now += 1001;
    source.enqueue(new TextEncoder().encode('已接收的正文'));
    await vi.waitFor(async () => expect((await allDebugLogs())[0]).toMatchObject({ status: 'pending', output: '已接收的正文' }));
    source.close(); expect(await running).toBe('已接收的正文');
    expect((await allDebugLogs())[0]).toMatchObject({ status: 'success', output: '已接收的正文' });
  } finally { time.mockRestore(); }
});

test('HTTP失败保留完整错误正文，网络异常和解析失败均记录原因并维持原有报错', async () => {
  await setDebugEnabled(true);
  await expect(traceAIRequest('AI 通用复核', details, signal(), async () => new Response('余额不足的完整说明', { status: 402 }), async () => { throw new Error('请求失败'); })).rejects.toThrow('请求失败');
  await expect(traceAIRequest('AI 决策复核', details, signal(), async () => { throw new TypeError('网络断开'); }, response => response.json())).rejects.toThrow('网络断开');
  await expect(traceAIRequest('评论速读', details, signal(), async () => new Response('无效 JSON'), response => response.json())).rejects.toThrow();
  const logs = await allDebugLogs();
  expect(logs.find(log => log.feature === 'AI 通用复核')).toMatchObject({ output: '余额不足的完整说明', httpStatus: 402, status: 'error', error: 'Error: 请求失败' });
  expect(logs.find(log => log.feature === 'AI 决策复核')).toMatchObject({ output: '', status: 'error', error: 'TypeError: 网络断开' });
  expect(logs.find(log => log.feature === '评论速读')).toMatchObject({ output: '无效 JSON', status: 'error', error: expect.stringContaining('SyntaxError') });
});

test('取消与超时保留已收到的部分输出，并区分结束状态', async () => {
  await setDebugEnabled(true);
  for (const timeout of [false, true]) {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start(source) { source.enqueue(new TextEncoder().encode('部分输出')); } });
    await expect(traceAIRequest('计划分析', details, controller.signal, async () => new Response(stream), async response => {
      const reader = response.body!.getReader();
      await reader.read(); controller.abort(new DOMException(timeout ? '超时' : '取消', timeout ? 'TimeoutError' : 'AbortError'));
      await reader.cancel(); controller.signal.throwIfAborted();
    })).rejects.toThrow(timeout ? '超时' : '取消');
  }
  const logs = await allDebugLogs();
  expect(logs.map(log => log.output)).toEqual(['部分输出', '部分输出']);
  expect(logs.map(log => log.status)).toEqual(['cancelled', 'error']);
});

test('并发请求不会相互覆盖，下载中的未完成日志保留输入，清除后旧请求不写回', async () => {
  await setDebugEnabled(true);
  let finish!: (response: Response) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const running = traceAIRequest('计划分析', details, signal(), () => { started(); return new Promise<Response>(resolve => { finish = resolve; }); }, response => response.text());
  await ready;
  expect((await allDebugLogs())[0]).toMatchObject({ input: details.input, status: 'pending', output: '' });
  await Promise.all(Array.from({ length: 5 }, (_, index) => traceAIRequest('AI 通用复核', { ...details, input: { index } }, signal(), async () => new Response(String(index)), response => response.text())));
  expect(await allDebugLogs()).toHaveLength(6);
  await clearDebugLogs();
  await traceAIRequest('评论速读', details, signal(), async () => new Response('清除后的新请求'), response => response.text());
  finish(new Response('清除前的旧请求')); await running;
  expect(await allDebugLogs()).toMatchObject([{ output: '清除后的新请求' }]);
  expect((await debugState()).enabled).toBe(true);
});

test('统一请求入口记录实际模型与提示词，不保存认证请求头或其他服务密钥，授权失败也留日志', async () => {
  await setDebugEnabled(true);
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'official-secret', providerKeys: { custom: 'custom-secret' }, decisionApiKey: 'decision-secret', result: null };
  prefs.settings.providers.push({ id: 'custom', name: '兼容服务', type: 'openai-compatible', baseUrl: 'https://example.com/v1' });
  const fetch = vi.fn().mockImplementation(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"answer":"正式输出"}' } }] })); vi.stubGlobal('fetch', fetch);
  await requestAI(prefs, { providerId: 'custom', model: 'actual-model' }, details.input, signal(), value => value, '计划分析');
  const logs = await allDebugLogs();
  expect(logs[0]?.input).toMatchObject({ ...details.input, model: 'actual-model' });
  expect(logs[0]?.output).toContain('正式输出');
  for (const secret of ['official-secret', 'custom-secret', 'decision-secret', 'Authorization']) expect(JSON.stringify(logs)).not.toContain(secret);
  expect(new Headers(fetch.mock.calls[0]?.[1].headers).get('authorization')).toBe('Bearer custom-secret');
  contains.mockResolvedValue(false);
  await expect(requestAI(prefs, { providerId: 'custom', model: 'actual-model' }, {}, signal(), value => value, 'AI 通用复核')).rejects.toThrow('授权');
  expect((await allDebugLogs()).find(log => log.feature === 'AI 通用复核')).toMatchObject({ status: 'error', output: '', error: expect.stringContaining('授权') });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('实际计划分析及澄清、两种复核、评论速读都经过日志入口', async () => {
  await setDebugEnabled(true);
  const settings = migrateSettings({ topics: '数学' });
  settings.minWatched = settings.minBlocked = 1;
  settings.review = { enabled: true, mode: 'general', workspaceId: 'ws-test' };
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings, plan: '学习数学', apiKey: 'official-secret', decisionApiKey: 'decision-secret', result: null };
  send.mockImplementation(async message => message.type === 'snapshot' ? { preferences: prefs } : {
    watched: [{ title: '数学课', tags: ['数学'] }], blocked: [{ title: '游戏', tags: ['游戏'] }],
  });
  const stream = (value: unknown) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(value) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n`);
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  fetch.mockImplementationOnce(async () => stream({ kind: 'clarification', summary: '明确目标', question: '为什么学习数学？', options: ['准备考试', '完成项目'] }));
  const question = await analyze(prefs, settings, signal(), () => {});
  if (question.kind !== 'clarification') throw new Error('预期澄清问题');
  fetch.mockImplementationOnce(async () => stream({ kind: 'result', summary: '建议', suggestions: [] }));
  await analyze(prefs, settings, signal(), () => {}, () => {}, { session: question.session, answer: { question: question.question.question, kind: 'option', answer: '准备考试' } });
  const reviewer = createReviewer(async () => prefs, async () => ['数学']);
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"decisions":{"v0":"related"}}' } }] })));
  expect(await reviewer.request('BVgeneral', '数学课')).toBe('related');
  settings.review.mode = 'decision';
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ answers: { v0: { choice: 'related', confidence: .95, probabilities: { related: .95, unrelated: .02, unknown: .03 } } } })));
  expect(await reviewer.request('BVdecision', '数学课')).toBe('related');
  reviewer.invalidate();
  const service = createCommentService(async () => prefs);
  fetch.mockImplementationOnce(async () => stream({ summary: '讨论数学', topics: [], valuable: [] }));
  await service({ type: 'comments-analyze', requestId: 'test', source: { bvid: 'BVcomments', oid: '123', title: '数学课' }, total: 1,
    comments: [{ id: '1', root: '0', parent: '0', author: '甲', text: '讨论数学问题', time: 1, likes: 0, replies: 0 }] });
  const logs = await allDebugLogs();
  expect(logs.map(log => log.feature)).toEqual(['计划分析', '计划分析', 'AI 通用复核', 'AI 决策复核', '评论速读']);
  expect(logs.every(log => log.status === 'success' && log.output.length > 0)).toBe(true);
  expect(JSON.stringify(logs[1]?.input)).toContain('准备考试');
  expect(JSON.stringify(logs[4]?.input)).toContain('讨论数学问题');
  for (const secret of ['official-secret', 'decision-secret']) expect(JSON.stringify(logs)).not.toContain(secret);
});

test('SDK等待响应时导出已记录实际发送参数，清除后完成请求也不重新写入', async () => {
  await setDebugEnabled(true);
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'private-key', result: null };
  let finish!: (response: Response) => void;
  const fetch = vi.fn(async () => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch',fetch);
  const task = requestAI(prefs,prefs.settings.ai,{ messages: [{ role: 'user', content: '仅测试' }], max_tokens: 1234 },signal(),value => value,'计划分析');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const logs = await allDebugLogs();
  expect(logs[0]).toMatchObject({ status: 'pending', input: { model: prefs.settings.ai.model, max_tokens: 1234, stream: false } });
  expect(JSON.stringify(logs)).not.toContain('private-key');
  await clearDebugLogs();
  finish(Response.json({ choices: [{ finish_reason: 'stop', message: { content: '完成' } }] }));
  expect(await task).toBe('完成'); expect(await allDebugLogs()).toEqual([]);
});


test('HTTP正常结束但章节业务校验失败时日志标记失败，不误报成功或自动重试', async () => {
  await setDebugEnabled(true);
  const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'offline', result: null };
  const value = { chapters: [{ first: 1, title: '遗漏首行', summary: '要点', ad: false }] };
  const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
  vi.stubGlobal('fetch',fetch);
  const rows = Array.from({ length: 20 },(_,i) => ({ start: i, end: i+1, text: '字幕' }));
  await expect(requestAI(prefs,prefs.settings.ai,{ messages: [{ role: 'user', content: '离线章节' }] },signal(),value => {
    return chaptersFromStarts(value,rows,0,19);
  },'视频章节',{ schema: chaptersOutputSchema })).rejects.toThrow('起始行无效');
  expect((await allDebugLogs())[0]).toMatchObject({ status: 'error', httpStatus: 200, error: expect.stringContaining('起始行无效') });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('关闭详细调试仍保留可追踪的诊断摘要，不保存模型正文', async () => {
  await clearOperations(); await setDebugEnabled(false);
  const parent = await beginOperation('选片', '开始');
  const linked = bindTraceSignal(signal(), parent.id);
  await traceAIRequest('AI帮你刷', { ...details, input: { privatePlan: 'private-plan-content' } }, linked,
    async () => new Response('private-output-content'), response => response.text());
  const operations = await allOperations();
  expect(operations.find(log => log.parentId === parent.id)).toMatchObject({ status: 'success' });
  expect(JSON.stringify(operations)).not.toContain('private-plan-content');
  expect(JSON.stringify(operations)).not.toContain('private-output-content');
  expect(await allDebugLogs()).toEqual([]);
});

test('清除诊断后的旧任务不能通过新模型调用恢复原始日志', async () => {
  await setDebugEnabled(true); await clearOperations();
  const parent = await beginOperation('选片', '开始');
  const linked = bindTraceSignal(signal(), parent.id);
  await clearOperations(); await clearDebugLogs();
  expect(await traceAIRequest('AI帮你刷', details, linked, async () => new Response('完成'), response => response.text())).toBe('完成');
  expect(await allOperations()).toEqual([]); expect(await allDebugLogs()).toEqual([]);
});

test('原始内容达到保存上限只截断日志，不截断业务响应；重复读取保持截断预览稳定', async () => {
  await setDebugEnabled(true);
  const output = '正文'.repeat(200000);
  expect(await traceAIRequest('计划分析', { ...details, input: { content: '输入'.repeat(200000) } }, signal(),
    async () => new Response(output), response => response.text())).toBe(output);
  const [first] = await allDebugLogs();
  expect(first).toMatchObject({ status: 'success', truncated: true });
  expect(first!.output.length).toBeLessThanOrEqual(256 * 1024);
  const [second] = await allDebugLogs();
  expect(second!.input).toEqual(first!.input);
});

test('原始日志按保留天数和条数淘汰', async () => {
  const base = { feature: '计划分析' as const, service: '离线', url: 'https://example.com', input: {}, output: '', status: 'success' as const };
  await beginLog({ ...base, id: 'expired', startedAt: new Date(Date.now() - 4 * 86400000).toISOString() });
  for (let i = 0; i < 52; i++) await beginLog({ ...base, id: `bounded-${i}`, startedAt: new Date(Date.now() + i).toISOString() });
  const saved = await allDebugLogs();
  expect(saved).toHaveLength(50); expect(saved.some(log => log.id === 'expired')).toBe(false);
  expect(saved.some(log => log.id === 'bounded-51')).toBe(true);
});

test('原始记录合计容量有上限，体积较大时优先淘汰旧记录', async () => {
  for (let i = 0; i < 12; i++) await beginLog({ id: `size-${i}`, feature: '计划分析', service: '离线', url: 'https://example.com',
    input: { text: '字'.repeat(128 * 1024) }, output: '字'.repeat(256 * 1024), status: 'success', startedAt: new Date(Date.now() + i).toISOString() });
  const saved = await allDebugLogs();
  expect(saved.length).toBeLessThan(12);
  expect(saved.reduce((sum, log) => sum + new TextEncoder().encode(JSON.stringify(log)).length, 0)).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(saved.some(log => log.id === 'size-11')).toBe(true);
});
