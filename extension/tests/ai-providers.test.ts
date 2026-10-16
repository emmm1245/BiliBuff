// 验证服务配置迁移、地址校验、密钥隔离、兼容请求和站点授权，不调用真实服务。
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { aiConnection, providerOrigin, providerUrl, validateProviders } from '../src/ai-providers';
import { migrateSettings, modelParameters, validateBackup, validateSettings } from '../src/core';
import type { Preferences } from '../src/types';

const { contains } = vi.hoisted(() => ({ contains: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains }, storage: { local: { get: async () => ({}) } } } }));
import { requestAI } from '../src/ai-request';

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
  const fetch = vi.fn().mockImplementation(async () => new Response('{}')); vi.stubGlobal('fetch', fetch);
  const selection = { providerId: 'custom-one', model: 'my-model' };
  contains.mockResolvedValueOnce(false);
  await expect(requestAI(prefs, selection, {}, new AbortController().signal, response => response.text(), '计划分析')).rejects.toThrow('授权');
  expect(fetch).not.toHaveBeenCalled();
  await requestAI(prefs, selection, { stream: true }, new AbortController().signal, response => response.text(), '计划分析');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('https://example.com/v1/chat/completions');
  expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer custom-key' } });
  prefs.providerKeys = {};
  await requestAI(prefs, selection, {}, new AbortController().signal, response => response.text(), '计划分析');
  expect(fetch.mock.calls[1]![1].headers).not.toHaveProperty('Authorization');
});
