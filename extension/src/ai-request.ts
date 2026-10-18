// 用AI SDK统一模型调用、结构化增量、授权与原始日志，业务在完整结束后验证并保存。
import { browser } from 'wxt/browser';
import { generateText, Output, streamText, NoObjectGeneratedError, type ModelMessage } from 'ai';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ZodType } from 'zod';
import { completedStream, IncompleteAIStream } from './platform/completed-stream';
import { aiConnection, providerOrigin } from './ai-providers';
import { traceAIWork, type AIDebugFeature } from './ai-debug';
import type { Preferences } from './types';

// DeepSeek 的结构化输出兼容提示是预期行为，其他警告仍写入控制台。
globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
  for (const warning of warnings) {
    if (provider === 'deepseek.chat' && warning.type === 'compatibility' && warning.feature === 'responseFormat JSON schema' &&
        warning.details === 'JSON response schema is injected into the system message.') continue;
    console.warn('AI SDK Warning', { provider, model, warning });
  }
};

interface OutputOptions { schema?: ZodType; preview?: (text: string) => void; partial?: (value: unknown) => void; thinking?: () => void }
export async function requestAI<T>(prefs: Preferences, selection: { providerId?: string; model?: string }, body: Record<string, unknown>, signal: AbortSignal,
  consume: (value: unknown) => Promise<T> | T, feature: AIDebugFeature, options: OutputOptions = {}): Promise<T> {
  const connection = aiConnection(prefs, selection);
  return traceAIWork(feature, { service: connection.provider.name, url: connection.url, input: { ...body, model: connection.model } }, signal, async (capture, recordInput) => {
    if (connection.provider.type === 'openai-compatible' &&
        !await browser.permissions.contains({ origins: [providerOrigin(connection.provider.baseUrl)] })) {
      throw new Error(`请在 AI 服务设置中授权访问“${connection.provider.name}”。`);
    }
    signal.throwIfAborted();
    const transport: typeof fetch = async (url, init) => {
      const input = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const messages = input.messages as { role: string; content: string }[];
      const system = messages.filter(message => message.role === 'system' && message.content).map(message => message.content).join('\n');
      input.messages = [...(system ? [{ role: 'system', content: system }] : []), ...messages.filter(message => message.role !== 'system')];
      input.stream = body.stream === true;
      if (body.max_completion_tokens !== undefined) { input.max_completion_tokens = input.max_tokens; delete input.max_tokens; }
      if (connection.provider.type === 'openai-compatible') {
        if (body.reasoning_effort !== undefined) input.reasoning_effort = body.reasoning_effort;
        if (body.thinking !== undefined) input.thinking = body.thinking;
      }
      await recordInput(input);
      const response = await capture(await fetch(url, { ...init, body: JSON.stringify(input), credentials: 'omit', redirect: 'error' }), input);
      if (!response.ok) {
        const detail = await response.text();
        const context = response.status === 413 || /context|token|length|too.long|too.large|maximum|上下文|输入.{0,8}(?:长|限)/i.test(detail);
        throw new Error(context ? '输入文本超过模型可接受的输入长度，请调低分析上限后重试。' : `模型请求失败（HTTP ${response.status}）：${detail.slice(0,300) || '请检查密钥、余额或服务配置'}。`);
      }
      return body.stream === true ? completedStream(response, signal) : response;
    };
    const model = connection.provider.type === 'deepseek'
      ? createDeepSeek({ baseURL: connection.provider.baseUrl, apiKey: connection.apiKey, fetch: transport })(connection.model)
      : createOpenAICompatible({ name: 'compatible', supportsStructuredOutputs: true, baseURL: connection.provider.baseUrl, apiKey: connection.apiKey || undefined, fetch: transport })(connection.model);
    const messages = body.messages as ModelMessage[];
    const args = { model, instructions: messages.filter(message => message.role === 'system').map(message => String(message.content)).join('\n'),
      messages: messages.filter(message => message.role !== 'system'), maxRetries: 0, abortSignal: signal, onError: () => {},
      maxOutputTokens: Number(body.max_tokens ?? body.max_completion_tokens ?? 4096),
      reasoning: connection.provider.type === 'deepseek' && (body.thinking as { type?: string } | undefined)?.type === 'disabled' ? 'none' as const : body.reasoning_effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
      output: options.schema ? Output.object({ schema: options.schema }) : Output.text(),
    };
    const result = body.stream === true ? streamText(args) : await generateText(args);
    if ('stream' in result) {
      const events = async () => {
        let text = '';
        for await (const event of result.stream) {
          signal.throwIfAborted();
          if (event.type === 'error') throw event.error;
          if (event.type === 'reasoning-delta') options.thinking?.();
          if (!options.schema && event.type === 'text-delta') { text += event.text; options.preview?.(text); }
        }
      };
      const previews = async () => {
        if (!options.schema) return;
        for await (const partial of result.partialOutputStream) {
          signal.throwIfAborted();
          options.partial?.(partial);
          const summary = (partial as { summary?: unknown })?.summary;
          if (typeof summary === 'string') options.preview?.(summary);
        }
      };
      await Promise.all([events(), previews()]);
    }
    signal.throwIfAborted();
    const finish = await result.finishReason;
    if (finish === 'length') throw new Error('模型生成达到输出上限，结果被截断，未保存建议。');
    if (finish !== 'stop') throw new Error('模型未正常结束生成，可能连接中断，未保存结果。');
    const text = await result.text;
    if (!text.trim()) throw new Error(await result.reasoningText ? '模型只返回了思考过程，没有正式结果。' : '模型返回的正式结果为空。');
    return consume(options.schema ? await result.output : text.trim());
  }).catch(error => {
    if (signal.aborted) throw signal.reason;
    if (NoObjectGeneratedError.isInstance(error)) throw new Error('模型返回的结构不完整或格式不正确，未保存结果，请重试。', { cause: error });
    let cause = error;
    while (cause instanceof Error) {
      if (cause instanceof IncompleteAIStream) throw cause;
      cause = cause.cause;
    }
    throw error;
  });
}
