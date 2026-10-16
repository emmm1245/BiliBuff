// 为各项 AI 功能统一发送请求，并检查自定义服务的站点授权。
import { browser } from 'wxt/browser';
import { aiConnection, providerOrigin } from './ai-providers';
import { traceAIRequest, type AIDebugFeature } from './ai-debug';
import type { Preferences } from './types';

export async function requestAI<T>(prefs: Preferences, selection: { providerId?: string; model?: string }, body: Record<string, unknown>, signal: AbortSignal,
  consume: (response: Response) => Promise<T>, feature: AIDebugFeature) {
  const connection = aiConnection(prefs, selection);
  const input = { ...body, model: connection.model };
  return traceAIRequest(feature, { service: connection.provider.name, url: connection.url, input }, signal, async () => {
    if (connection.provider.type === 'openai-compatible' &&
        !await browser.permissions.contains({ origins: [providerOrigin(connection.provider.baseUrl)] })) {
      throw new Error(`请在 AI 服务设置中授权访问“${connection.provider.name}”。`);
    }
    signal.throwIfAborted();
    return fetch(connection.url, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}) },
      body: JSON.stringify(input),
    });
  }, consume);
}
