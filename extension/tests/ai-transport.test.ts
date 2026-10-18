// 在实际SDK请求入口验证分块解码、预览、结束状态、取消及损坏响应，不调用真实模型。
import { afterEach, expect, test, vi } from 'vitest';
import { requestAI } from '../src/ai-request';
import { suggestionsSchema } from '../src/analysis/schemas';
import { browseProfileSchema } from '../src/browse-ranking';
import { migrateSettings, validateSuggestions } from '../src/core';
import type { Preferences } from '../src/types';
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => true }, storage: { local: { get: async () => ({}) } } } }));
afterEach(() => vi.unstubAllGlobals());
const prefs: Preferences = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'offline', result: null };

test('真实故障回放：计划排除列表38项时SDK仍应接受完整结果，不在找片前失败', async () => {
  // 保留用户日志中的结构和项数，替换个人词条；响应经过真实SDK的流式结构校验。
  const profile = { goals: ['学习专业知识'],topics: ['数学','英语','专业课'],excluded: Array.from({ length: 38 },(_,i) => `排除主题${i}`),formats: ['不限'],uncertainties: ['简称的具体范围未展开'] };
  vi.stubGlobal('fetch',vi.fn(async () => response(event(JSON.stringify(profile),'stop')+'data: [DONE]\n\n',64)));
  const result = await requestAI(prefs,prefs.settings.browse,{ stream: true,messages: [{ role: 'user',content: '整理计划' }] },new AbortController().signal,
    value => browseProfileSchema.parse(value),'AI帮你刷',{ schema: browseProfileSchema });
  expect(result).toEqual(profile);
});
function event(content: string, finish: string | null = null) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\r\n\r\n`;
}
function response(text: string, byteSize = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += byteSize) controller.enqueue(bytes.slice(i,i+byteSize));
    controller.close();
  } }));
}
function run(response: Response, signal = new AbortController().signal, preview = vi.fn(), thinking = vi.fn(), plain = false) {
  vi.stubGlobal('fetch', vi.fn(async () => response));
  return requestAI(prefs,prefs.settings.ai,{ stream: true, messages: [{ role: 'user', content: '离线输入' }] },signal,
    value => plain ? value : validateSuggestions(value),'计划分析',{ ...(plain ? {} : { schema: suggestionsSchema }), preview, thinking });
}
test('DeepSeek 结构化输出兼容提示不刷警告，其他警告继续保留', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const data = event('{"summary":"结果","suggestions":[]}', 'stop') + 'data: [DONE]\n\n';
    expect(await run(response(data))).toMatchObject({ summary: '结果' });
    expect(warn).not.toHaveBeenCalled();
    const logger = globalThis.AI_SDK_LOG_WARNINGS;
    if (typeof logger !== 'function') throw new Error('缺少警告处理函数');
    const warning = { type: 'unsupported' as const, feature: 'test' };
    logger({ provider: 'deepseek.chat', model: 'deepseek-flash', warnings: [warning] });
    expect(warn).toHaveBeenCalledWith('AI SDK Warning', { provider: 'deepseek.chat', model: 'deepseek-flash', warning });
    warn.mockClear();
    logger({ provider: 'other.chat', model: 'test', warnings: [{ type: 'compatibility', feature: 'responseFormat JSON schema', details: 'JSON response schema is injected into the system message.' }] });
    expect(warn).toHaveBeenCalledTimes(1);
  } finally { warn.mockRestore(); }
});

test('中文按单字节分块、换行和保活注释仍能正确解码，完整结果前有正文预览', async () => {
  const preview = vi.fn(), thinking = vi.fn();
  const data = ': keep-alive\r\n\r\n' + event('{"summary":"中文') + event('分析","suggestions":[]}') + event('','stop') + 'data: [DONE]\n\n';
  expect(await run(response(data),undefined,preview,thinking)).toEqual({ summary: '中文分析', suggestions: [] });
  expect(preview.mock.calls.some(([text]) => text.includes('中文'))).toBe(true); expect(thinking).not.toHaveBeenCalled();
});
test('转义字符和中文预览为可读文字，不展示JSON协议标记', async () => {
  const preview = vi.fn(), summary = '第一行\n"引号" 数😀';
  const data = JSON.stringify({ summary, suggestions: [] });
  expect(await run(response(event(data,'stop')+'data: [DONE]\n\n'),undefined,preview)).toEqual({ summary, suggestions: [] });
  expect(preview).toHaveBeenLastCalledWith(summary);
  expect(preview.mock.calls.every(([text]) => !text.includes('"summary":'))).toBe(true);
});
test('思考只更新阶段，只有思考的结果拒绝保存', async () => {
  const thinking = vi.fn(), preview = vi.fn();
  const data = `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '内部思考内容' } }] })}\n\n` + event('','stop') + 'data: [DONE]\n\n';
  await expect(run(response(data,50),undefined,preview,thinking)).rejects.toThrow('只返回了思考过程');
  expect(thinking).toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
});
test('有正常结束原因但缺少结束标记时仍拒绝保存', async () => {
  await expect(run(response(event('{"summary":"半成品","suggestions":[]}','stop')))).rejects.toThrow('连接中断');
});
test.each(['length',null])('结束原因%s不正常时，即使JSON合法也拒绝保存', async finish => {
  await expect(run(response(event('{"summary":"结果","suggestions":[]}',finish)+'data: [DONE]\n\n'))).rejects.toThrow(finish === 'length' ? '输出上限' : '未正常结束');
});
test('取消正在等待的流会释放读取器并拒绝结果', async () => {
  const cancel = vi.fn(), controller = new AbortController(), preview = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(event('{"summary":"正在生成'))); }, cancel });
  const task = run(new Response(body),controller.signal,preview);
  await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('正在生成'));
  controller.abort(); await expect(task).rejects.toThrow(); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
});
test('结果完整时不等待一直未完成的底层取消清理', async () => {
  let finish!: () => void;
  const cancel = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(event('{"summary":"结果","suggestions":[]}','stop')+'data: [DONE]\n\n')); }, cancel });
  try { expect(await run(new Response(body))).toMatchObject({ summary: '结果' }); expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false); }
  finally { finish?.(); }
});
test('用户取消也不等待底层清理完成', async () => {
  let finish!: () => void;
  const cancel = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const controller = new AbortController(), preview = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode(event('{"summary":"生成中'))); }, cancel });
  const task = run(new Response(body),controller.signal,preview).catch(error => error);
  try { await vi.waitFor(() => expect(preview).toHaveBeenCalledWith('生成中')); controller.abort(); expect((await task as Error).name).toBe('AbortError'); expect(body.locked).toBe(false); }
  finally { finish?.(); }
});
test('错误事件、损坏事件、非法JSON和空响应均不接受，不追加请求', async () => {
  for (const data of ['data: {"error":{"message":"failed"}}\n\n','data: invalid\n\n',event('invalid','stop')+'data: [DONE]\n\n','']) {
    await expect(run(response(data))).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  }
});
test('普通正文从第一段就展示，不依赖JSON字段', async () => {
  const preview = vi.fn();
  expect(await run(response(event('直接')+event('显示正文','stop')+'data: [DONE]\n\n'),undefined,preview,undefined,true)).toBe('直接显示正文');
  expect(preview).toHaveBeenCalledWith('直接'); expect(preview).toHaveBeenLastCalledWith('直接显示正文');
});


test('结构化数组未完成时已推送字段增量，完整校验前不消费结果', async () => {
  let input!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(controller) { input = controller; } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  const partial = vi.fn(), consume = vi.fn(value => validateSuggestions(value));
  const task = requestAI(prefs,prefs.settings.ai,{ stream: true, messages: [{ role: 'user', content: '离线测试' }] },
    new AbortController().signal,consume,'计划分析',{ schema: suggestionsSchema, partial });
  input.enqueue(new TextEncoder().encode(event('{"summary":"分析","suggestions":[{"side":"positive","field":"text","word":"数学","reason":"学习')));
  await vi.waitFor(() => expect(partial.mock.calls.some(([value]) => value.suggestions?.[0]?.word === '数学')).toBe(true));
  expect(consume).not.toHaveBeenCalled();
  input.enqueue(new TextEncoder().encode(event('目标"}]}','stop')+'data: [DONE]\n\n')); input.close();
  expect(await task).toMatchObject({ suggestions: [{ word: '数学', reason: '学习目标' }] });
  expect(consume).toHaveBeenCalledTimes(1);
});
