// 统一 AI 服务的连接解析、配置校验与密钥选择，不依赖具体业务或浏览器。
import type { AIProvider, Preferences } from './types';

export const DEEPSEEK: AIProvider = { id: 'deepseek', name: 'DeepSeek 官方', type: 'deepseek', baseUrl: 'https://api.deepseek.com' };
export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

export function providerUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('请填写完整的服务基础地址，例如 https://example.com/v1。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('服务地址需使用 http 或 https，不能包含账号、查询参数或片段。');
  }
  if (/\/(?:chat\/completions|responses|models)\/?$/.test(url.pathname)) throw new Error('请填写基础地址，例如 https://example.com/v1，不要包含具体接口路径。');
  return url.href.replace(/\/+$/, '');
}

export function providerOrigin(baseUrl: string) {
  const url = new URL(providerUrl(baseUrl));
  // 浏览器的站点匹配规则不包含端口，授权范围由浏览器展示。
  return `${url.protocol}//${url.hostname}/*`;
}

export function validateProviders(value: unknown): AIProvider[] {
  if (!Array.isArray(value)) throw new Error('AI 服务列表无效。');
  const providers = value.map((item: AIProvider) => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]+$/.test(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || typeof item.baseUrl !== 'string') throw new Error('请检查 AI 服务名称与地址。');
    if (item.id === 'deepseek') {
      if (item.type !== DEEPSEEK.type || item.baseUrl !== DEEPSEEK.baseUrl) throw new Error('DeepSeek 官方地址不能更改，请添加兼容服务。');
      return { ...DEEPSEEK };
    }
    if (item.type !== 'openai-compatible') throw new Error('AI 服务类型无效。');
    return { id: item.id, name: item.name.trim(), type: item.type, baseUrl: item.baseUrl.trim() ? providerUrl(item.baseUrl.trim()) : '' };
  });
  if (providers.filter(item => item.id === 'deepseek').length !== 1 || new Set(providers.map(item => item.id)).size !== providers.length) throw new Error('AI 服务标识重复或缺少 DeepSeek 官方服务。');
  return providers;
}

export function validateProviderKeys(value: unknown, providers: AIProvider[]): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 服务密钥格式无效。');
  const keys = Object.entries(value);
  if (keys.some(([id, key]) => !providers.some(provider => provider.id === id && provider.type === 'openai-compatible') ||
      typeof key !== 'string' || /\s/.test(key))) throw new Error('AI 服务密钥无效或不属于现有服务。');
  return Object.fromEntries(keys);
}

export function aiConnection(prefs: Preferences, selection: { providerId?: string; model?: string }) {
  const id = selection.providerId ?? 'deepseek';
  const provider = (prefs.settings.providers ?? [DEEPSEEK]).find(item => item.id === id);
  if (!provider) throw new Error('所选 AI 服务已不存在，请重新选择。');
  if (!provider.baseUrl) throw new Error(`请先填写“${provider.name}”的服务地址。`);
  const model = selection.model?.trim();
  if (!model) throw new Error('请先填写模型名称。');
  if (provider.type === 'deepseek' && !DEEPSEEK_MODELS.includes(model)) throw new Error('请选择有效的 DeepSeek 模型。');
  const apiKey = id === 'deepseek' ? prefs.apiKey : prefs.providerKeys?.[id] ?? '';
  if (provider.type === 'deepseek' && !apiKey) throw new Error('请先填写 DeepSeek 密钥。');
  return { provider, model, apiKey, url: `${providerUrl(provider.baseUrl)}/chat/completions` };
}
