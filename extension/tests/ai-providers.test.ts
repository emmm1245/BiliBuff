// 验证服务配置迁移、地址校验、密钥隔离、兼容请求和站点授权，不调用真实服务。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { aiConnection, providerOrigin, providerUrl, validateProviders } from '../src/ai-providers';
import { migrateSettings, modelParameters, validateBackup, validateSettings } from '../src/core';
import { videoParameters } from '../src/video-ai';
import type { Preferences } from '../src/types';

const { contains } = vi.hoisted(() => ({ contains: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains }, storage: { local: { get: async () => ({}) } } } }));
import { requestAI } from '../src/ai-request';
import { suggestionsSchema } from '../src/analysis/schemas';

let prefs: Preferences;
beforeEach(() => {
  contains.mockReset().mockResolvedValue(true);
  prefs = { schemaVersion: 1, revision: 0, settings: migrateSettings(), plan: '', apiKey: 'official-key', result: null };
  prefs.settings.providers.push({ id: 'custom-one', name: '自定义', type: 'openai-compatible', baseUrl: 'https://example.com/v1' });
  prefs.providerKeys = { 'custom-one': 'custom-key' };
});
afterEach(() => vi.unstubAllGlobals());

test('旧设置补齐唯一官方服务，未知字段和服务中的密钥不会进入公开设置', () => {
  const { providers, ...old } = migrateSettings();
  expect(validateSettings(old).providers).toEqual(providers);
  const settings = validateSettings({ ...prefs.settings, providers: prefs.settings.providers.map(provider => ({ ...provider, apiKey: 'injected' })) });
  expect(settings.providers).toEqual(prefs.settings.providers);
  expect(() => validateProviders([providers[0], providers[0]])).toThrow();
  expect(() => validateProviders([{ ...providers[0], baseUrl: 'https://fake.example' }])).toThrow('官方地址');
});

test('基础地址保留自定义路径，规范尾斜线；拒绝具体接口、凭据和无关协议', () => {
  expect(providerUrl('https://EXAMPLE.com/custom/v1/')).toBe('https://example.com/custom/v1');
  expect(providerOrigin('http://localhost:1234/v1')).toBe('http://localhost/*');
  for (const address of ['https://example.com/v1/chat/completions', 'https://example.com/v1/responses',
    'https://user:secret@example.com/v1', 'https://example.com/v1?key=secret', 'file:///tmp/model', 'https://example.com/v1#fragment']) {
    expect(() => providerUrl(address)).toThrow();
  }
});

test('不同服务只使用自己的密钥，本地兼容服务允许免密，缺失模型或服务时拒绝调用', () => {
  expect(aiConnection(prefs, prefs.settings.ai).apiKey).toBe('official-key');
  expect(aiConnection(prefs, { providerId: 'custom-one', model: 'my-model' }).apiKey).toBe('custom-key');
  prefs.providerKeys = {};
  expect(aiConnection(prefs, { providerId: 'custom-one', model: 'local' }).apiKey).toBe('');
  expect(() => aiConnection(prefs, { providerId: 'missing', model: 'model' })).toThrow('不存在');
  expect(() => aiConnection(prefs, { providerId: 'custom-one', model: '' })).toThrow('模型名称');
});

test('兼容参数不混入专用参数；备份能保留多服务和显式空密钥，拒绝未知服务的密钥', () => {
  prefs.settings.ai = { ...prefs.settings.ai, providerId: 'custom-one', model: 'my-model', thinking: true, maxTokens: 4096 };
  expect(modelParameters(prefs.settings.ai)).toEqual({ model: 'my-model', max_tokens: 4096 });
  const backup = { format: 'bilibili-focus-backup', version: 1, settings: prefs.settings, plan: '', events: [], result: null, providerKeys: { 'custom-one': '' } };
  expect(validateBackup(backup).providerKeys).toEqual({ 'custom-one': '' });
  expect(validateBackup(backup).settings.ai).toEqual(prefs.settings.ai);
  expect(() => validateBackup({ ...backup, providerKeys: { missing: 'key' } })).toThrow('密钥');
});

test('未授权站点不发送请求；授权后只向选择的地址发送一次，免密服务不携带旧密钥', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{}' } }] })); vi.stubGlobal('fetch', fetch);
  const selection = { providerId: 'custom-one', model: 'my-model' };
  contains.mockResolvedValueOnce(false);
  await expect(requestAI(prefs, selection, { messages: [{ role: 'user', content: 'test' }] }, new AbortController().signal, value => value, '计划分析')).rejects.toThrow('授权');
  expect(fetch).not.toHaveBeenCalled();
  await requestAI(prefs, selection, { stream: false, messages: [{ role: 'user', content: 'test' }] }, new AbortController().signal, value => value, '计划分析');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('https://example.com/v1/chat/completions');
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  expect(new Headers(fetch.mock.calls[0]![1].headers).get('authorization')).toBe('Bearer custom-key');
  prefs.providerKeys = {};
  await requestAI(prefs, selection, { messages: [{ role: 'user', content: 'test' }] }, new AbortController().signal, value => value, '计划分析');
  expect(new Headers(fetch.mock.calls[1]![1].headers).has('authorization')).toBe(false);
});

test('兼容端点使用DeepSeek视频模型时保留关闭思考，不额外发送不受支持的none强度', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '视频总结' } }] }));
  vi.stubGlobal('fetch',fetch);
  const selection = { providerId: 'custom-one', model: 'deepseek-flash', effort: 'off' as const };
  await requestAI(prefs,selection,{ ...videoParameters(selection,false), stream: false, messages: [{ role: 'user', content: '字幕' }] },
    new AbortController().signal,value => value,'视频总结');
  const input = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(input.thinking).toEqual({ type: 'disabled' }); expect(input).not.toHaveProperty('reasoning_effort');
  expect(input).not.toHaveProperty('response_format');
  expect(fetch).toHaveBeenCalledTimes(1);
});


test.each([false, true])('兼容服务在流式%s结构化调用中发送服务端字段约束，只请求一次', async stream => {
  const output = { summary: '完成', suggestions: [] };
  const fetch = vi.fn<typeof globalThis.fetch>(async () => stream
    ? new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(output) }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)
    : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
  vi.stubGlobal('fetch',fetch);
  const result = await requestAI(prefs,{ providerId: 'custom-one', model: 'my-model' },
    { stream, messages: [{ role: 'user', content: '分析' }] }, new AbortController().signal,value => value,'计划分析', { schema: suggestionsSchema });
  expect(result).toEqual(output);
  const input = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
  expect(input).toMatchObject({ stream, response_format: { type: 'json_schema', json_schema: { strict: true,
    schema: { type: 'object', properties: { summary: { type: 'string' }, suggestions: { type: 'array' } } } } } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('兼容服务拒绝结构化格式时直接报错，不降级或补发请求', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ error: { message: 'unsupported response_format' } }, { status: 400 }));
  vi.stubGlobal('fetch',fetch);
  await expect(requestAI(prefs,{ providerId: 'custom-one', model: 'my-model' },
    { stream: false, messages: [{ role: 'user', content: '分析' }] }, new AbortController().signal,value => value,'计划分析',
    { schema: suggestionsSchema })).rejects.toThrow('unsupported response_format');
  expect(fetch).toHaveBeenCalledTimes(1);
});
