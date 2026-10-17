// 用离线模拟验证已安装AI SDK的输出、结束状态、参数和零重试约定，作为迁移前的接入基线。
import { expect, test, vi } from 'vitest';
import { generateText, Output, simulateReadableStream, smoothStream, streamText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';

type StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer Part> ? Part : never;
const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const finish = (reason: 'stop' | 'length' = 'stop'): StreamPart => ({
  type: 'finish', finishReason: { unified: reason, raw: reason }, usage,
});
function modelWith(chunks: StreamPart[]) {
  return new MockLanguageModelV4({ doStream: async () => ({
    stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
  }) });
}
function textChunks(texts: string[], reason: 'stop' | 'length' = 'stop'): StreamPart[] {
  return [{ type: 'text-start', id: 'text' }, ...texts.map(delta => ({ type: 'text-delta' as const, id: 'text', delta })),
    { type: 'text-end', id: 'text' }, finish(reason)];
}
const schema = z.object({ summary: z.string(), count: z.number().int() });
const completion = () => Response.json({ id: 'offline', object: 'chat.completion', created: 1, model: 'offline-model',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"summary":"完成","count":1}' } }],
  usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 },
});

test('正文、思考与正常结束由SDK分开提供，平滑分词不改变中文原文', async () => {
  const text = '先学数学，再做练习。😀';
  const model = modelWith([
    { type: 'reasoning-start', id: 'reasoning' }, { type: 'reasoning-delta', id: 'reasoning', delta: '内部思考' },
    { type: 'reasoning-end', id: 'reasoning' }, ...textChunks([text]),
  ]);
  const result = streamText({ model, prompt: '离线测试', maxRetries: 0,
    experimental_transform: smoothStream({ chunking: new Intl.Segmenter('zh', { granularity: 'word' }), delayInMs: null }),
  });
  const events = [];
  for await (const event of result.stream) events.push(event);
  expect(await result.text).toBe(text);
  expect(await result.reasoningText).toBe('内部思考');
  expect(await result.finishReason).toBe('stop');
  expect(events.filter(event => event.type === 'text-delta').length).toBeGreaterThan(1);
  expect(events.some(event => event.type === 'reasoning-delta')).toBe(true);
  expect(model.doStreamCalls).toHaveLength(1);
});

test('中文、换行及转义引号可以增量预览，最终输出按结构规则校验', async () => {
  const expected = { summary: '数学“目标”\n引用"内容"😀', count: 2 };
  const text = JSON.stringify(expected);
  const result = streamText({ model: modelWith(textChunks([...text])), prompt: '离线测试', maxRetries: 0, output: Output.object({ schema }) });
  const previews = [];
  for await (const partial of result.partialOutputStream) previews.push(partial);
  expect(previews.some(partial => partial.summary?.includes('数学'))).toBe(true);
  expect(previews.some(partial => partial.count === undefined)).toBe(true);
  expect(await result.output).toEqual(expected);
  expect(await result.finishReason).toBe('stop');
});

test('合法但截断的JSON仍可能通过SDK结构校验，业务必须另查结束原因', async () => {
  const result = streamText({ model: modelWith(textChunks(['{"summary":"不完整任务","count":1}'], 'length')),
    prompt: '离线测试', maxRetries: 0, output: Output.object({ schema }),
  });
  for await (const partial of result.partialOutputStream) void partial;
  expect(await result.output).toEqual({ summary: '不完整任务', count: 1 });
  expect(await result.finishReason).toBe('length');
});

test('完整JSON字段类型不符时最终对象失败，预览不能当成保存结果', async () => {
  const result = streamText({ model: modelWith(textChunks(['{"summary":"预览","count":"错误"}'])),
    prompt: '离线测试', maxRetries: 0, output: Output.object({ schema }),
  });
  for await (const partial of result.partialOutputStream) void partial;
  await expect(result.output).rejects.toThrow();
});

test('仅有思考内容的正常结束仍是空正文，不能据此判定业务成功', async () => {
  const result = streamText({ model: modelWith([
    { type: 'reasoning-start', id: 'reasoning' }, { type: 'reasoning-delta', id: 'reasoning', delta: '只有思考' },
    { type: 'reasoning-end', id: 'reasoning' }, finish(),
  ]), prompt: '离线测试', maxRetries: 0 });
  for await (const text of result.textStream) void text;
  expect(await result.text).toBe('');
  expect(await result.reasoningText).toBe('只有思考');
  expect(await result.finishReason).toBe('stop');
});

test('流开始后失败会发出错误事件，省略流重试且回调不请求重试时只调用一次', async () => {
  const failure = new Error('模拟断流');
  const onError = vi.fn(() => {});
  const model = modelWith([{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: '部分正文' },
    { type: 'error', error: failure }]);
  const result = streamText({ model, prompt: '离线测试', maxRetries: 0, onError });
  const events = [];
  for await (const event of result.stream) events.push(event);
  expect(events).toContainEqual({ type: 'error', error: failure });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(model.doStreamCalls).toHaveLength(1);
});

test.each(['network', 'http'] as const)('请求建立阶段%s失败也不自动重试', async kind => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    if (kind === 'network') throw new TypeError('模拟网络故障');
    return Response.json({ error: { message: '模拟服务繁忙' } }, { status: 503 });
  });
  const provider = createOpenAICompatible({ name: 'offline', baseURL: 'https://offline.invalid/v1', fetch });
  await expect(generateText({ model: provider('test'), prompt: '离线测试', maxRetries: 0 })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('流式取消使用调用方信号，取消后不重建模型请求', async () => {
  const controller = new AbortController();
  const onAbort = vi.fn();
  const model = modelWith(textChunks(['第一段', '第二段']));
  const result = streamText({ model, prompt: '离线测试', maxRetries: 0, abortSignal: controller.signal, onAbort });
  const events = [];
  for await (const event of result.stream) {
    events.push(event);
    if (event.type === 'text-delta') controller.abort();
  }
  expect(events.some(event => event.type === 'abort')).toBe(true);
  expect(onAbort).toHaveBeenCalledTimes(1);
  expect(model.doStreamCalls).toHaveLength(1);
  expect(model.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
});

test.each([false, true])('兼容服务结构约束开关%s只改变单次请求的输出格式', async structured => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => completion());
  const provider = createOpenAICompatible({ name: 'offline', baseURL: 'https://offline.invalid/custom/v1',
    supportsStructuredOutputs: structured, apiKey: 'test-key', fetch,
  });
  const result = await generateText({ model: provider('test'), prompt: '离线测试', maxRetries: 0,
    maxOutputTokens: 4096, output: Output.object({ schema }),
  });
  expect(result.output).toEqual({ summary: '完成', count: 1 });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0]?.[0])).toBe('https://offline.invalid/custom/v1/chat/completions');
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({ model: 'test', max_tokens: 4096, response_format: { type: structured ? 'json_schema' : 'json_object' } });
  expect(body).not.toHaveProperty('thinking');
  expect(body).not.toHaveProperty('reasoning_effort');
});

test.each([false, true])('官方供应商保留原思考开关%s、最高强度及输出上限含义', async thinking => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => completion());
  const provider = createDeepSeek({ apiKey: 'test-key', fetch });
  await generateText({ model: provider('deepseek-v4-pro'), prompt: '离线测试', maxRetries: 0, maxOutputTokens: 65536,
    reasoning: thinking ? 'max' : 'none',
  });
  const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(body).toMatchObject({ model: 'deepseek-v4-pro', max_tokens: 65536, thinking: { type: thinking ? 'enabled' : 'disabled' } });
  if (thinking) expect(body.reasoning_effort).toBe('max');
  else expect(body).not.toHaveProperty('reasoning_effort');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('总超时会终止正在等待的模型请求，且不会追加请求', async () => {
  let activeSignal: AbortSignal | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    activeSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      activeSignal!.addEventListener('abort', () => reject(activeSignal!.reason), { once: true });
    });
  });
  const provider = createOpenAICompatible({ name: 'offline', baseURL: 'https://offline.invalid/v1', fetch });
  await expect(generateText({ model: provider('test'), prompt: '离线测试', maxRetries: 0, timeout: { totalMs: 30 } })).rejects.toThrow();
  expect(activeSignal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
